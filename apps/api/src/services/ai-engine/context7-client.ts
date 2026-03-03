// ─────────────────────────────────────────────
// Context7 Client — Live CRE SDK Documentation
// ─────────────────────────────────────────────
// Fetches supplementary CRE SDK documentation from Context7.
// Module-level cache ensures we only fetch once per process lifetime.
// Retry + bundled fallback ensures we never permanently cache empty.

const CONTEXT7_BASE_URL = "https://context7.com/api"
const CONTEXT7_LIBRARY_ID = "/websites/chain_link_cre"
const CONTEXT7_TIMEOUT_MS = 5_000
const RETRY_DELAY_MS = 1_000
const MAX_ATTEMPTS = 2

/** Bundled fallback — essential CRE SDK patterns when Context7 is unreachable */
const BUNDLED_FALLBACK = `### CRE SDK Quick Reference (Bundled Fallback)
- Handler callbacks MUST be synchronous — use \`.result()\` to unwrap
- \`initWorkflow(config: Config)\` receives config, returns \`cre.handler()\` array
- \`export async function main()\` with \`await Runner.newRunner<Config>({ configSchema })\`
- Timestamps: \`runtime.now()\` (consensus-safe), NEVER \`Date.now()\` or \`new Date()\`
- Config access: \`runtime.config.fieldName\`, NOT \`runtime.getConfig()\`
- Secrets: \`runtime.getSecret({ id: "KEY" }).result().value\`
- Report: two-step — \`runtime.report(opts).result()\` then \`evmClient.writeReport(runtime, opts).result()\`
- Only 4 import sources: @chainlink/cre-sdk, zod, viem, @noble/hashes/*`

/** Module-level cache — populated on first successful call or with bundled fallback */
let cachedDocs: string | null = null

/**
 * Attempts a single fetch from Context7.
 * Returns the content string on success, null on failure.
 */
async function fetchContext7(): Promise<string | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), CONTEXT7_TIMEOUT_MS)

  try {
    const response = await fetch(
      `${CONTEXT7_BASE_URL}/v1/query?libraryId=${encodeURIComponent(CONTEXT7_LIBRARY_ID)}&query=CRE+SDK+workflow+patterns+triggers+capabilities`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
      },
    )

    clearTimeout(timeout)

    if (!response.ok) return null

    const data = (await response.json()) as { content?: string; results?: Array<{ content: string }> }

    if (data.content) return data.content
    if (data.results?.length) return data.results.map((r) => r.content).join("\n\n")
    return null
  } catch {
    clearTimeout(timeout)
    return null
  }
}

/**
 * Fetches CRE SDK documentation from Context7.
 * Returns cached result on subsequent calls.
 * Retries once on failure, then falls back to bundled reference.
 * Never throws.
 */
export async function getContext7CREDocs(): Promise<string> {
  if (cachedDocs !== null) return cachedDocs

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await fetchContext7()
    if (result) {
      cachedDocs = result
      return cachedDocs
    }

    // Delay before retry (skip delay after last attempt)
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
    }
  }

  // All attempts failed — cache bundled fallback instead of empty string
  cachedDocs = BUNDLED_FALLBACK
  return cachedDocs
}

/**
 * Resets the cache (for testing only).
 */
export function _resetContext7Cache(): void {
  cachedDocs = null
}
