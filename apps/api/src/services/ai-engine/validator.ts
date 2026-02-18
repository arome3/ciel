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
  const handlerAsyncPattern = /handler\s*\([^,]+,\s*async\s+/g
  if (handlerAsyncPattern.test(fixed)) {
    fixed = fixed.replace(
      /handler\s*\(([^,]+),\s*async\s+/g,
      "handler($1, ",
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

  return { code: fixed, fixes }
}

/**
 * Finds handler callback block ranges using brace-counting.
 * Matches both arrow functions and function expressions:
 *   handler(trigger, (rt) => { ... })
 *   handler(trigger, function(rt) { ... })
 */
function findHandlerBlockRanges(code: string): Array<{ start: number; end: number }> {
  const pattern = /handler\s*\([^,]+,\s*(?:(?:\([^)]*\)|[a-zA-Z_$]\w*)\s*=>\s*\{|function\s*\([^)]*\)\s*\{)/g
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
      `[IMPORT] Disallowed import "${source}". REMOVE this import. Only @chainlink/cre-sdk, zod, and viem are allowed.`,
    )
  }

  // CJS requires: require("pkg") / require('pkg')
  const requireRegex = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g
  while ((match = requireRegex.exec(code)) !== null) {
    const source = match[1]
    if (source.startsWith(".") || source.startsWith("/")) continue
    if (isAllowedImport(source)) continue

    errors.push(
      `[IMPORT] Disallowed require("${source}"). REMOVE this require. Only @chainlink/cre-sdk, zod, and viem are allowed.`,
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
    source.startsWith("viem/")
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
  const handlerAsyncPattern = /handler\s*\([^,]+,\s*async\s/g
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
  if (/EVMClient\.(?:callContract|writeReport)|evmWrite/.test(code)) {
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
        "[CONFIG] Code uses CronCapability but config has no schedule field. ADD cronSchedule or schedule to the config.",
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

  interface EVMCallContractOpts {
    contractAddress: string;
    calldata?: string;
    callData?: string;
    chainSelector?: string;
  }

  interface EVMWriteReportOpts {
    reportData?: string;
    report?: string;
    consumerAddress?: string;
    contractAddress?: string;
    chainSelector?: string;
  }

  interface FetchOpts {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    headers?: Record<string, string>;
    body?: string;
  }

  interface CronTriggerOpts {
    cronSchedule: string;
  }

  interface HTTPTriggerOpts {
    method?: string;
    url?: string;
  }

  interface ConsensusOpts {
    fields: string[];
    reportId: string;
  }

  /** The Runner bootstraps workflow registration */
  export class Runner {
    static newRunner<T>(opts: { configSchema: import("zod").ZodType }): Runner;
    run(fn: (runtime: Runtime<any>) => void): void;
  }

  /** Runtime is the typed config accessor passed to handler callbacks */
  export class Runtime<T> {
    readonly config: T;
    runInNodeMode<R>(callback: (nodeRuntime: Runtime<T>) => R): R;
    report(data: string): string;
  }

  /** Capability classes — these are the CRE SDK building blocks */
  export class CronCapability {
    trigger(opts: CronTriggerOpts): CronTrigger;
  }

  export class HTTPCapability {
    trigger(opts: HTTPTriggerOpts): HTTPTrigger;
  }

  export class EVMLogCapability {
    trigger(opts: { contractAddress: string; eventSignature: string; chainSelector?: string }): EVMLogTrigger;
  }

  /** HTTPClient — synchronous .result() unwrapping */
  export class HTTPClient {
    fetch(url: string, opts?: FetchOpts): CREResponse<HTTPResponse>;
  }

  /** ConfidentialHTTPClient — same interface, secrets-safe */
  export class ConfidentialHTTPClient {
    fetch(url: string, opts?: FetchOpts): CREResponse<HTTPResponse>;
  }

  /** Resolves a chain name to a chain selector string */
  export function getNetwork(chainName: string): string;

  /** EVMClient — on-chain interactions */
  export class EVMClient {
    static callContract(opts: EVMCallContractOpts): CREResponse<EVMResponse>;
    static writeReport(opts: EVMWriteReportOpts): CREResponse<EVMResponse>;
    callContract(opts: EVMCallContractOpts): CREResponse<EVMResponse>;
    writeReport(opts: EVMWriteReportOpts): CREResponse<EVMResponse>;
  }

  // Trigger types (returned by capability.trigger())
  interface CronTrigger { readonly __brand: "CronTrigger" }
  interface HTTPTrigger { readonly __brand: "HTTPTrigger" }
  interface EVMLogTrigger { readonly __brand: "EVMLogTrigger" }

  /** handler() wires a trigger to a synchronous callback.
   *  Runtime<any> because the generic can't be inferred through triggers in stubs.
   *  The real SDK handles this via internal type wiring. */
  export function handler(
    trigger: CronTrigger | HTTPTrigger | EVMLogTrigger,
    callback: (runtime: Runtime<any>) => Record<string, unknown>,
  ): void;

  /** Consensus functions */
  export function consensusMedianAggregation(opts: ConsensusOpts): void;
  export function consensusModeAggregation(opts: ConsensusOpts): void;
  export function consensusIdenticalAggregation(opts: ConsensusOpts): void;
  export function consensusMajorityVote(opts: ConsensusOpts): void;

  export const StreamsLookup: {
    new(): { lookup(feedId: string): CREResponse<{ price: number; timestamp: number }> };
  };

  export type InferOutput<T> = T extends (...args: any[]) => infer R ? R : never;
}

declare module "@chainlink/cre-sdk/triggers" {
  import type { CronCapability, HTTPCapability, EVMLogCapability } from "@chainlink/cre-sdk";
  export { CronCapability as CronTrigger };
  export { HTTPCapability as HTTPTrigger };
  export { EVMLogCapability as EVMLogTrigger };
  export const cronTrigger: CronCapability;
  export const httpTrigger: HTTPCapability;
  export const evmLogTrigger: EVMLogCapability;
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

  namespace z {
    function object<T extends Record<string, ZodType>>(shape: T): ZodType<{ [K in keyof T]: T[K] extends ZodType<infer U> ? U : any }>;
    function string(): ZodType<string>;
    function number(): ZodType<number>;
    function boolean(): ZodType<boolean>;
    function literal<T extends string | number | boolean>(value: T): ZodType<T>;
    function array<T>(schema: ZodType<T>): ZodType<T[]>;
    function record<V>(value: ZodType<V>): ZodType<Record<string, V>>;
    function union<T extends [ZodType, ...ZodType[]]>(schemas: T): ZodType;
    type infer<T extends ZodType> = T extends ZodType<infer U> ? U : never;
  }
  interface z {
    enum<T extends readonly [string, ...string[]]>(values: T): ZodType<T[number]>;
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
 * Phase 1 (instant, no I/O): Import check, async check, main export, zod schema, config JSON
 * Phase 2 (expensive): TypeScript compilation — only runs if Phase 1 passes
 *
 * @param code - The generated TypeScript workflow code
 * @param configJson - Stringified JSON config
 * @returns ValidationResult with structured [CATEGORY] prefixed errors
 */
export async function validateWorkflow(
  code: string,
  configJson: string,
): Promise<ValidationResult> {
  const errors: string[] = []

  // Phase 1: Fast checks (instant, no I/O)
  errors.push(...checkImports(code))
  errors.push(...checkNoAsyncCallbacks(code))
  errors.push(...checkMainExport(code))
  errors.push(...checkZodSchema(code))
  errors.push(...checkConfigJson(code, configJson))

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
