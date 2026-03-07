// ─────────────────────────────────────────────
// Compile Feedback — Real Compilation Check for Retry Loop
// ─────────────────────────────────────────────
// Runs actual TypeScript compilation via CRE CLI to catch type errors,
// missing imports, and SDK API mismatches that regex-based validation misses.
//
// Key patterns:
//   - Reuses withCREWorkspace + runCommand from cre-utils (no duplication)
//   - Dedicated compileSemaphore(1) — doesn't contend with user-initiated sims
//   - Never throws — always returns CompileFeedback (pipeline must continue)
//   - 30s timeout — compile-only, no full execution needed

import { Semaphore } from "../../lib/semaphore"
import { withCREWorkspace, runCommand, WF_SUBDIR } from "../cre/cre-utils"
import { config } from "../../config"
import { createLogger } from "../../lib/logger"

const log = createLogger("CompileFeedback")

// ─────────────────────────────────────────────
// Public Interfaces
// ─────────────────────────────────────────────

export interface CompileFeedback {
  /** Whether the code compiled successfully */
  compiled: boolean
  /** Parsed error messages from compiler output */
  errors: string[]
  /** Full compiler output (truncated to 4KB) */
  rawOutput: string
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const COMPILE_TIMEOUT_MS = 30_000        // 30 seconds — compile only, no execution
const MAX_RAW_OUTPUT = 4 * 1024          // 4KB cap on raw output for LLM context

// Dedicated semaphore — 1 concurrent compile check to avoid resource contention
// with the 3-slot simSemaphore in compiler.ts
const compileSemaphore = new Semaphore(1)

// ─────────────────────────────────────────────
// Error Parsing
// ─────────────────────────────────────────────

// Match TypeScript-style error lines: "file.ts(line,col): error TS1234: message"
// Also matches: "error: message" from bun/CRE compiler output
const TSC_ERROR_RE = /(?:^|\n)\s*(?:.*?\.ts\(\d+,\d+\):\s*)?error\s+(?:TS\d+:\s*)?(.+)/g

// Match generic compilation failure messages
const COMPILE_FAIL_RE = /(?:^|\n)\s*(?:error|Error|ERROR)[:\s]+(.+)/g

function parseCompileErrors(output: string): string[] {
  const errors: string[] = []
  const seen = new Set<string>()

  // Extract tsc-style errors first (more specific)
  for (const match of output.matchAll(TSC_ERROR_RE)) {
    const msg = match[1].trim()
    if (msg && !seen.has(msg)) {
      seen.add(msg)
      errors.push(msg)
    }
  }

  // If no tsc errors found, try generic error patterns
  if (errors.length === 0) {
    for (const match of output.matchAll(COMPILE_FAIL_RE)) {
      const msg = match[1].trim()
      if (msg && !seen.has(msg) && msg.length > 5) {
        seen.add(msg)
        errors.push(msg)
      }
    }
  }

  return errors
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * Runs CRE CLI compilation on generated code and returns structured feedback.
 *
 * Never throws — returns { compiled: false, errors: [...] } on any failure,
 * including CRE CLI not found, timeout, or workspace setup errors.
 *
 * @param code - Generated TypeScript workflow code
 * @param configJson - Parsed config object matching the workflow's Zod schema
 * @returns CompileFeedback with compilation status, errors, and raw output
 */
export async function compileCheck(
  code: string,
  configJson: Record<string, unknown>,
): Promise<CompileFeedback> {
  try {
    return await withCREWorkspace(
      {
        prefix: "ciel-compile",
        code,
        configJson,
        semaphore: compileSemaphore,
      },
      async (cwd, env) => {
        // Run CRE workflow simulate — the compile phase runs first
        // If compilation fails, the CLI exits with non-zero before execution
        const result = await runCommand(
          [config.CRE_CLI_PATH, "workflow", "simulate", WF_SUBDIR, "--non-interactive", "--trigger-index", "0", "--target", "staging-settings"],
          cwd,
          env,
          COMPILE_TIMEOUT_MS,
          "compile-check",
        )

        const rawOutput = (result.stdout + "\n" + result.stderr).slice(0, MAX_RAW_OUTPUT)
        const compiled = rawOutput.includes("Workflow compiled")

        if (compiled) {
          log.debug("Compilation check passed")
          return { compiled: true, errors: [], rawOutput }
        }

        // Parse errors from compiler output
        const errors = parseCompileErrors(rawOutput)

        if (result.timedOut) {
          log.info("Compilation check timed out")
          return {
            compiled: false,
            errors: errors.length > 0 ? errors : ["Compilation timed out"],
            rawOutput,
          }
        }

        log.info(`Compilation check failed: ${errors.length} errors`)
        return {
          compiled: false,
          errors: errors.length > 0 ? errors : ["Compilation failed (no specific errors parsed)"],
          rawOutput,
        }
      },
    )
  } catch (err) {
    // Never throw — gracefully degrade
    const message = err instanceof Error ? err.message : String(err)
    log.info(`Compilation check error (graceful): ${message}`)

    return {
      compiled: false,
      errors: [`Compilation check unavailable: ${message}`],
      rawOutput: "",
    }
  }
}

/** @internal Test-only: expose semaphore state */
export function _getCompileState(): { activeCount: number; queueLength: number } {
  return compileSemaphore._getState()
}
