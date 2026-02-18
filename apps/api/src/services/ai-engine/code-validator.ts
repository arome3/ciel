// ─────────────────────────────────────────────
// Code Validator — Stage 4 of the AI Engine Pipeline
// ─────────────────────────────────────────────
// Static analysis of generated CRE TypeScript workflow code.
// Runs 6 constraint checks without executing the code.
// Pure functions — no I/O, no LLM calls, zero latency cost.

// ─────────────────────────────────────────────
// Public Interfaces
// ─────────────────────────────────────────────

export interface ValidationIssue {
  /** Which check failed */
  check: string
  /** Severity: "error" blocks deployment, "warning" is advisory */
  severity: "error" | "warning"
  /** Human-readable description of the violation */
  message: string
  /** Optional: the offending line or snippet */
  snippet?: string
}

export interface ValidationResult {
  /** true if zero errors (warnings are OK) */
  valid: boolean
  /** Total score out of 6 (number of checks passed) */
  score: number
  /** All issues found (errors + warnings) */
  issues: ValidationIssue[]
}

// ─────────────────────────────────────────────
// Allowed Import Whitelist
// ─────────────────────────────────────────────

const ALLOWED_IMPORT_SOURCES = new Set([
  "@chainlink/cre-sdk",
  "zod",
  "viem",
  "viem/abi",
  "viem/chains",
  "viem/utils",
])

// ─────────────────────────────────────────────
// Individual Check Functions
// ─────────────────────────────────────────────

/**
 * Check 1: Import Whitelist
 * Only @chainlink/cre-sdk, zod, and viem (+ subpaths) are allowed.
 */
function checkImports(code: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  // Match all import ... from "..." and import "..." statements
  const importRegex = /import\s+(?:.*?\s+from\s+)?["']([^"']+)["']/g
  let match: RegExpExecArray | null

  while ((match = importRegex.exec(code)) !== null) {
    const source = match[1]

    // Allow relative imports (unlikely but not a constraint violation)
    if (source.startsWith(".") || source.startsWith("/")) {
      continue
    }

    // Check against whitelist (exact match or subpath)
    const isAllowed =
      ALLOWED_IMPORT_SOURCES.has(source) ||
      source.startsWith("viem/")

    if (!isAllowed) {
      issues.push({
        check: "import-whitelist",
        severity: "error",
        message: `Unauthorized import: "${source}". Only @chainlink/cre-sdk, zod, and viem are allowed.`,
        snippet: match[0],
      })
    }
  }

  return issues
}

/**
 * Check 2: No async/await in handler callbacks
 * The CRE runtime uses synchronous .result() unwrapping.
 * async/await at the top level (outside handler) is a warning, not error.
 */
function checkNoAsyncInHandlers(code: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  // Find handler(...) callback bodies
  // Strategy: locate handler( calls, then scan for async/await within the
  // callback argument. Since we can't fully parse TS, we use a heuristic:
  // look for `handler(trigger, async` or `async (rt)` patterns near handler.
  const asyncHandlerPattern = /handler\s*\([^,]+,\s*async\s/g
  let match: RegExpExecArray | null

  while ((match = asyncHandlerPattern.exec(code)) !== null) {
    issues.push({
      check: "no-async-handlers",
      severity: "error",
      message: "handler() callback must not be async. Use .result() for synchronous unwrapping instead of await.",
      snippet: match[0].trim(),
    })
  }

  // Also catch await inside handler blocks (broader heuristic)
  // Find all handler( blocks and check for await within them
  const handlerBlocks = extractHandlerBlocks(code)
  for (const block of handlerBlocks) {
    const awaitMatch = /\bawait\s+/g.exec(block.content)
    if (awaitMatch) {
      issues.push({
        check: "no-async-handlers",
        severity: "error",
        message: "Found 'await' inside handler callback. CRE handlers are synchronous — use .result() instead.",
        snippet: awaitMatch[0] + block.content.slice(awaitMatch.index + awaitMatch[0].length, awaitMatch.index + awaitMatch[0].length + 40).split("\n")[0],
      })
    }
  }

  return issues
}

/**
 * Check 3: Runner.newRunner pattern
 * Must use Runner.newRunner<Config>({ configSchema }) somewhere.
 */
function checkRunnerPattern(code: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  const hasRunner = /Runner\.newRunner\s*[<(]/i.test(code)
  if (!hasRunner) {
    issues.push({
      check: "runner-pattern",
      severity: "error",
      message: "Missing Runner.newRunner<Config>({ configSchema }) pattern. Every CRE workflow must create a Runner instance.",
    })
  }

  // Also check for configSchema definition
  const hasConfigSchema = /const\s+configSchema\s*=\s*z\./i.test(code)
  if (!hasConfigSchema) {
    issues.push({
      check: "runner-pattern",
      severity: "warning",
      message: "Missing Zod configSchema definition. Expected: const configSchema = z.object({...})",
    })
  }

  return issues
}

/**
 * Check 4: export main()
 * CRE workflows must export a main() function as the entry point.
 */
function checkExportMain(code: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  // Match: export function main() or export const main =
  const hasExportMain =
    /export\s+function\s+main\s*\(/i.test(code) ||
    /export\s+(?:const|let)\s+main\s*=/i.test(code)

  if (!hasExportMain) {
    issues.push({
      check: "export-main",
      severity: "error",
      message: "Missing 'export function main()'. CRE workflows must export a main() entry point that calls runner.run().",
    })
  }

  return issues
}

/**
 * Check 5: handler() wiring
 * At least one handler(trigger, callback) call must be present.
 */
function checkHandlerWiring(code: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  const hasHandler = /\bhandler\s*\(/i.test(code)
  if (!hasHandler) {
    issues.push({
      check: "handler-wiring",
      severity: "error",
      message: "Missing handler(trigger, callback) call. CRE workflows must wire at least one trigger to a handler.",
    })
  }

  return issues
}

/**
 * Check 6: runtime.config usage (not getConfig)
 * Config must be accessed via runtime.config.* (typed generics),
 * NOT runtime.getConfig() which is the old API.
 */
function checkConfigAccess(code: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  // Flag getConfig() usage
  const getConfigPattern = /(?:runtime|rt)\.getConfig\s*\(/g
  let match: RegExpExecArray | null

  while ((match = getConfigPattern.exec(code)) !== null) {
    issues.push({
      check: "config-access",
      severity: "error",
      message: "Uses deprecated runtime.getConfig(). Access config via runtime.config.propertyName (typed via Zod schema).",
      snippet: match[0],
    })
  }

  // Verify that runtime.config or rt.config IS used (positive check)
  const usesTypedConfig = /(?:runtime|rt)\.config\./i.test(code)
  if (!usesTypedConfig) {
    // Only a warning — some very simple workflows may not read config
    issues.push({
      check: "config-access",
      severity: "warning",
      message: "No runtime.config.* access found. Most workflows should read config values via the typed runtime.config object.",
    })
  }

  return issues
}

// ─────────────────────────────────────────────
// Helper: Extract Handler Callback Bodies
// ─────────────────────────────────────────────

interface HandlerBlock {
  content: string
}

/**
 * Extracts the callback body from handler(trigger, (rt) => { ... }) calls.
 * Uses brace-counting to find the closing brace of the callback.
 */
function extractHandlerBlocks(code: string): HandlerBlock[] {
  const blocks: HandlerBlock[] = []
  const handlerCallPattern = /handler\s*\([^,]+,\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_$]\w*)\s*=>\s*\{/g
  let match: RegExpExecArray | null

  while ((match = handlerCallPattern.exec(code)) !== null) {
    const startIdx = match.index + match[0].length - 1 // position of opening {
    let depth = 1
    let i = startIdx + 1

    while (i < code.length && depth > 0) {
      if (code[i] === "{") depth++
      else if (code[i] === "}") depth--
      i++
    }

    if (depth === 0) {
      blocks.push({ content: code.slice(startIdx, i) })
    }
  }

  return blocks
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * Validates generated CRE TypeScript workflow code against 6 constraints.
 *
 * Checks:
 * 1. Import whitelist — only @chainlink/cre-sdk, zod, viem
 * 2. No async/await in handler callbacks
 * 3. Runner.newRunner pattern present
 * 4. export main() present
 * 5. handler() wiring present
 * 6. runtime.config access (not getConfig)
 *
 * Pure static analysis — no execution, no I/O.
 *
 * @param code - The generated TypeScript workflow code
 * @returns ValidationResult with pass/fail, score, and detailed issues
 */
export function validateWorkflow(code: string): ValidationResult {
  const allChecks = [
    checkImports,
    checkNoAsyncInHandlers,
    checkRunnerPattern,
    checkExportMain,
    checkHandlerWiring,
    checkConfigAccess,
  ]

  const allIssues: ValidationIssue[] = []

  for (const check of allChecks) {
    const issues = check(code)
    allIssues.push(...issues)
  }

  // Score: count how many of the 6 checks have ZERO errors
  const checkNames = [
    "import-whitelist",
    "no-async-handlers",
    "runner-pattern",
    "export-main",
    "handler-wiring",
    "config-access",
  ]

  const errorsByCheck = new Set(
    allIssues
      .filter((i) => i.severity === "error")
      .map((i) => i.check),
  )

  const score = checkNames.filter((name) => !errorsByCheck.has(name)).length

  return {
    valid: errorsByCheck.size === 0,
    score,
    issues: allIssues,
  }
}
