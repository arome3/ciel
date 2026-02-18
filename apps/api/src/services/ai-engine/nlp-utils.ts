import { stemmer } from "stemmer"

export { stemmer }

// ─────────────────────────────────────────────
// Levenshtein Distance
// ─────────────────────────────────────────────
export function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  if (a === b) return 0

  // Single-row DP for O(n) space
  let prev = new Array<number>(n + 1)
  let curr = new Array<number>(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j

  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1]
      } else {
        curr[j] = 1 + Math.min(prev[j], curr[j - 1], prev[j - 1])
      }
    }
    ;[prev, curr] = [curr, prev]
  }

  return prev[n]
}

// ─────────────────────────────────────────────
// Fuzzy Match — find best candidate within edit distance
// ─────────────────────────────────────────────
export function fuzzyMatch(
  word: string,
  candidates: string[],
  maxDistance: number = 2,
): string | null {
  let best: string | null = null
  let bestDist = maxDistance + 1

  for (const candidate of candidates) {
    // Quick length filter — if lengths differ by more than maxDistance, skip
    if (Math.abs(word.length - candidate.length) > maxDistance) continue
    const d = levenshtein(word, candidate)
    if (d < bestDist) {
      bestDist = d
      best = candidate
    }
  }

  return bestDist <= maxDistance ? best : null
}

// ─────────────────────────────────────────────
// Abbreviation Expansion
// ─────────────────────────────────────────────
const ABBREVIATION_MAP: Record<string, string> = {
  // Time
  "min": "minute",
  "mins": "minutes",
  "hr": "hour",
  "hrs": "hours",
  "sec": "second",
  "secs": "seconds",
  "wk": "week",
  "wks": "weeks",

  // Blockchain
  "tx": "transaction",
  "txn": "transaction",
  "txns": "transactions",
  "addr": "address",
  "bal": "balance",
  "amt": "amount",
  "tok": "token",

  // General
  "msg": "message",
  "info": "information",
  "auth": "authentication",
  "temp": "temperature",
  "vol": "volume",
  "avg": "average",
  "approx": "approximately",
}

export function expandAbbreviations(text: string): string {
  return text.replace(/\b[a-zA-Z]+\b/g, (word) => {
    const lower = word.toLowerCase()
    return ABBREVIATION_MAP[lower] ?? word
  })
}

// ─────────────────────────────────────────────
// Negation Detection
// ─────────────────────────────────────────────
const NEGATION_WORDS = new Set([
  "not", "no", "never", "don't", "dont", "doesn't", "doesnt",
  "won't", "wont", "shouldn't", "shouldnt", "can't", "cant",
  "cannot", "stop", "disable", "cancel", "remove", "without",
  "exclude", "ignore", "skip", "avoid", "prevent",
])

// How many words ahead a negation marker poisons
const NEGATION_WINDOW = 5

/**
 * Returns true if the overall text is predominantly negated.
 * Uses a simple window-based heuristic: count how many content words
 * fall within a negation window vs total content words.
 */
export function detectNegation(text: string): boolean {
  const words = text.toLowerCase().replace(/[^a-z'\s]/g, " ").split(/\s+/).filter(Boolean)
  if (words.length === 0) return false

  let negatedTokens = 0
  let totalTokens = 0
  let negationCountdown = 0

  for (const word of words) {
    const cleaned = word.replace(/'/g, "")
    if (NEGATION_WORDS.has(cleaned)) {
      negationCountdown = NEGATION_WINDOW
      continue
    }

    if (word.length > 2) {
      totalTokens++
      if (negationCountdown > 0) negatedTokens++
    }

    if (negationCountdown > 0) negationCountdown--
  }

  // If >40% of content tokens are under negation, consider it negated
  return totalTokens > 0 && negatedTokens / totalTokens > 0.4
}

// ─────────────────────────────────────────────
// Pre-computed Stemmed Lookup Builders
// ─────────────────────────────────────────────

/**
 * Builds a Map from both original keys AND stemmed keys → values.
 * For lookup: try exact first, then stemmed, then fuzzy.
 */
export function buildStemmedMap(original: Record<string, string>): Map<string, string> {
  const lookup = new Map<string, string>()
  for (const [key, value] of Object.entries(original)) {
    lookup.set(key, value)
    // Only add stemmed variant if it differs and doesn't collide
    const stemmed = stemmer(key)
    if (stemmed !== key && !lookup.has(stemmed)) {
      lookup.set(stemmed, value)
    }
  }
  return lookup
}

/**
 * Builds a Set of both original signal strings AND their stems.
 */
export function buildStemmedSet(signals: string[]): Set<string> {
  const set = new Set<string>()
  for (const s of signals) {
    set.add(s)
    set.add(stemmer(s))
  }
  return set
}

/**
 * Compute adaptive max edit distance based on word length.
 * Short words get tighter tolerance to prevent false positives
 * like "stop" matching "storm" or "minute" matching "mint".
 *
 *   length 1-4  → max 1
 *   length 5-7  → max 1
 *   length 8+   → max 2
 */
export function adaptiveMaxDistance(wordLength: number): number {
  if (wordLength <= 7) return 1
  return 2
}

/**
 * Three-tier lookup: exact → stemmed → fuzzy.
 * Returns the mapped value or null.
 * Fuzzy distance is adaptive to word length to prevent false positives.
 */
export function tieredLookup(
  word: string,
  stemmedMap: Map<string, string>,
  allKeys: string[],
): string | null {
  // Tier 1: exact
  const exact = stemmedMap.get(word)
  if (exact) return exact

  // Tier 2: stemmed
  const stemmed = stemmer(word)
  const byStem = stemmedMap.get(stemmed)
  if (byStem) return byStem

  // Tier 3: fuzzy against original keys only (not stems, to avoid spurious matches)
  // Use adaptive distance: short words get tighter tolerance
  const maxDist = adaptiveMaxDistance(word.length)
  const fuzzyKey = fuzzyMatch(word, allKeys, maxDist)
  if (fuzzyKey) {
    return stemmedMap.get(fuzzyKey) ?? null
  }

  return null
}

/**
 * Check how many signals match in the input text.
 * Uses 4-tier matching: includes → stemmed → fuzzy (per word) → done.
 */
export function matchesSignalSet(
  lowerText: string,
  originalSignals: string[],
  stemmedSet: Set<string>,
  stemmedWords: string[],
  inputWords?: string[],
): number {
  let hits = 0

  for (const signal of originalSignals) {
    // Multi-word signals: check against original text
    if (signal.includes(" ")) {
      if (lowerText.includes(signal)) hits++
      continue
    }

    // Tier 1: substring includes (catches "listened" ⊃ "listen", etc.)
    if (lowerText.includes(signal)) {
      hits++
      continue
    }

    // Tier 2: stemmed match — check if any stemmed input word matches stemmed signal
    const stemmedSignal = stemmer(signal)
    if (stemmedWords.some((sw) => sw === stemmedSignal)) {
      hits++
      continue
    }

    // Tier 3: fuzzy match — check each input word against this signal
    if (inputWords) {
      const maxDist = adaptiveMaxDistance(signal.length)
      const matched = inputWords.some((w) => {
        if (Math.abs(w.length - signal.length) > maxDist) return false
        return levenshtein(w, signal) <= maxDist
      })
      if (matched) hits++
    }
  }

  return hits
}
