// apps/api/src/services/cre/compiler.ts

import { config } from "../../config"
import { AppError, ErrorCodes } from "../../types/errors"
import { createLogger } from "../../lib/logger"
import { Semaphore } from "../../lib/semaphore"
import { runCommand, withCREWorkspace } from "./cre-utils"
import { parseSimulationOutput, formatTraceForLog, type SimulationResult } from "./parser"

const log = createLogger("CRE Compiler")

// --- Constants ---

const SIMULATION_TIMEOUT = 60_000     // 60 seconds

// --- Concurrency Semaphore ---

const simSemaphore = new Semaphore(3)

// --- Test-only introspection (preserves existing API for cre-compiler.test.ts) ---

export function _getSimState(): { activeSimCount: number; queueLength: number } {
  const state = simSemaphore._getState()
  return { activeSimCount: state.activeCount, queueLength: state.queueLength }
}

// --- CRE CLI Check ---

export async function checkCRECli(): Promise<boolean> {
  try {
    const proc = Bun.spawn([config.CRE_CLI_PATH, "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    })

    const timeoutId = setTimeout(() => {
      log.warn("CRE CLI version check timed out after 5000ms")
      proc.kill()
    }, 5000)

    const exitCode = await proc.exited
    clearTimeout(timeoutId)
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
  const startTime = Date.now()

  try {
    return await withCREWorkspace(
      {
        prefix: "ciel-sim",
        code,
        configJson,
        semaphore: simSemaphore,
      },
      async (cwd, env) => {
        // Run CRE simulate
        const simResult = await runCommand(
          [config.CRE_CLI_PATH, "simulate", "--workflow", "workflow.ts", "--config", "config.json"],
          cwd,
          env,
          SIMULATION_TIMEOUT,
          "cre simulate",
        )

        const rawOutput = simResult.stdout + "\n" + simResult.stderr

        // Parse output into structured trace
        const parsed = parseSimulationOutput(rawOutput)

        const duration = Date.now() - startTime

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
      },
    )
  } catch (err) {
    const duration = Date.now() - startTime
    const message = (err as Error).message

    // Install failure → return as simulation result (not throw)
    if (err instanceof AppError && err.code === ErrorCodes.INSTALL_FAILED) {
      const details = err.details as { exitCode: number; stderr: string }
      return {
        success: false,
        executionTrace: [],
        duration,
        errors: [
          `Dependency installation failed (exit ${details.exitCode}):`,
          details.stderr.slice(0, 500),
        ],
        warnings: [],
        rawOutput: details.stderr ?? "",
      }
    }

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
  }
}
