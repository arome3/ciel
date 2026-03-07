// ─────────────────────────────────────────────
// Error Resolver — Static Fix Patterns for LLM Retries
// ─────────────────────────────────────────────
// Maps [CATEGORY] prefixed validation errors to concrete fix patterns.
// Zero external calls, zero latency — always available as a baseline
// alongside real compiler output.

import type { CompileFeedback } from "./compile-feedback"

// ─────────────────────────────────────────────
// Public Interfaces
// ─────────────────────────────────────────────

export interface ErrorResolution {
  /** Concrete code fix patterns per error category */
  fixPatterns: string
  /** Formatted compilation errors (if any) */
  compileContext: string
}

// ─────────────────────────────────────────────
// Fix Pattern Table (compiled at module load)
// ─────────────────────────────────────────────

const FIX_PATTERNS: Map<string, string> = new Map([
  ["IMPORT", `### [IMPORT] Allowed Imports
Only these 4 imports are allowed:
\`\`\`ts
import { ... } from "@chainlink/cre-sdk"
import { z } from "zod"
import { encodeAbiParameters, parseAbiParameters } from "viem"
import { sha256 } from "@noble/hashes/sha256"
\`\`\`
Remove any imports of ethers, web3, axios, node-fetch, fs, path, child_process.
Do NOT import from "@chainlink/cre-sdk/triggers" — all exports come from "@chainlink/cre-sdk".`],

  ["ASYNC", `### [ASYNC] Synchronous Handler Pattern
Handler callbacks MUST be synchronous. Use \`.result()\` to unwrap:
\`\`\`ts
// WRONG:
handler(trigger, async (rt) => {
  const resp = await http.fetch(url)
})

// CORRECT:
handler(trigger, (rt) => {
  const resp = http.fetch(url, { method: "GET" }).result()
  return resp
})
\`\`\`
Remove all \`async\` keywords and \`await\` expressions inside handler callbacks.`],

  ["NONDET", `### [NONDET] Consensus-Safe Timestamps
Date.now(), new Date(), Math.random(), setTimeout, setInterval, Promise.race, Promise.any
are all forbidden — they produce different values on each DON node, breaking BFT consensus.
\`\`\`ts
// WRONG:
const now = Date.now()
const date = new Date()

// CORRECT:
const now = runtime.now().getTime()  // consensus-derived timestamp
const date = runtime.now()           // returns Date object
\`\`\`
Only use \`runtime.now()\` inside handler blocks where \`runtime\` is available.`],

  ["VIEM", `### [VIEM] ABI Encoding Without Banned Functions
encodeFunctionData(), decodeFunctionResult(), parseAbi() crash in Javy WASM.
Use manual 4-byte selector + encodeAbiParameters instead:
\`\`\`ts
import { encodeAbiParameters, parseAbiParameters } from "viem"

// Manual function selector (first 4 bytes of keccak256)
const selector = "0x70a08231" // balanceOf(address)
const params = encodeAbiParameters(
  parseAbiParameters("address"),
  [walletAddress]
)
const calldata = selector + params.slice(2) // remove 0x prefix from params
\`\`\``],

  ["CONFIG", `### [CONFIG] Config Schema Requirements
Every workflow needs a Zod configSchema and matching config.json:
\`\`\`ts
const configSchema = z.object({
  apiUrl: z.string(),
  cronSchedule: z.string().default("0 */5 * * * *"),
})
type Config = z.infer<typeof configSchema>
const runner = await Runner.newRunner<Config>({ configSchema })
\`\`\`
config.json must have all required fields matching the schema.`],

  ["CONFIG_MISMATCH", `### [CONFIG_MISMATCH] Config Field Matching
config.json fields must exactly match the Zod configSchema field names.
Check for typos, missing required fields, and extra undefined fields.
Use \`runtime.config.fieldName\` to access config values (NOT \`getConfig()\`).`],

  ["ALIGN", `### [ALIGN] Trigger/Capability Alignment
The code's trigger type must match the template's expected trigger:
- cron: use \`new cre.capabilities.CronCapability().trigger({ schedule: ... })\`
- evm_log: use \`evmClient.logTrigger({ addresses: [...], topics: [...] })\`
- http: use \`new cre.capabilities.HTTPCapability().trigger()\`

HTTP trigger handler signature:
\`\`\`ts
import { type HTTPPayload } from "@chainlink/cre-sdk"
// HTTPPayload has: { input: Uint8Array } — NOT body, NOT data
// Use decodeJson(payload.input) to parse the input
const onHttpTrigger = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
  const requestData = decodeJson(payload.input)
  // ... your logic ...
  return JSON.stringify(result)
}
const initWorkflow = (config: Config) => {
  const httpTrigger = new cre.capabilities.HTTPCapability().trigger()
  return [cre.handler(httpTrigger, onHttpTrigger)]
}
\`\`\`
Capabilities (data sources + actions) must match what the template requires.`],

  ["TSC", `### [TSC] Common TypeScript Fixes for CRE SDK
- \`Runtime<Config>\` not \`Runtime\` — always parameterize with your Config type
- \`Runner.newRunner<Config>({ configSchema })\` returns a Promise — must await
- \`cre.handler(trigger, callback)\` — callback receives \`(runtime, triggerData)\`
- Use \`runtime.report()\` then \`evmClient.writeReport()\` for on-chain writes
- \`HTTPClient.sendRequest()\` returns \`{ result(): HTTPResponse }\`
- \`HTTPResponse.body\` is \`Uint8Array\` — use \`decodeJson(response.body)\`
- \`HTTPPayload\` has \`input: Uint8Array\` (NOT \`body\`) — use \`decodeJson(payload.input)\`
- \`HTTPTriggerOpts\` only has: \`method?\`, \`url?\`, \`authorizedKeys?\` (no \`path\`)
- \`WriteReportOpts\` has: \`receiver\`, \`report\`, \`gasConfig?\` (no \`data\`, no \`chainSelectorName\`)
- \`getNetwork()\` for chain setup: \`getNetwork({ chainFamily: "evm", chainSelectorName, isTestnet })\`
- \`EVMClient\` constructor needs selector: \`new cre.capabilities.EVMClient(network.chainSelector.selector)\``],

  ["ZOD", `### [ZOD] configSchema Boilerplate
Must define configSchema at module level:
\`\`\`ts
import { z } from "zod"
const configSchema = z.object({ /* your fields */ })
type Config = z.infer<typeof configSchema>
\`\`\``],

  ["MAIN", `### [MAIN] Entry Point Boilerplate
Must export an async main function:
\`\`\`ts
export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema })
  await runner.run(initWorkflow)
}
\`\`\``],

  ["STATE", `### [STATE] Stateful HTTP Pattern (KV Store)
Use ConfidentialHTTPClient for external state:
\`\`\`ts
const kvClient = new cre.capabilities.ConfidentialHTTPClient()
const resp = kvClient.sendRequest(runtime, {
  url: runtime.config.kvStoreUrl,
  method: "GET",
  headers: { "Authorization": "Bearer " + runtime.config.kvApiKey },
}).result()
const state = decodeJson(resp.body)
\`\`\``],
])

// ─────────────────────────────────────────────
// Pre-Seed Patterns by Template Characteristics
// ─────────────────────────────────────────────

/**
 * Returns fix patterns for the given category keys.
 * Used to pre-seed the first LLM attempt with relevant guidance
 * based on template trigger type and capabilities — prevents the
 * most common first-attempt failures without waiting for a retry.
 *
 * @param categories - Array of FIX_PATTERN keys (e.g. ["ALIGN", "TSC"])
 * @returns Formatted fix patterns string, or empty string if no matches
 */
export function getFixPatternsForCategories(categories: string[]): string {
  const patterns: string[] = []
  for (const cat of categories) {
    const fix = FIX_PATTERNS.get(cat)
    if (fix) patterns.push(fix)
  }
  return patterns.length > 0
    ? `## Proactive Guidance (Common Pitfalls for This Template)\n\n${patterns.join("\n\n")}`
    : ""
}

/**
 * Determines which fix-pattern categories to pre-seed based on
 * template trigger type and capabilities. Returns an array of
 * category keys for getFixPatternsForCategories().
 *
 * @param triggerType - Template trigger type ("cron" | "http" | "evm_log")
 * @param capabilities - Template required capabilities array
 * @returns Array of category keys to pre-seed
 */
export function getPreSeedCategories(
  triggerType: string,
  capabilities: string[],
  isWildcard?: boolean,
): string[] {
  // Wildcard: pre-seed all critical patterns since we don't know what the LLM will generate
  if (isWildcard) {
    return ["ASYNC", "NONDET", "TSC", "IMPORT", "CONFIG"]
  }

  const cats: string[] = []

  // HTTP-triggered templates: LLM most commonly gets the trigger wrong
  if (triggerType === "http") {
    cats.push("ALIGN")
  }

  // Templates with evmWrite: writeReport two-step pattern is tricky
  if (capabilities.includes("evmWrite")) {
    cats.push("TSC")
  }

  // Multi-AI templates: synchronous handler + non-determinism are critical
  if (capabilities.includes("multi-ai")) {
    cats.push("ASYNC", "NONDET")
  }

  return cats
}

// ─────────────────────────────────────────────
// Category Extraction
// ─────────────────────────────────────────────

const CATEGORY_RE = /^\[([A-Z_]+)\]/

/**
 * Extracts the [CATEGORY] prefix from a validation error string.
 * Returns null if no category prefix found.
 */
export function extractCategory(error: string): string | null {
  const match = error.match(CATEGORY_RE)
  return match ? match[1] : null
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * Resolves validation errors + optional compile feedback into
 * actionable fix patterns and formatted compiler output.
 *
 * @param validationErrors - Structured errors with [CATEGORY] prefix from validator
 * @param compileFeedback - Optional real compiler output from compile-feedback
 * @returns ErrorResolution with fix patterns and compiler context
 */
export function resolveErrors(
  validationErrors: string[],
  compileFeedback?: CompileFeedback,
): ErrorResolution {
  // Deduplicate categories
  const categories = new Set<string>()
  for (const err of validationErrors) {
    const cat = extractCategory(err)
    if (cat) categories.add(cat)
  }

  // Look up fix patterns per category
  const patterns: string[] = []
  for (const cat of categories) {
    const fix = FIX_PATTERNS.get(cat)
    if (fix) patterns.push(fix)
  }

  // Format compilation errors
  let compileContext = ""
  if (compileFeedback && !compileFeedback.compiled && compileFeedback.errors.length > 0) {
    const errorLines = compileFeedback.errors
      .map((err, i) => `${i + 1}. ${err}`)
      .join("\n")
    compileContext = `## Compiler Output (Real tsc Errors)\n\n${errorLines}\n\n` +
      "These are REAL TypeScript compilation errors from the CRE CLI. " +
      "Fix each one — the code will not compile until all are resolved."
  }

  return {
    fixPatterns: patterns.length > 0
      ? `## Fix Patterns\n\n${patterns.join("\n\n")}`
      : "",
    compileContext,
  }
}
