// apps/api/src/services/cre/cre-utils.ts
// Shared utilities for CRE CLI operations (compiler + deployer).

import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { config } from "../../config"
import { AppError, ErrorCodes } from "../../types/errors"
import { createLogger } from "../../lib/logger"
import { linkCachedDeps } from "./dep-cache"
import type { Semaphore } from "../../lib/semaphore"

const log = createLogger("CRE Utils")

// --- Constants ---

export const MAX_OUTPUT_BYTES = 2 * 1024 * 1024  // 2 MB stdout/stderr cap
const BUN_INSTALL_TIMEOUT_DEFAULT = 30_000       // 30 seconds

// --- Truncation Helper ---

export function truncate(text: string, maxBytes: number): string {
  if (text.length <= maxBytes) return text
  return text.slice(0, maxBytes) + "\n[truncated]"
}

// --- Package.json Template ---

export function buildPackageJson(prefix: string): string {
  return JSON.stringify(
    {
      name: `${prefix}-${randomUUID().slice(0, 8)}`,
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

export function buildCREEnv(): Record<string, string | undefined> {
  return {
    ...process.env,
    CRE_SECRET_OPENAI_API_KEY: config.OPENAI_API_KEY,
    CRE_SECRET_ANTHROPIC_API_KEY: config.ANTHROPIC_API_KEY,
    CRE_SECRET_GEMINI_API_KEY: config.GEMINI_API_KEY,
    PATH: process.env.PATH,
  }
}

// --- Run Command with Timeout ---

export async function runCommand(
  cmd: string[],
  cwd: string,
  env: Record<string, string | undefined>,
  timeoutMs: number,
  label: string,
): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
  log.debug(`Running ${label}: ${cmd.join(" ")}`)

  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: env as Record<string, string>,
  })

  let didTimeout = false

  const timeoutId = setTimeout(() => {
    didTimeout = true
    log.warn(`${label} timed out after ${timeoutMs}ms`)
    proc.kill()
  }, timeoutMs)

  const exitCode = await proc.exited
  clearTimeout(timeoutId)

  let stdout = await new Response(proc.stdout).text()
  let stderr = await new Response(proc.stderr).text()

  stdout = truncate(stdout, MAX_OUTPUT_BYTES)
  stderr = truncate(stderr, MAX_OUTPUT_BYTES)

  log.debug(
    `${label} finished — exit: ${exitCode}, ` +
    `stdout: ${stdout.length} chars, stderr: ${stderr.length} chars`,
  )

  return { stdout, stderr, exitCode, timedOut: didTimeout }
}

// --- Parse DON Workflow ID from CLI Output ---

const WORKFLOW_ID_RE = /workflow[_\s-]?id[:\s]+([a-f0-9-]{36})/i
const UUID_FALLBACK_RE = /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i

export function parseDonWorkflowId(output: string): string {
  const match = output.match(WORKFLOW_ID_RE)
  if (match) return match[1]

  const fallback = output.match(UUID_FALLBACK_RE)
  if (fallback) {
    log.warn(`No workflow_id keyword found in CRE output, using bare UUID fallback: ${fallback[1]}`)
    return fallback[1]
  }

  throw new AppError(
    ErrorCodes.DEPLOY_FAILED,
    500,
    `CRE deploy output contained no workflow ID. Raw output: ${output.slice(0, 200)}`,
  )
}

// --- Shared CRE Workspace Lifecycle ---

export interface WorkspaceOptions {
  prefix: string                  // "ciel-sim" or "ciel-deploy"
  code: string
  configJson: Record<string, unknown>
  semaphore?: Semaphore           // optional concurrency control
  bunInstallTimeout?: number      // default 30_000
}

export async function withCREWorkspace<T>(
  options: WorkspaceOptions,
  callback: (cwd: string, env: Record<string, string | undefined>) => Promise<T>,
): Promise<T> {
  if (options.semaphore) await options.semaphore.acquire()

  let tempDir: string | null = null

  try {
    // Step 1: Create temp directory
    tempDir = await mkdtemp(join(tmpdir(), `${options.prefix}-`))
    log.debug(`Created temp dir: ${tempDir}`)

    // Step 2: Write workflow files
    await writeFile(join(tempDir, "workflow.ts"), options.code, "utf-8")
    await writeFile(
      join(tempDir, "config.json"),
      JSON.stringify(options.configJson, null, 2),
      "utf-8",
    )

    // Step 3: Write package.json
    await writeFile(
      join(tempDir, "package.json"),
      buildPackageJson(options.prefix),
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
        options.bunInstallTimeout ?? BUN_INSTALL_TIMEOUT_DEFAULT,
        "bun install",
      )

      if (installResult.exitCode !== 0) {
        throw new AppError(
          ErrorCodes.INSTALL_FAILED,
          500,
          `Dependency installation failed (exit ${installResult.exitCode}): ${installResult.stderr.slice(0, 500)}`,
          { exitCode: installResult.exitCode, stderr: installResult.stderr },
        )
      }
    }

    // Step 5: Execute callback (simulate or deploy)
    return await callback(tempDir, env)
  } finally {
    // Step 6: Cleanup temp directory
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch((err) => {
        log.warn(`Cleanup failed for ${tempDir}: ${(err as Error).message}`)
      })
    }
    // Step 7: Release semaphore slot
    if (options.semaphore) options.semaphore.release()
  }
}
