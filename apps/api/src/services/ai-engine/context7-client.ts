// ─────────────────────────────────────────────
// Context7 Client — Live CRE SDK Documentation
// ─────────────────────────────────────────────
// Fetches supplementary CRE SDK documentation from Context7.
// Module-level cache ensures we only fetch once per process lifetime.
// Graceful fallback: returns empty string on any failure.

const CONTEXT7_BASE_URL = "https://context7.com/api"
const CONTEXT7_LIBRARY_ID = "/chainlink/cre-sdk"
const CONTEXT7_TIMEOUT_MS = 5_000

/** Module-level cache — populated on first call, never refetched */
let cachedDocs: string | null = null

/**
 * Fetches CRE SDK documentation from Context7.
 * Returns cached result on subsequent calls.
 * Returns empty string on timeout or any error (never throws).
 */
export async function getContext7CREDocs(): Promise<string> {
  if (cachedDocs !== null) return cachedDocs

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), CONTEXT7_TIMEOUT_MS)

    const response = await fetch(
      `${CONTEXT7_BASE_URL}/v1/query?libraryId=${encodeURIComponent(CONTEXT7_LIBRARY_ID)}&query=CRE+SDK+workflow+patterns+triggers+capabilities`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
      },
    )

    clearTimeout(timeout)

    if (!response.ok) {
      cachedDocs = ""
      return cachedDocs
    }

    const data = (await response.json()) as { content?: string; results?: Array<{ content: string }> }

    // Extract content from response — format may vary
    if (data.content) {
      cachedDocs = data.content
    } else if (data.results?.length) {
      cachedDocs = data.results.map((r) => r.content).join("\n\n")
    } else {
      cachedDocs = ""
    }

    return cachedDocs
  } catch {
    // Graceful degradation: timeout, network error, parse error — all return empty
    cachedDocs = ""
    return cachedDocs
  }
}

/**
 * Resets the cache (for testing only).
 */
export function _resetContext7Cache(): void {
  cachedDocs = null
}
