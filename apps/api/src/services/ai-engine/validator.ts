// ─────────────────────────────────────────────
// Validator — Stage 4 of the AI Engine Pipeline (Enhanced)
// ─────────────────────────────────────────────
// 6-point validation with cheap-first ordering:
//   Phase 1 (instant): Import check, async check, main export, zod schema, config JSON
//   Phase 2 (expensive): TypeScript compilation via bunx tsc (only if Phase 1 passes)
//
// Also provides quickFix() — deterministic auto-repair inspired by Vercel v0's
// AutoFix pattern. Fixes predictable LLM mistakes without burning an LLM retry.

import { mkdtemp, writeFile, rm } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"
import type { ParsedIntent } from "./types"
import type { TemplateDefinition } from "./template-matcher"

// ─────────────────────────────────────────────
// Public Interfaces
// ─────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean
  errors: string[] // Structured errors with [CATEGORY] prefix
}

// ─────────────────────────────────────────────
// quickFix — Deterministic Auto-Repair
// ─────────────────────────────────────────────

// Forbidden packages for both ESM import and CJS require
const FORBIDDEN_PACKAGES = "ethers|web3|axios|node-fetch|fs|path|child_process"

// ESM: import X from "pkg" / import { X } from "pkg" / import "pkg"
const FORBIDDEN_ESM_PATTERN = new RegExp(
  `^import\\s+(?:.*?\\s+from\\s+)?["'](${FORBIDDEN_PACKAGES})["'].*$`,
  "gm",
)

// CJS: require("pkg") / require('pkg')
const FORBIDDEN_CJS_PATTERN = new RegExp(
  `^.*\\brequire\\s*\\(\\s*["'](${FORBIDDEN_PACKAGES})["']\\s*\\).*$`,
  "gm",
)

/**
 * Applies safe, deterministic fixes to common LLM mistakes BEFORE validation.
 * Inspired by Vercel v0's AutoFix — prevents unnecessary LLM retries.
 *
 * Fixes applied:
 * 1. Remove known-forbidden import/require lines (ESM and CJS)
 * 2. Strip `async` from handler callbacks AND replace `await expr` → `expr` in handler bodies
 * 3. Add missing `export` to `function main(`
 */
export function quickFix(code: string): { code: string; fixes: string[] } {
  const fixes: string[] = []
  let fixed = code

  // 1. Remove forbidden ESM imports
  const esmMatches = fixed.match(FORBIDDEN_ESM_PATTERN)
  if (esmMatches) {
    for (const match of esmMatches) {
      const src = match.match(/["']([^"']+)["']/)?.[1]
      fixes.push(`Removed import '${src}'`)
    }
    fixed = fixed.replace(FORBIDDEN_ESM_PATTERN, "")
  }

  // 1b. Remove forbidden CJS requires
  const cjsMatches = fixed.match(FORBIDDEN_CJS_PATTERN)
  if (cjsMatches) {
    for (const match of cjsMatches) {
      const src = match.match(/require\s*\(\s*["']([^"']+)["']/)?.[1]
      fixes.push(`Removed require('${src}')`)
    }
    fixed = fixed.replace(FORBIDDEN_CJS_PATTERN, "")
  }

  // Clean up blank lines left by removals
  if (esmMatches || cjsMatches) {
    fixed = fixed.replace(/\n{3,}/g, "\n\n")
  }

  // 2. Strip async from handler callbacks (parameter-name agnostic)
  //    Matches: handler(anyTrigger, async (anyParam) => { ... })
  //    Also:    handler(anyTrigger, async function(anyParam) { ... })
  //    Also:    cre.handler(anyTrigger, async ...) — official SDK pattern
  const handlerAsyncPattern = /(?:cre\.)?handler\s*\([^,]+,\s*async\s+/g
  if (handlerAsyncPattern.test(fixed)) {
    fixed = fixed.replace(
      /((?:cre\.)?handler\s*\()([^,]+),\s*async\s+/g,
      "$1$2, ",
    )
    fixes.push("Stripped async from handler callback")

    // 2b. Replace `await expr` → `expr` inside handler blocks.
    // After stripping async, any remaining await is a syntax error.
    // We use brace-counting to find handler callback bodies and strip await within them.
    const beforeAwaitStrip = fixed
    fixed = stripAwaitInHandlerBlocks(fixed)
    if (fixed !== beforeAwaitStrip) {
      fixes.push("Removed await keywords from handler callback body")
    }
  }

  // 3. Add missing export to function main(
  if (!/\bexport\s+(?:async\s+)?function\s+main\s*\(/.test(fixed) &&
      /\bfunction\s+main\s*\(/.test(fixed)) {
    fixed = fixed.replace(
      /\bfunction\s+main\s*\(/,
      "export function main(",
    )
    fixes.push("Added missing export to function main")
  }

  // 4. Replace Date.now() → runtime.now().getTime() inside handler blocks
  if (/\bDate\.now\s*\(\s*\)/.test(fixed)) {
    const ranges = findHandlerBlockRanges(fixed)
    if (ranges.length > 0) {
      let result = fixed
      let offset = 0
      for (const range of ranges) {
        const block = fixed.slice(range.start, range.end)
        const replaced = block.replace(/\bDate\.now\s*\(\s*\)/g, "runtime.now().getTime()")
        if (replaced !== block) {
          result = result.slice(0, range.start + offset) + replaced + result.slice(range.start + offset + block.length)
          offset += replaced.length - block.length
        }
      }
      if (result !== fixed) {
        fixed = result
        fixes.push("Replaced Date.now() with runtime.now().getTime() in handler blocks")
      }
    }
  }

  // 5. Replace new Date() → runtime.now() inside handler blocks
  if (/\bnew\s+Date\s*\(\s*\)/.test(fixed)) {
    const ranges = findHandlerBlockRanges(fixed)
    if (ranges.length > 0) {
      let result = fixed
      let offset = 0
      for (const range of ranges) {
        const block = fixed.slice(range.start, range.end)
        const replaced = block.replace(/\bnew\s+Date\s*\(\s*\)/g, "runtime.now()")
        if (replaced !== block) {
          result = result.slice(0, range.start + offset) + replaced + result.slice(range.start + offset + block.length)
          offset += replaced.length - block.length
        }
      }
      if (result !== fixed) {
        fixed = result
        fixes.push("Replaced new Date() with runtime.now() in handler blocks")
      }
    }
  }

  // 6. Replace Math.random() → 0 with FIXME comment inside handler blocks
  if (/\bMath\.random\s*\(\s*\)/.test(fixed)) {
    const ranges = findHandlerBlockRanges(fixed)
    if (ranges.length > 0) {
      let result = fixed
      let offset = 0
      for (const range of ranges) {
        const block = fixed.slice(range.start, range.end)
        const replaced = block.replace(/\bMath\.random\s*\(\s*\)/g, "0 /* FIXME: use deterministic logic */")
        if (replaced !== block) {
          result = result.slice(0, range.start + offset) + replaced + result.slice(range.start + offset + block.length)
          offset += replaced.length - block.length
        }
      }
      if (result !== fixed) {
        fixed = result
        fixes.push("Replaced Math.random() with deterministic placeholder in handler blocks")
      }
    }
  }

  // 7. Remove setTimeout() / setInterval() calls inside handler blocks
  if (/\b(?:setTimeout|setInterval)\s*\(/.test(fixed)) {
    const ranges = findHandlerBlockRanges(fixed)
    if (ranges.length > 0) {
      let result = fixed
      let offset = 0
      for (const range of ranges) {
        const block = fixed.slice(range.start, range.end)
        const replaced = block.replace(
          /\b(setTimeout|setInterval)\s*\([^)]*(?:\([^)]*\)[^)]*)*\)[^;\n]*/g,
          "/* $1 removed — not available in CRE runtime */",
        )
        if (replaced !== block) {
          result = result.slice(0, range.start + offset) + replaced + result.slice(range.start + offset + block.length)
          offset += replaced.length - block.length
        }
      }
      if (result !== fixed) {
        fixed = result
        fixes.push("Removed setTimeout/setInterval from handler blocks (not available in CRE runtime)")
      }
    }
  }

  return { code: fixed, fixes }
}

/**
 * Finds handler callback block ranges using brace-counting.
 * Matches both arrow functions and function expressions:
 *   handler(trigger, (rt) => { ... })
 *   handler(trigger, function(rt) { ... })
 */
function findHandlerBlockRanges(code: string): Array<{ start: number; end: number }> {
  const pattern = /(?:cre\.)?handler\s*\([^,]+,\s*(?:(?:\([^)]*\)|[a-zA-Z_$]\w*)\s*=>\s*\{|function\s*\([^)]*\)\s*\{)/g
  const ranges: Array<{ start: number; end: number }> = []
  let match: RegExpExecArray | null

  while ((match = pattern.exec(code)) !== null) {
    const blockStart = match.index + match[0].length - 1 // opening {
    let depth = 1
    let i = blockStart + 1

    while (i < code.length && depth > 0) {
      if (code[i] === "{") depth++
      else if (code[i] === "}") depth--
      i++
    }

    if (depth === 0) {
      ranges.push({ start: blockStart, end: i })
    }
  }
  return ranges
}

/**
 * Strips `await` keywords from inside handler callback blocks.
 * Uses brace-counting to identify handler callback bodies.
 */
function stripAwaitInHandlerBlocks(code: string): string {
  const ranges = findHandlerBlockRanges(code)
  let result = code
  let offset = 0

  for (const range of ranges) {
    const blockContent = code.slice(range.start, range.end)
    const cleaned = blockContent.replace(/\bawait\s+/g, "")
    if (cleaned !== blockContent) {
      result = result.slice(0, range.start + offset) + cleaned + result.slice(range.start + offset + blockContent.length)
      offset += cleaned.length - blockContent.length
    }
  }

  return result
}

// ─────────────────────────────────────────────
// Validation Checks
// ─────────────────────────────────────────────

/**
 * (a) CRE Import Check — only allowed imports pass.
 *     Catches both ESM import and CJS require().
 */
function checkImports(code: string): string[] {
  const errors: string[] = []

  // ESM imports: import X from "pkg" / import { X } from "pkg" / import "pkg"
  const importRegex = /import\s+(?:.*?\s+from\s+)?["']([^"']+)["']/g
  let match: RegExpExecArray | null

  while ((match = importRegex.exec(code)) !== null) {
    const source = match[1]
    if (source.startsWith(".") || source.startsWith("/")) continue
    if (isAllowedImport(source)) continue

    errors.push(
      `[IMPORT] Disallowed import "${source}". REMOVE this import. Only @chainlink/cre-sdk, zod, viem, and @noble/hashes are allowed.`,
    )
  }

  // CJS requires: require("pkg") / require('pkg')
  const requireRegex = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g
  while ((match = requireRegex.exec(code)) !== null) {
    const source = match[1]
    if (source.startsWith(".") || source.startsWith("/")) continue
    if (isAllowedImport(source)) continue

    errors.push(
      `[IMPORT] Disallowed require("${source}"). REMOVE this require. Only @chainlink/cre-sdk, zod, viem, and @noble/hashes are allowed.`,
    )
  }

  return errors
}

function isAllowedImport(source: string): boolean {
  return (
    source === "@chainlink/cre-sdk" ||
    source.startsWith("@chainlink/cre-sdk/") ||
    source === "zod" ||
    source === "viem" ||
    source.startsWith("viem/") ||
    source === "@noble/hashes" ||
    source.startsWith("@noble/hashes/")
  )
}

/**
 * (b) No Async Callbacks — handler callbacks must be synchronous.
 *     Parameter-name agnostic: matches `handler(X, async` regardless of callback param name.
 *     Also detects .then(async ...) patterns.
 */
function checkNoAsyncCallbacks(code: string): string[] {
  const errors: string[] = []

  // Pattern 1 (primary): handler(trigger, async ...) — catches arrow functions and function expressions
  // Also matches cre.handler(trigger, async ...) — official SDK pattern
  const handlerAsyncPattern = /(?:cre\.)?handler\s*\([^,]+,\s*async\s/g
  let match: RegExpExecArray | null
  while ((match = handlerAsyncPattern.exec(code)) !== null) {
    errors.push(
      `[ASYNC] handler() callback must not be async (at position ${match.index}). REMOVE the async keyword. Use .result() for synchronous unwrapping.`,
    )
  }

  // Pattern 2: .then(async ...) pattern
  if (/\.then\s*\(\s*async\s/.test(code)) {
    errors.push(
      "[ASYNC] Found .then(async ...) pattern. REMOVE async from .then() callbacks. CRE uses synchronous .result() unwrapping.",
    )
  }

  // Pattern 3: Detect `await` inside handler blocks (even without explicit `async`)
  // Uses shared findHandlerBlockRanges to avoid duplicating brace-counting logic.
  const ranges = findHandlerBlockRanges(code)
  for (const range of ranges) {
    const blockContent = code.slice(range.start, range.end)
    if (/\bawait\s+/.test(blockContent)) {
      errors.push(
        `[ASYNC] Found 'await' inside handler callback (near position ${range.start}). REMOVE await and use .result() instead.`,
      )
    }
  }

  return errors
}

/**
 * (c) main() Export — must have export [async] function main(
 */
function checkMainExport(code: string): string[] {
  if (/export\s+(?:async\s+)?function\s+main\s*\(/.test(code)) {
    return []
  }
  return [
    "[MAIN] Missing 'export function main()'. ADD 'export' before function main(). CRE workflows require an exported main() entry point.",
  ]
}

/**
 * (d) Zod configSchema — must define configSchema using z.object(
 *     Checks for the assignment pattern, not just a bare z.object( in a comment.
 */
function checkZodSchema(code: string): string[] {
  // Require explicit: configSchema = z.object( (with const/let/var prefix)
  // No loose fallback — the LLM is instructed to use this exact pattern.
  if (/(?:const|let|var)\s+configSchema\s*=\s*z\.object\s*\(/.test(code)) {
    return []
  }
  return [
    "[ZOD] Missing Zod configSchema (z.object(...)). ADD `const configSchema = z.object({...})` for typed config validation.",
  ]
}

/**
 * (f) Config JSON Validity — validates JSON structure and config-code consistency.
 *     Checks:
 *     - Valid JSON object
 *     - EVM operations have chain config
 *     - CronCapability usage has cronSchedule
 *     - HTTPClient usage has a URL-like field
 */
function checkConfigJson(code: string, configJson: string): string[] {
  const errors: string[] = []

  let parsed: unknown
  try {
    parsed = JSON.parse(configJson)
  } catch {
    errors.push(
      "[CONFIG] Config JSON is not valid JSON. FIX the JSON syntax.",
    )
    return errors
  }

  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    errors.push(
      "[CONFIG] Config JSON must be a non-null, non-array object.",
    )
    return errors
  }

  const obj = parsed as Record<string, unknown>
  const configKeys = Object.keys(obj)
  const configValues = Object.values(obj).map(String)

  // EVM operations need chain config
  if (/[eE][vV][mM]Client\.(?:callContract|writeReport|sendTransaction)|evmWrite/.test(code)) {
    const hasChainConfig = configKeys.some((k) =>
      /chain|evm|consumer/i.test(k),
    )
    if (!hasChainConfig) {
      errors.push(
        "[CONFIG] Code uses EVMClient but config has no chain configuration. ADD a chain-related field (chainSelector, chainName, consumerContract, etc.).",
      )
    }
  }

  // Cron trigger needs schedule in config
  if (/CronCapability|CronTrigger|cronTrigger/.test(code)) {
    const hasCronConfig = configKeys.some((k) =>
      /cron|schedule/i.test(k),
    )
    if (!hasCronConfig) {
      errors.push(
        "[CONFIG] Code uses CronCapability but config has no schedule field. ADD schedule (or cronSchedule) to the config.",
      )
    }
  }

  // HTTPClient usage should have at least one URL-like value
  if (/HTTPClient|httpClient|http\.fetch/.test(code)) {
    const hasUrlConfig = configValues.some((v) =>
      /^https?:\/\//.test(v),
    ) || configKeys.some((k) => /url|endpoint|api/i.test(k))
    if (!hasUrlConfig) {
      errors.push(
        "[CONFIG] Code uses HTTPClient but config has no URL field. ADD an API endpoint URL to the config.",
      )
    }
  }

  return errors
}

/**
 * (g) State Pattern Check — KV store access must use ConfidentialHTTPClient.
 *     If config has a non-empty kvStoreUrl, the code MUST reference ConfidentialHTTPClient.
 */
function checkStatePatterns(code: string, configJson: string): string[] {
  const errors: string[] = []

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(configJson) as Record<string, unknown>
  } catch {
    return errors  // Invalid JSON caught by checkConfigJson
  }

  const kvStoreUrl = parsed.kvStoreUrl
  if (typeof kvStoreUrl === "string" && kvStoreUrl.length > 0) {
    if (!/new\s+ConfidentialHTTPClient\s*\(/.test(code)) {
      errors.push(
        "[STATE] Config includes kvStoreUrl but code does not use ConfidentialHTTPClient. " +
        "KV store access MUST use ConfidentialHTTPClient (not HTTPClient) to protect API keys across DON nodes. " +
        "REPLACE the HTTPClient used for KV access with ConfidentialHTTPClient.",
      )
    }
  }

  return errors
}

/**
 * (h) Non-Determinism Check — patterns that break BFT consensus on DON nodes.
 *     CRE DON nodes must produce identical output. Non-deterministic calls
 *     (Date.now, Math.random, etc.) cause consensus failure.
 */
function checkNonDeterminism(code: string): string[] {
  const errors: string[] = []

  // Date.now() — different value on each node
  if (/\bDate\.now\s*\(\s*\)/.test(code)) {
    errors.push(
      "[NONDET] Found Date.now() which breaks BFT consensus — each DON node produces a different timestamp. REPLACE with runtime.now().getTime() for consensus-safe milliseconds.",
    )
  }

  // new Date() without args — same issue
  if (/\bnew\s+Date\s*\(\s*\)/.test(code)) {
    errors.push(
      "[NONDET] Found new Date() which breaks BFT consensus — each DON node produces a different timestamp. REPLACE with runtime.now() for a consensus-safe Date object.",
    )
  }

  // Math.random() — no deterministic alternative in CRE
  if (/\bMath\.random\s*\(\s*\)/.test(code)) {
    errors.push(
      "[NONDET] Found Math.random() which breaks BFT consensus — each DON node produces a different value. REMOVE or use deterministic logic (e.g., hash-based PRNG).",
    )
  }

  // Promise.race() — result depends on timing, non-deterministic across nodes
  if (/\bPromise\.race\s*\(/.test(code)) {
    errors.push(
      "[NONDET] Found Promise.race() which may produce different results across DON nodes. REPLACE with Promise.all() or sequential execution.",
    )
  }

  // Promise.any() — same issue
  if (/\bPromise\.any\s*\(/.test(code)) {
    errors.push(
      "[NONDET] Found Promise.any() which may produce different results across DON nodes. REPLACE with Promise.all() or sequential execution.",
    )
  }

  // setTimeout / setInterval — not available in CRE runtime
  if (/\bsetTimeout\s*\(/.test(code)) {
    errors.push(
      "[NONDET] Found setTimeout() which is not available in the CRE runtime. REMOVE — CRE workflows execute synchronously within handlers.",
    )
  }

  if (/\bsetInterval\s*\(/.test(code)) {
    errors.push(
      "[NONDET] Found setInterval() which is not available in the CRE runtime. REMOVE — use CronCapability for scheduled execution.",
    )
  }

  return errors
}

/**
 * (j) Intent Alignment — verifies generated code implements what the user asked.
 *     Checks trigger type, actions, and data source alignment.
 *     Only runs when intent and templateDef are provided (backward compatible).
 */
function checkIntentAlignment(
  code: string,
  intent: ParsedIntent,
  templateDef: TemplateDefinition,
): string[] {
  // Skip alignment when intent confidence is too low — the parser couldn't
  // meaningfully understand the prompt, so alignment checks would be noise
  if (intent.confidence < 0.3) return []

  const errors: string[] = []

  // Trigger type alignment
  const triggerChecks: Record<string, RegExp> = {
    cron: /CronCapability|CronTrigger|cronTrigger|cron\.trigger/,
    http: /HTTPCapability|HTTPTrigger|httpTrigger|http\.trigger|HTTPCapability/,
    evm_log: /logTrigger|EVMLog|evmLogTrigger|EVMLogCapability/,
  }

  const expectedTrigger = templateDef.triggerType
  const triggerPattern = triggerChecks[expectedTrigger]
  if (triggerPattern && !triggerPattern.test(code)) {
    errors.push(
      `[ALIGN] Expected ${expectedTrigger} trigger (template ${templateDef.id}: ${templateDef.name}) ` +
      `but code does not contain the corresponding capability. ` +
      `ADD ${expectedTrigger === "cron" ? "CronCapability" : expectedTrigger === "http" ? "HTTPCapability" : "EVMLogCapability/logTrigger"} usage.`,
    )
  }

  // Action alignment — check that key actions from the intent appear in code
  const actionPatterns: Record<string, RegExp> = {
    dexSwap: /swap|exactInput|exactOutput|uniswap|routerAddr/i,
    evmWrite: /writeReport|sendTransaction|evmClient/i,
    alert: /alert|webhook|notify|slack|telegram/i,
    transfer: /transfer|send|ERC20/i,
    mint: /mint/i,
    burn: /burn/i,
    rebalance: /rebalance|swap|allocation/i,
    payout: /payout|distribute|transfer/i,
    ccipTransfer: /ccip|crossChain|cross.chain/i,
    escrowLock: /escrow|lock/i,
    escrowRelease: /escrow|release/i,
    initiatePayment: /payment|initiate|settle/i,
    distribute: /distribute|dividend|pro.rata/i,
  }

  for (const action of intent.actions) {
    const pattern = actionPatterns[action]
    if (pattern && !pattern.test(code)) {
      errors.push(
        `[ALIGN] Intent requires action "${action}" but code does not appear to implement it. ` +
        `ADD ${action}-related logic to the workflow.`,
      )
    }
  }

  // Data source alignment — HTTP data sources should have HTTPClient
  const httpDataSources = intent.dataSources.filter((ds) =>
    !["chainlink-feeds", "kv-store"].includes(ds),
  )
  if (httpDataSources.length > 0 && !/HTTPClient|httpClient|sendRequest|fetch/.test(code)) {
    errors.push(
      `[ALIGN] Intent requires data sources [${httpDataSources.join(", ")}] which need HTTP access, ` +
      `but code does not use HTTPClient. ADD HTTPClient to fetch data from external APIs.`,
    )
  }

  return errors
}

/**
 * (i) Config-Code Consistency — cross-references runtime.config.X in code
 *     with keys in the config JSON object.
 */
function checkConfigCodeConsistency(code: string, configJson: string): string[] {
  let configKeys: string[]
  try {
    const parsed = JSON.parse(configJson)
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return []
    configKeys = Object.keys(parsed as Record<string, unknown>)
  } catch {
    return [] // Invalid JSON caught by checkConfigJson
  }

  const errors: string[] = []
  const configKeySet = new Set(configKeys)

  // Extract runtime.config.X and config.X references from code
  // Matches: runtime.config.fieldName, config.fieldName (inside initWorkflow)
  const configRefPattern = /(?:runtime\.config|config)\.([a-zA-Z_$]\w*)/g
  const referencedFields = new Set<string>()
  let match: RegExpExecArray | null
  while ((match = configRefPattern.exec(code)) !== null) {
    referencedFields.add(match[1])
  }

  // Find fields referenced in code but missing from config JSON
  const missingFields: string[] = []
  for (const field of referencedFields) {
    if (!configKeySet.has(field)) {
      missingFields.push(field)
    }
  }

  if (missingFields.length > 0) {
    errors.push(
      `[CONFIG_MISMATCH] Code references config fields not in config JSON: ${missingFields.join(", ")}. ` +
      `Available config fields: ${configKeys.join(", ")}. ` +
      `ADD the missing fields to config JSON or FIX the field names in code.`,
    )
  }

  return errors
}

// ─────────────────────────────────────────────
// TypeScript Compilation Check
// ─────────────────────────────────────────────

/** CRE SDK stub with real types — catches incorrect API usage, not just syntax errors */
const CRE_SDK_STUB = `
declare module "@chainlink/cre-sdk" {
  /** Response wrapper returned by CRE capability calls (.fetch, .callContract, etc.) */
  interface CREResponse<T = string> {
    result(): T;
  }

  interface HTTPResponse {
    body: string;
    statusCode: number;
    headers: Record<string, string>;
  }

  interface EVMResponse {
    data: string;
    success: boolean;
  }

  /** CronPayload — payload passed to cron handler callbacks */
  interface CronPayload {
    scheduledExecutionTime: string;
  }

  /** EVMLog — log data passed as second param to handler callback for EVMLogTrigger */
  interface EVMLog {
    topics: Uint8Array[];
    data: Uint8Array;
    address?: string;
    blockNumber?: number;
    transactionHash?: string;
  }

  /** NetworkInfo — returned by getNetwork() */
  interface NetworkInfo {
    chainSelector: { selector: string };
    chainFamily: string;
    chainSelectorName: string;
  }

  /** ReportOpts — options for runtime.report() */
  interface ReportOpts {
    encodedPayload: string;
    encoderName?: string;
    signingAlgo?: string;
    hashingAlgo?: string;
  }

  /** ReportResponse — returned by runtime.report() */
  interface ReportResponse {
    report: string;
  }

  /** GasConfig — used in writeReport */
  interface GasConfig {
    gasLimit?: number;
  }

  /** WriteReportOpts — options for evmClient.writeReport() (official pattern) */
  interface WriteReportOpts {
    receiver: string;
    report: string | ReportResponse | CREResponse<ReportResponse>;
    gasConfig?: GasConfig;
  }

  /** TxStatus enum */
  export enum TxStatus {
    SUCCESS = "SUCCESS",
    FAILED = "FAILED",
    PENDING = "PENDING",
  }

  /** ConfidenceLevel — block finality for contract reads */
  export enum ConfidenceLevel {
    FINALIZED = "finalized",
    SAFE = "safe",
    LATEST = "latest",
  }

  /** LAST_FINALIZED_BLOCK_NUMBER constant for contract reads */
  export const LAST_FINALIZED_BLOCK_NUMBER: string;

  interface EVMCallContractOpts {
    contractAddress?: string;
    calldata?: string;
    callData?: string;
    chainSelector?: string;
    call?: any;
    blockNumber?: string | ConfidenceLevel;
  }

  interface EVMWriteReportOpts {
    reportData?: string;
    report?: string;
    consumerAddress?: string;
    contractAddress?: string;
    chainSelector?: string;
    chainSelectorName?: string;
  }

  interface CacheSettings {
    maxAge?: number;
    staleWhileRevalidate?: number;
  }

  interface FetchOpts {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    headers?: Record<string, string>;
    body?: string;
    cacheSettings?: CacheSettings;
  }

  interface CronTriggerOpts {
    schedule?: string;
    cronSchedule?: string;
  }

  interface HTTPTriggerOpts {
    method?: string;
    url?: string;
    authorizedKeys?: Array<{ type: string; publicKey: string }>;
  }

  interface ConsensusOpts {
    fields: string[];
    reportId: string;
  }

  /** The Runner bootstraps workflow registration */
  export class Runner {
    static newRunner<T>(opts: { configSchema: import("zod").ZodType }): Runner & PromiseLike<Runner>;
    run(fn: (runtime: Runtime<any>) => void): void | PromiseLike<void>;
    run(fn: (config: any) => any[]): void | PromiseLike<void>;
  }

  /** Runtime is the typed config accessor passed to handler callbacks */
  export class Runtime<T> {
    readonly config: T;
    getConfig(): T;
    getSecret(key: string): string;
    getSecret(opts: { id: string }): CREResponse<{ value: string }>;
    log(msg: string): void;
    /** Consensus-safe timestamp — identical across all DON nodes. NEVER use Date.now() or new Date(). */
    now(): Date;
    report(data: string): string;
    report(opts: ReportOpts): CREResponse<ReportResponse>;
    runInNodeMode<R>(callback: (nodeRuntime: Runtime<T>) => R): R;
    runInNodeMode<R>(callback: (nodeRuntime: NodeRuntime<T>) => R, consensus: any): () => CREResponse<R>;
  }

  /** NodeRuntime — individual node context inside runInNodeMode */
  export interface NodeRuntime<T> {
    getConfig(): T;
    getSecret(key: string): string;
    getSecret(opts: { id: string }): CREResponse<{ value: string }>;
  }

  /** Capability classes — these are the CRE SDK building blocks */
  export class CronCapability {
    trigger(opts: CronTriggerOpts): CronTrigger;
  }

  export class HTTPCapability {
    trigger(opts: HTTPTriggerOpts): HTTPTrigger;
  }

  export class EVMLogCapability {
    trigger(opts: { addresses?: string[]; topics?: string[]; contractAddress?: string; eventSignature?: string; chainSelector?: string }): EVMLogTrigger;
  }

  /** HTTPClient — synchronous .result() unwrapping (legacy pattern) */
  export class HTTPClient {
    fetch(url: string, opts?: FetchOpts): CREResponse<HTTPResponse>;
  }

  /** ConfidentialHTTPClient — same interface, secrets-safe */
  export class ConfidentialHTTPClient {
    fetch(url: string, opts?: FetchOpts): CREResponse<HTTPResponse>;
  }

  /** Resolves a chain name to a chain selector string (legacy) */
  export function getNetwork(chainName: string): string;
  /** Resolves chain info with structured opts (official) */
  export function getNetwork(opts: { chainFamily: string; chainSelectorName: string; isTestnet?: boolean }): NetworkInfo;

  /** Encode a call message for contract reads */
  export function encodeCallMsg(opts: { from: any; to: any; data: any }): any;

  /** Utility: convert bytes to hex string */
  export function bytesToHex(bytes: Uint8Array): string;

  /** Utility: convert hex to base64 string */
  export function hexToBase64(hex: string): string;

  /** Utility: extract text from HTTP response */
  export function text(response: any): string;

  /** Median function */
  export function median(values: number[]): number;

  /** EVMClient — on-chain interactions (legacy pattern, no constructor args) */
  export class EVMClient {
    constructor(chainSelector?: string);
    static callContract(opts: EVMCallContractOpts): CREResponse<EVMResponse>;
    static writeReport(opts: EVMWriteReportOpts): CREResponse<EVMResponse>;
    static sendTransaction(opts: EVMCallContractOpts): CREResponse<EVMResponse>;
    callContract(opts: EVMCallContractOpts): CREResponse<EVMResponse>;
    callContract(runtime: Runtime<any>, opts: EVMCallContractOpts): CREResponse<EVMResponse>;
    writeReport(opts: EVMWriteReportOpts): CREResponse<EVMResponse>;
    writeReport(runtime: Runtime<any>, opts: WriteReportOpts): CREResponse<EVMResponse>;
    sendTransaction(opts: { contractAddress?: string; chainSelector?: string; data?: string; value?: string; to?: string }): CREResponse<EVMResponse>;
    balanceAt(runtime: Runtime<any>, opts: { address: string; blockNumber?: string | ConfidenceLevel }): CREResponse<EVMResponse>;
    filterLogs(runtime: Runtime<any>, opts: { addresses?: string[]; topics?: string[][]; fromBlock?: string; toBlock?: string }): CREResponse<EVMResponse>;
    getTransactionByHash(runtime: Runtime<any>, opts: { txHash: string }): CREResponse<EVMResponse>;
    getTransactionReceipt(runtime: Runtime<any>, opts: { txHash: string }): CREResponse<EVMResponse>;
    headerByNumber(runtime: Runtime<any>, opts: { blockNumber?: string | ConfidenceLevel }): CREResponse<EVMResponse>;
    estimateGas(runtime: Runtime<any>, opts: { to?: string; data?: string; value?: string }): CREResponse<EVMResponse>;
    logTrigger(opts: { addresses?: string[]; topics?: string[] }): EVMLogTrigger;
  }

  /** cre namespace — official API for capabilities and handler wiring */
  export namespace cre {
    namespace capabilities {
      class CronCapability {
        trigger(opts: CronTriggerOpts): CronTrigger;
      }
      class HTTPCapability {
        trigger(opts?: HTTPTriggerOpts): HTTPTrigger;
      }
      class EVMLogCapability {
        trigger(opts: { addresses?: string[]; topics?: string[]; contractAddress?: string; eventSignature?: string; chainSelector?: string }): EVMLogTrigger;
      }
      class HTTPClient {
        sendRequest(runtime: NodeRuntime<any> | Runtime<any>, fetchFn: (...args: any[]) => any, consensusFn?: (...args: any[]) => any): (...args: any[]) => CREResponse<any>;
        sendRequest(runtime: NodeRuntime<any> | Runtime<any>, opts: { url: string; method?: string; headers?: Record<string, string>; body?: string }): CREResponse<HTTPResponse>;
        fetch(url: string, opts?: FetchOpts): CREResponse<HTTPResponse>;
      }
      class ConfidentialHTTPClient {
        sendRequest(runtime: NodeRuntime<any> | Runtime<any>, opts: { url: string; method?: string; headers?: Record<string, string>; body?: string }): CREResponse<HTTPResponse>;
        sendRequest(runtime: NodeRuntime<any> | Runtime<any>, fetchFn: (...args: any[]) => any, consensusFn?: (...args: any[]) => any): (...args: any[]) => CREResponse<any>;
        fetch(url: string, opts?: FetchOpts): CREResponse<HTTPResponse>;
      }
      class EVMClient {
        constructor(chainSelector?: string);
        callContract(runtime: Runtime<any>, opts: EVMCallContractOpts): CREResponse<EVMResponse>;
        writeReport(runtime: Runtime<any>, opts: WriteReportOpts | EVMWriteReportOpts): CREResponse<EVMResponse>;
        sendTransaction(runtime: Runtime<any>, opts: { contractAddress?: string; chainSelector?: string; data?: string; value?: string; to?: string }): CREResponse<EVMResponse>;
        balanceAt(runtime: Runtime<any>, opts: { address: string; blockNumber?: string | ConfidenceLevel }): CREResponse<EVMResponse>;
        filterLogs(runtime: Runtime<any>, opts: { addresses?: string[]; topics?: string[][]; fromBlock?: string; toBlock?: string }): CREResponse<EVMResponse>;
        getTransactionByHash(runtime: Runtime<any>, opts: { txHash: string }): CREResponse<EVMResponse>;
        getTransactionReceipt(runtime: Runtime<any>, opts: { txHash: string }): CREResponse<EVMResponse>;
        headerByNumber(runtime: Runtime<any>, opts: { blockNumber?: string | ConfidenceLevel }): CREResponse<EVMResponse>;
        estimateGas(runtime: Runtime<any>, opts: { to?: string; data?: string; value?: string }): CREResponse<EVMResponse>;
        logTrigger(opts: { addresses?: string[]; topics?: string[] }): EVMLogTrigger;
      }
    }
    function handler(trigger: CronTrigger | HTTPTrigger | EVMLogTrigger, callback: (runtime: Runtime<any>, triggerOutput: any) => any): any;
  }

  // Trigger types (returned by capability.trigger())
  interface CronTrigger { readonly __brand: "CronTrigger" }
  interface HTTPTrigger { readonly __brand: "HTTPTrigger" }
  interface EVMLogTrigger { readonly __brand: "EVMLogTrigger" }

  /** handler() wires a trigger to a synchronous callback (legacy pattern).
   *  Runtime<any> because the generic can't be inferred through triggers in stubs.
   *  The real SDK handles this via internal type wiring. */
  export function handler(
    trigger: CronTrigger | HTTPTrigger | EVMLogTrigger,
    callback: (runtime: Runtime<any>, triggerOutput: any) => Record<string, unknown> | string,
  ): void;

  /** HTTPPayload — payload passed to HTTP-triggered handler callbacks */
  interface HTTPPayload {
    input: Uint8Array;
    key?: { type: string; publicKey: string };
  }

  /** Decode JSON from Uint8Array payload (HTTP trigger) */
  export function decodeJson(data: Uint8Array): any;

  export type { EVMLog, CronPayload, HTTPPayload };

  /** Consensus functions */
  export function consensusMedianAggregation(opts: ConsensusOpts): void;
  export function consensusMedianAggregation(): any;
  export function consensusModeAggregation(opts: ConsensusOpts): void;
  export function consensusIdenticalAggregation(opts: ConsensusOpts): void;
  export function consensusIdenticalAggregation(): any;
  export function consensusMajorityVote(opts: ConsensusOpts): void;

  /** ConsensusAggregationByFields — per-field aggregation for complex objects */
  export function ConsensusAggregationByFields<T>(fields: { [K in keyof T]?: any }): any;

  export const StreamsLookup: {
    new(): { lookup(feedId: string): CREResponse<{ price: number; timestamp: number }> };
  };

  export type InferOutput<T> = T extends (...args: any[]) => infer R ? R : never;

  export function encodeAbiParameters(types: unknown, values: unknown[]): string;
  export function parseAbiParameters(params: string): unknown;
}

declare module "@chainlink/cre-sdk/triggers" {
  import type { CronCapability, HTTPCapability, EVMLogCapability } from "@chainlink/cre-sdk";
  export { CronCapability as CronTrigger };
  export { HTTPCapability as HTTPTrigger };
  export { EVMLogCapability as EVMLogTrigger };
  export const cronTrigger: CronCapability;
  export const httpTrigger: HTTPCapability;
  export const evmLogTrigger: EVMLogCapability;
  export const http: {
    trigger(): any;
  };
}

declare module "@noble/hashes/sha2" {
  export function sha256(data: Uint8Array): Uint8Array;
}

declare module "@noble/hashes/hmac" {
  export function hmac(hash: any, key: Uint8Array, data: Uint8Array): Uint8Array;
}

declare module "@noble/hashes/utils" {
  export function utf8ToBytes(str: string): Uint8Array;
  export function bytesToHex(bytes: Uint8Array): string;
}

declare module "@noble/hashes" {
  export * from "@noble/hashes/sha2";
}

declare module "zod" {
  interface ZodType<T = any> {
    parse(data: unknown): T;
    safeParse(data: unknown): { success: boolean; data?: T; error?: any };
    optional(): ZodType<T | undefined>;
    nullable(): ZodType<T | null>;
    default(val: T): ZodType<T>;
    describe(desc: string): ZodType<T>;
  }

  // var provides value-level methods (including reserved-word 'enum')
  var z: {
    object<T extends Record<string, ZodType>>(shape: T): ZodType<{ [K in keyof T]: T[K] extends ZodType<infer U> ? U : any }>;
    string(): ZodType<string>;
    number(): ZodType<number>;
    boolean(): ZodType<boolean>;
    literal<T extends string | number | boolean>(value: T): ZodType<T>;
    array<T>(schema: ZodType<T>): ZodType<T[]>;
    record<V>(value: ZodType<V>): ZodType<Record<string, V>>;
    union<T extends [ZodType, ...ZodType[]]>(schemas: T): ZodType;
    enum<T extends readonly [string, ...string[]]>(values: T): ZodType<T[number]>;
  };
  // namespace provides type-level infer (z.infer<typeof schema>)
  namespace z {
    type infer<T extends ZodType> = T extends ZodType<infer U> ? U : never;
  }
  export { z };
  export type { ZodType };
}

declare module "viem" {
  export type Address = \`0x\${string}\`;
  export type Hex = \`0x\${string}\`;
  export function parseAbi<T extends readonly string[]>(abi: T): unknown;
  export function encodeFunctionData(opts: { abi: unknown; functionName: string; args?: unknown[] }): Hex;
  export function decodeFunctionResult(opts: { abi: unknown; functionName: string; data: unknown }): unknown;
  export function formatEther(wei: bigint): string;
  export function parseEther(ether: string): bigint;
  export function getAddress(address: string): Address;
  export function isAddress(value: string): boolean;
  export function hexToBytes(hex: Hex): Uint8Array;
  export function bytesToHex(bytes: Uint8Array): Hex;
  export function keccak256(data: Hex | Uint8Array): Hex;
  export function toHex(value: number | bigint | string | Uint8Array): Hex;
  export function fromHex(hex: Hex, to: "number" | "bigint" | "string"): number | bigint | string;
  export function encodeAbiParameters(types: unknown, values: unknown[]): Hex;
  export function parseAbiParameters(params: string): unknown;
}

declare module "viem/abi" {
  import type { Hex } from "viem";
  export function parseAbi<T extends readonly string[]>(abi: T): unknown;
  export function parseAbiItem(abiItem: string): unknown;
}

declare module "viem/chains" {
  interface Chain { id: number; name: string; }
  export const baseSepolia: Chain;
  export const ethereumSepolia: Chain;
  export const arbitrumSepolia: Chain;
  export const optimismSepolia: Chain;
}

declare module "viem/utils" {
  export function formatEther(wei: bigint): string;
  export function parseEther(ether: string): bigint;
}
`

const TSCONFIG_CONTENT = JSON.stringify(
  {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      types: [],
    },
    include: ["workflow.ts", "cre-sdk.d.ts"],
  },
  null,
  2,
)

const TSC_TIMEOUT_MS = 15_000

/**
 * (e) TypeScript Compilation — spawns bunx tsc in a temp directory
 */
async function checkTypeScriptCompilation(code: string): Promise<string[]> {
  let tempDir: string | null = null

  try {
    tempDir = await mkdtemp(join(tmpdir(), "ciel-validate-"))

    await Promise.all([
      writeFile(join(tempDir, "workflow.ts"), code, "utf-8"),
      writeFile(join(tempDir, "tsconfig.json"), TSCONFIG_CONTENT, "utf-8"),
      writeFile(join(tempDir, "cre-sdk.d.ts"), CRE_SDK_STUB, "utf-8"),
    ])

    const proc = Bun.spawn(["bunx", "tsc", "--noEmit", "--project", "tsconfig.json"], {
      cwd: tempDir,
      stdout: "pipe",
      stderr: "pipe",
    })

    // Timeout: kill process after 15s
    const timer = setTimeout(() => proc.kill(), TSC_TIMEOUT_MS)

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])

    clearTimeout(timer)

    const exitCode = await proc.exited

    if (exitCode === 0) {
      return []
    }

    // Combine stderr+stdout for error output, truncate to 1000 chars
    const output = (stderr + "\n" + stdout).trim().slice(0, 1000)
    return [
      `[TSC] TypeScript compilation failed. FIX the type errors:\n${output}`,
    ]
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return [`[TSC] TypeScript compilation check failed: ${msg}`]
  } finally {
    if (tempDir) {
      rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * Validates generated CRE workflow code with cheap-first ordering.
 *
 * Phase 1 (instant, no I/O): Import check, async check, main export, zod schema, config JSON,
 *         config-code consistency, intent alignment (when provided)
 * Phase 2 (expensive): TypeScript compilation — only runs if Phase 1 passes
 *
 * @param code - The generated TypeScript workflow code
 * @param configJson - Stringified JSON config
 * @param intent - Optional parsed intent for alignment checks
 * @param templateDef - Optional template definition for alignment checks
 * @returns ValidationResult with structured [CATEGORY] prefixed errors
 */
export async function validateWorkflow(
  code: string,
  configJson: string,
  intent?: ParsedIntent,
  templateDef?: TemplateDefinition,
): Promise<ValidationResult> {
  const errors: string[] = []

  // Phase 1: Fast checks (instant, no I/O)
  errors.push(...checkImports(code))
  errors.push(...checkNoAsyncCallbacks(code))
  errors.push(...checkMainExport(code))
  errors.push(...checkZodSchema(code))
  errors.push(...checkConfigJson(code, configJson))
  errors.push(...checkStatePatterns(code, configJson))
  errors.push(...checkNonDeterminism(code))
  errors.push(...checkConfigCodeConsistency(code, configJson))

  // Intent alignment — only when intent + templateDef are provided
  if (intent && templateDef) {
    errors.push(...checkIntentAlignment(code, intent, templateDef))
  }

  // Phase 2: Expensive check — only if Phase 1 passes (cheap-first pattern)
  if (errors.length === 0) {
    const tscErrors = await checkTypeScriptCompilation(code)
    errors.push(...tscErrors)
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

// ─────────────────────────────────────────────
// Secrets Extraction & YAML Generation
// ─────────────────────────────────────────────

/**
 * Extracts secret names from generated workflow code.
 * Matches both patterns:
 *   - getSecret({ id: "KEY_NAME" })
 *   - getSecret("KEY_NAME")
 */
export function extractSecretNames(code: string): string[] {
  const secrets = new Set<string>()

  // Pattern 1: getSecret({ id: "KEY_NAME" })
  const objPattern = /\.getSecret\s*\(\s*\{\s*id\s*:\s*["']([^"']+)["']\s*\}/g
  let match: RegExpExecArray | null
  while ((match = objPattern.exec(code)) !== null) {
    secrets.add(match[1])
  }

  // Pattern 2: getSecret("KEY_NAME")
  const strPattern = /\.getSecret\s*\(\s*["']([^"']+)["']\s*\)/g
  while ((match = strPattern.exec(code)) !== null) {
    secrets.add(match[1])
  }

  return [...secrets].sort()
}

/**
 * Builds CRE-compatible secrets.yaml content from extracted secret names.
 * Returns null if no secrets are needed.
 */
export function buildSecretsYaml(secretNames: string[]): string | null {
  if (secretNames.length === 0) return null

  const lines = ["# CRE Workflow Secrets", "# Replace placeholder values before deployment", ""]
  for (const name of secretNames) {
    lines.push(`${name}: "PLACEHOLDER_${name}"`)
  }
  lines.push("")
  return lines.join("\n")
}
