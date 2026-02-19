// apps/api/src/services/cre/compiler.ts

import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { config } from "../../config"
import { AppError, ErrorCodes } from "../../types/errors"
import { createLogger } from "../../lib/logger"
import { parseSimulationOutput, formatTraceForLog, type SimulationResult } from "./parser"
import { linkCachedDeps } from "./dep-cache"

const log = createLogger("CRE Compiler")

// --- Constants ---

const BUN_INSTALL_TIMEOUT = 30_000    // 30 seconds
const SIMULATION_TIMEOUT = 60_000     // 60 seconds
const MAX_CONCURRENT_SIMS = 3         // Max parallel simulations
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024  // 2 MB stdout/stderr cap

// --- Concurrency Semaphore ---
// Prevents resource exhaustion from concurrent bun install + CRE processes.
// Same pattern as the orchestrator's semaphore in orchestrator.ts.

let activeSimCount = 0
const simWaitQueue: Array<() => void> = []

async function acquireSimSlot(): Promise<void> {
  if (activeSimCount < MAX_CONCURRENT_SIMS) {
    activeSimCount++
    return
  }
  return new Promise<void>((resolve) => {
    simWaitQueue.push(() => {
      activeSimCount++
      resolve()
    })
  })
}

function releaseSimSlot(): void {
  if (activeSimCount <= 0) return // Guard against double-release
  activeSimCount--
  const next = simWaitQueue.shift()
  if (next) next()
}

// --- Test-only introspection (follows _resetOpenAIClient pattern) ---

export function _getSimState(): { activeSimCount: number; queueLength: number } {
  return { activeSimCount, queueLength: simWaitQueue.length }
}

// --- Truncation Helper ---

function truncate(text: string, maxBytes: number): string {
  if (text.length <= maxBytes) return text
  return text.slice(0, maxBytes) + "\n[truncated]"
}

// --- Package.json Template ---

function buildPackageJson(): string {
  return JSON.stringify(
    {
      name: `ciel-sim-${randomUUID().slice(0, 8)}`,
      private: true,
      dependencies: {
        "@chainlink/cre-sdk": "^1.0.7",
        zod: "^3.22.0",
      },
    },
    null,
    2,
  )
}

// --- Build CRE Environment Variables ---

function buildCREEnv(): Record<string, string | undefined> {
  return {
    ...process.env,
    // CRE secrets are passed as CRE_SECRET_* env vars
    CRE_SECRET_OPENAI_API_KEY: config.OPENAI_API_KEY,
    CRE_SECRET_ANTHROPIC_API_KEY: config.ANTHROPIC_API_KEY,
    CRE_SECRET_GEMINI_API_KEY: config.GEMINI_API_KEY,
    // Ensure PATH includes Bun and CRE CLI
    PATH: process.env.PATH,
  }
}

// --- Run Command with Timeout ---

async function runCommand(
  cmd: string[],
  cwd: string,
  env: Record<string, string | undefined>,
  timeoutMs: number,
  label: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  log.debug(`Running ${label}: ${cmd.join(" ")}`)

  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: env as Record<string, string>,
  })

  // Timeout handling
  const timeoutId = setTimeout(() => {
    log.warn(`${label} timed out after ${timeoutMs}ms`)
    proc.kill()
  }, timeoutMs)

  const exitCode = await proc.exited
  clearTimeout(timeoutId)

  let stdout = await new Response(proc.stdout).text()
  let stderr = await new Response(proc.stderr).text()

  // Truncate oversized output
  stdout = truncate(stdout, MAX_OUTPUT_BYTES)
  stderr = truncate(stderr, MAX_OUTPUT_BYTES)

  log.debug(
    `${label} finished — exit: ${exitCode}, ` +
    `stdout: ${stdout.length} chars, stderr: ${stderr.length} chars`,
  )

  return { stdout, stderr, exitCode }
}

// --- CRE CLI Check ---

export async function checkCRECli(): Promise<boolean> {
  try {
    const proc = Bun.spawn([config.CRE_CLI_PATH, "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    })

    const exitCode = await proc.exited
    const stdout = await new Response(proc.stdout).text()

    if (exitCode === 0) {
      log.info(`CRE CLI found: ${stdout.trim()}`)
      return true
    }

    log.warn(`CRE CLI at '${config.CRE_CLI_PATH}' exited with code ${exitCode}`)
    return false
  } catch {
    log.warn(
      `CRE CLI not found at '${config.CRE_CLI_PATH}'. ` +
      `Simulation will fail until installed. Set CRE_CLI_PATH env var if installed elsewhere.`,
    )
    return false
  }
}

// --- Main Simulation Function ---

export async function simulateWorkflow(
  code: string,
  configJson: Record<string, unknown>,
): Promise<SimulationResult> {
  await acquireSimSlot()

  const startTime = Date.now()
  let tempDir: string | null = null

  try {
    // Step 1: Create temp directory
    tempDir = await mkdtemp(join(tmpdir(), "ciel-sim-"))
    log.debug(`Created temp dir: ${tempDir}`)

    // Step 2: Write workflow.ts and config.json
    await writeFile(join(tempDir, "workflow.ts"), code, "utf-8")
    await writeFile(
      join(tempDir, "config.json"),
      JSON.stringify(configJson, null, 2),
      "utf-8",
    )

    // Step 3: Write package.json (CRE CLI may need it even with cached deps)
    await writeFile(
      join(tempDir, "package.json"),
      buildPackageJson(),
      "utf-8",
    )

    // Step 4: Try cached deps first, fall back to fresh install
    const env = buildCREEnv()
    const linked = await linkCachedDeps(tempDir)

    if (!linked) {
      const installResult = await runCommand(
        ["bun", "install"],
        tempDir,
        env,
        BUN_INSTALL_TIMEOUT,
        "bun install",
      )

      if (installResult.exitCode !== 0) {
        return {
          success: false,
          executionTrace: [],
          duration: Date.now() - startTime,
          errors: [
            `Dependency installation failed (exit ${installResult.exitCode}):`,
            installResult.stderr.slice(0, 500),
          ],
          warnings: [],
          rawOutput: installResult.stderr,
        }
      }
    }

    // Step 5: Run CRE simulate
    const crePath = config.CRE_CLI_PATH

    const simResult = await runCommand(
      [crePath, "simulate", "--workflow", "workflow.ts", "--config", "config.json"],
      tempDir,
      env,
      SIMULATION_TIMEOUT,
      "cre simulate",
    )

    const rawOutput = simResult.stdout + "\n" + simResult.stderr

    // Step 6: Parse output into structured trace
    const parsed = parseSimulationOutput(rawOutput)

    const duration = Date.now() - startTime

    // Determine success based on exit code and parsed errors
    const success =
      simResult.exitCode === 0 && parsed.errors.length === 0

    log.info(
      `Simulation ${success ? "succeeded" : "failed"} ` +
      `in ${duration}ms — ${parsed.executionTrace.length} steps, ` +
      `${parsed.errors.length} errors, ${parsed.warnings.length} warnings\n` +
      formatTraceForLog(parsed.executionTrace),
    )

    return {
      success,
      executionTrace: parsed.executionTrace,
      duration,
      errors:
        simResult.exitCode !== 0
          ? [
              `CRE CLI exited with code ${simResult.exitCode}`,
              ...parsed.errors,
            ]
          : parsed.errors,
      warnings: parsed.warnings,
      rawOutput,
    }
  } catch (err) {
    const duration = Date.now() - startTime
    const message = (err as Error).message

    // ENOENT detection: CRE binary not found
    if (
      message.includes("ENOENT") ||
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new AppError(
        ErrorCodes.CRE_CLI_ERROR,
        500,
        `CRE CLI not found at '${config.CRE_CLI_PATH}'. Install it or set CRE_CLI_PATH.`,
      )
    }

    log.error(`Simulation error: ${message}`)

    return {
      success: false,
      executionTrace: [],
      duration,
      errors: [`Simulation error: ${message}`],
      warnings: [],
      rawOutput: "",
    }
  } finally {
    // Step 7: Cleanup temp directory
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch((err) => {
        log.warn(`Cleanup failed for ${tempDir}: ${err.message}`)
      })
    }
    releaseSimSlot()
  }
}
