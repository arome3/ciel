import type { ParsedIntent } from "./types"
import {
  stemmer,
  levenshtein,
  fuzzyMatch,
  expandAbbreviations,
  detectNegation,
  buildStemmedMap,
  buildStemmedSet,
  tieredLookup,
  matchesSignalSet,
  adaptiveMaxDistance,
} from "./nlp-utils"

// Re-export for downstream consumers (doc 04 compatibility)
export type { ParsedIntent } from "./types"

// ─────────────────────────────────────────────
// Trigger Detection Signals
// ─────────────────────────────────────────────
const CRON_SIGNALS: string[] = [
  "every", "hourly", "daily", "minute", "minutes",
  "schedule", "periodic", "interval", "recurring",
  "monitor", "poll", "check", "watch",
]

const HTTP_SIGNALS: string[] = [
  "when", "request", "arrives", "webhook", "http",
  "trigger", "api call", "on demand", "invoke",
  "submit", "deposit", "redeem", "subscription",
]

const EVM_LOG_SIGNALS: string[] = [
  "event", "emit", "log", "listen", "watch",
  "contract event", "on-chain event", "emitted",
  "transfer event", "approval event",
]

// Pre-compute stemmed signal sets at module load
const CRON_STEMS = buildStemmedSet(CRON_SIGNALS)
const HTTP_STEMS = buildStemmedSet(HTTP_SIGNALS)
const EVM_LOG_STEMS = buildStemmedSet(EVM_LOG_SIGNALS)

// ─────────────────────────────────────────────
// Chain Name Normalization
// ─────────────────────────────────────────────
const CHAIN_MAP: Record<string, string> = {
  "base": "base-sepolia",
  "base-sepolia": "base-sepolia",
  "base sepolia": "base-sepolia",

  "ethereum": "ethereum-sepolia",
  "eth": "ethereum-sepolia",
  "ethereum-sepolia": "ethereum-sepolia",
  "eth-sepolia": "ethereum-sepolia",

  "arbitrum": "arbitrum-sepolia",
  "arb": "arbitrum-sepolia",
  "arbitrum-sepolia": "arbitrum-sepolia",

  "polygon": "polygon-amoy",
  "matic": "polygon-amoy",

  "avalanche": "avalanche-fuji",
  "avax": "avalanche-fuji",

  "optimism": "optimism-sepolia",
  "op": "optimism-sepolia",
}

const DEFAULT_CHAIN = "base-sepolia"

// Chain keys sorted by length descending (longer matches first)
const CHAIN_KEYS_SORTED = Object.keys(CHAIN_MAP).sort((a, b) => b.length - a.length)
// Only long keys for fuzzy matching (short keys would cause too many false positives)
const CHAIN_KEYS_LONG = CHAIN_KEYS_SORTED.filter((k) => k.length > 4)

// ─────────────────────────────────────────────
// Keyword → Data Source Mapping
// ─────────────────────────────────────────────
const DATA_SOURCE_MAP: Record<string, string> = {
  // Price feeds & oracles (Template 1, 10)
  "price": "price-feed",
  "eth": "price-feed",
  "btc": "price-feed",
  "bitcoin": "price-feed",
  "ethereum": "price-feed",
  "token": "price-feed",
  "usd": "price-feed",
  "oracle": "price-feed",
  "data feed": "price-feed",
  "custom feed": "price-feed",

  // Weather (Template 7)
  "weather": "weather-api",
  "temperature": "weather-api",
  "rainfall": "weather-api",
  "humidity": "weather-api",
  "wind": "weather-api",
  "storm": "weather-api",
  "crop": "weather-api",

  // Travel (Template 7 — flight delay variant)
  "flight": "flight-api",
  "airline": "flight-api",
  "delay": "flight-api",

  // Finance — Reserves (Template 5)
  "reserve": "reserve-api",
  "collateral": "reserve-api",
  "backing": "reserve-api",
  "collateralization": "reserve-api",
  "ratio": "reserve-api",
  "fully backed": "reserve-api",
  "proof of reserve": "reserve-api",

  // Finance — NAV / Funds (Template 6)
  "nav": "nav-api",
  "fund": "nav-api",
  "aum": "nav-api",
  "shares": "nav-api",
  "subscription": "nav-api",
  "redemption": "nav-api",
  "tokenized fund": "nav-api",

  // Compliance (Template 8)
  "compliance": "compliance-api",
  "kyc": "compliance-api",
  "aml": "compliance-api",
  "sanctions": "compliance-api",
  "blacklist": "compliance-api",

  // DeFi (Template 2)
  "yield": "defi-api",
  "liquidity": "defi-api",
  "apy": "defi-api",
  "tvl": "defi-api",
  "pool": "defi-api",

  // Prediction Markets (Template 3)
  "prediction market": "prediction-market",
  "outcome": "prediction-market",
  "resolution": "prediction-market",
  "bet": "prediction-market",
  "wager": "prediction-market",

  // AI / Multi-model (Template 9)
  "consensus": "multi-ai",
  "gpt": "multi-ai",
  "claude": "multi-ai",
  "gemini": "multi-ai",
  "multi-model": "multi-ai",
  "hallucination": "multi-ai",
  "verify": "multi-ai",
  "multiple ai": "multi-ai",
}

// Pre-compute stemmed lookup (includes both original keys and stemmed variants)
const DATA_SOURCE_STEM = buildStemmedMap(DATA_SOURCE_MAP)
const DATA_SOURCE_KEYS = Object.keys(DATA_SOURCE_MAP)

// ─────────────────────────────────────────────
// Keyword → Action Mapping
// ─────────────────────────────────────────────
const ACTION_MAP: Record<string, string> = {
  // On-chain writes (Template 1, 3, 9, 10)
  "write": "evmWrite",
  "record": "evmWrite",
  "publish": "evmWrite",
  "update": "evmWrite",
  "onchain": "evmWrite",
  "on-chain": "evmWrite",
  "contract": "evmWrite",
  "settle": "evmWrite",
  "aggregate": "evmWrite",
  "gate": "evmWrite",
  "execute": "evmWrite",

  // Alerts & notifications
  "alert": "alert",
  "notify": "alert",
  "email": "alert",
  "warning": "alert",
  "alarm": "alert",

  // Transfers (Template 2)
  "swap": "transfer",
  "transfer": "transfer",
  "bridge": "transfer",
  "send": "transfer",
  "move": "transfer",
  "consolidate": "transfer",

  // Minting (Template 4)
  "mint": "mint",
  "issue": "mint",
  "create token": "mint",
  "issuance": "mint",

  // Payouts (Template 6, 7)
  "pay": "payout",
  "payout": "payout",
  "claim": "payout",
  "distribute": "payout",
  "reimburse": "payout",
  "redeem": "payout",
  "redemption": "payout",

  // Rebalancing (Template 2)
  "rebalance": "rebalance",
  "allocate": "rebalance",
  "adjust": "rebalance",

  // Messaging platforms
  "telegram": "alert",
  "discord": "alert",
  "slack": "alert",
  "sms": "alert",
  "message": "alert",
  "ping": "alert",
  "chat": "alert",
}

// Pre-compute stemmed lookup
const ACTION_STEM = buildStemmedMap(ACTION_MAP)
const ACTION_KEYS = Object.keys(ACTION_MAP)
const ACTION_KEYS_SINGLE = ACTION_KEYS.filter((k) => !k.includes(" "))
const ACTION_KEYS_MULTI = ACTION_KEYS.filter((k) => k.includes(" "))

// ─────────────────────────────────────────────
// Schedule Extraction (with fuzzy unit matching)
// ─────────────────────────────────────────────
const SCHEDULE_REGEX = /every\s+(\d+)\s*(second|seconds|minute|minutes|hour|hours|day|days)/i
const SCHEDULE_FUZZY_REGEX = /every\s+(\d+)\s+(\w+)/i
const DAILY_AT_REGEX = /every\s+day\s+at\s+(\d{1,2})\s*(am|pm)/i

const DAY_MAP: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
}

const SCHEDULE_UNITS = [
  "second", "seconds", "minute", "minutes",
  "hour", "hours", "day", "days",
]

function buildCronExpression(n: number, rawUnit: string): string | undefined {
  const unit = rawUnit.toLowerCase().replace(/s$/, "")
  switch (unit) {
    case "second":
      return "* * * * *"
    case "minute":
      return n === 1 ? "* * * * *" : `*/${n} * * * *`
    case "hour":
      return n === 1 ? "0 * * * *" : `0 */${n} * * *`
    case "day":
      return n === 1 ? "0 0 * * *" : `0 0 */${n} * *`
    default:
      return undefined
  }
}

function extractSchedule(text: string): string | undefined {
  // Phase 1: Exact regex match
  const match = text.match(SCHEDULE_REGEX)
  if (match) {
    return buildCronExpression(parseInt(match[1], 10), match[2])
  }

  // Phase 2: Fuzzy unit matching — "every N <typo-unit>"
  const fuzzy = text.match(SCHEDULE_FUZZY_REGEX)
  if (fuzzy) {
    const n = parseInt(fuzzy[1], 10)
    const rawUnit = fuzzy[2].toLowerCase()
    const matched = fuzzyMatch(rawUnit, SCHEDULE_UNITS, 2)
    if (matched) return buildCronExpression(n, matched)
  }

  // Phase 3: Shorthand and extended patterns
  if (/\bhourly\b/i.test(text) || fuzzyMatch("hourly", text.toLowerCase().split(/\s+/), 2)) {
    return "0 * * * *"
  }
  if (/\bdaily\b/i.test(text)) return "0 0 * * *"
  if (/\bevery\s+minute\b/i.test(text)) return "* * * * *"

  // "every day at Xam/pm"
  const dailyAt = text.match(DAILY_AT_REGEX)
  if (dailyAt) {
    let hour = parseInt(dailyAt[1], 10)
    if (dailyAt[2].toLowerCase() === "pm" && hour < 12) hour += 12
    if (dailyAt[2].toLowerCase() === "am" && hour === 12) hour = 0
    return `0 ${hour} * * *`
  }

  // Weekly patterns
  if (/\bweekly\b/i.test(text) || /\bevery\s+week\b/i.test(text)) return "0 0 * * 0"

  // Named days
  for (const [day, num] of Object.entries(DAY_MAP)) {
    if (new RegExp(`every\\s+${day}`, "i").test(text)) return `0 0 * * ${num}`
  }

  return undefined
}

// ─────────────────────────────────────────────
// Condition Extraction
// ─────────────────────────────────────────────
const CONDITION_PATTERNS: RegExp[] = [
  /(?:drops?|falls?|goes?)\s+(?:below|under)\s+\$?[\d,]+\.?\d*/gi,
  /(?:rises?|goes?|climbs?|exceeds?)\s+(?:above|over)\s+\$?[\d,]+\.?\d*/gi,
  /(?:crosses|reaches|hits)\s+\$?[\d,]+\.?\d*/gi,
  /(?:exceeds?|greater\s+than|more\s+than|less\s+than)\s+\d+\.?\d*%?/gi,
  /(?:below|above|under|over)\s+\$?[\d,]+\.?\d*/gi,
  /deviation\s+(?:of|exceeds?|greater\s+than)\s+\d+\.?\d*%?/gi,
]

function extractConditions(text: string): string[] {
  const conditions: string[] = []
  for (const pattern of CONDITION_PATTERNS) {
    pattern.lastIndex = 0
    const matches = text.match(pattern)
    if (matches) {
      conditions.push(...matches.map((m) => m.trim()))
    }
  }
  return [...new Set(conditions)]
}

// ─────────────────────────────────────────────
// Trigger Type Detection (stemmed + confidence)
// ─────────────────────────────────────────────
function detectTriggerType(
  text: string,
  stemmedWords: string[],
  inputWords: string[],
): { type: ParsedIntent["triggerType"]; confidence: number } {
  const lower = text.toLowerCase()

  const cronScore = matchesSignalSet(lower, CRON_SIGNALS, CRON_STEMS, stemmedWords, inputWords)
  const httpScore = matchesSignalSet(lower, HTTP_SIGNALS, HTTP_STEMS, stemmedWords, inputWords)
  const evmLogScore = matchesSignalSet(lower, EVM_LOG_SIGNALS, EVM_LOG_STEMS, stemmedWords, inputWords)

  // Schedule regex is a strong cron signal (+3)
  // Also check fuzzy matches for "hourly"/"daily" typos
  let cronBonus = 0
  if (
    SCHEDULE_REGEX.test(text) ||
    SCHEDULE_FUZZY_REGEX.test(text) ||
    /\bhourly\b|\bdaily\b|\bweekly\b/i.test(text) ||
    inputWords.some((w) => {
      if (w.length < 4) return false
      return (
        levenshtein(w, "hourly") <= 1 ||
        levenshtein(w, "daily") <= 1 ||
        levenshtein(w, "weekly") <= 1
      )
    })
  ) {
    cronBonus = 3
  }

  const adjustedCron = cronScore + cronBonus
  const maxScore = Math.max(adjustedCron, httpScore, evmLogScore)
  if (maxScore === 0) return { type: "unknown", confidence: 0 }

  const total = adjustedCron + httpScore + evmLogScore
  const confidence = total > 0 ? maxScore / total : 0

  if (adjustedCron === maxScore) return { type: "cron", confidence }
  if (httpScore === maxScore) return { type: "http", confidence }
  return { type: "evm_log", confidence }
}

// ─────────────────────────────────────────────
// Chain Resolution (word-boundary + fuzzy)
// ─────────────────────────────────────────────
function resolveChains(text: string, words: string[]): string[] {
  const lower = text.toLowerCase()
  const found: Set<string> = new Set()

  // Phase 1: Exact matching (word-boundary for short keys)
  for (const key of CHAIN_KEYS_SORTED) {
    if (key.length <= 4) {
      if (new RegExp("\\b" + key + "\\b", "i").test(text)) found.add(CHAIN_MAP[key])
    } else {
      if (lower.includes(key)) found.add(CHAIN_MAP[key])
    }
  }

  // Phase 2: Fuzzy matching on individual words against long chain keys
  // Only if phase 1 found nothing — avoids false positives
  if (found.size === 0) {
    for (const word of words) {
      if (word.length <= 3) continue // Too short for fuzzy chain matching
      const matched = fuzzyMatch(word, CHAIN_KEYS_LONG, 2)
      if (matched) found.add(CHAIN_MAP[matched])
    }
  }

  // Multi-chain keywords
  if (/\bmulti[- ]?chain\b/i.test(text) || /\bcross[- ]?chain\b/i.test(text)) {
    found.add("base-sepolia")
    found.add("ethereum-sepolia")
  }

  // Default to base-sepolia if no chain detected
  if (found.size === 0) {
    found.add(DEFAULT_CHAIN)
  }

  return [...found]
}

// ─────────────────────────────────────────────
// Data Source Detection (3-tier: exact → stemmed → fuzzy)
// ─────────────────────────────────────────────
function detectDataSources(keywords: string[], text: string): string[] {
  const sources: Set<string> = new Set()

  // Phase 1: 3-tier lookup on extracted keywords
  for (const kw of keywords) {
    const result = tieredLookup(kw, DATA_SOURCE_STEM, DATA_SOURCE_KEYS)
    if (result) sources.add(result)
  }

  // Phase 2: word-boundary scan for ≤3 char keys on raw text
  for (const key of DATA_SOURCE_KEYS) {
    if (key.length <= 3) {
      if (new RegExp("\\b" + key + "\\b", "i").test(text)) {
        sources.add(DATA_SOURCE_MAP[key])
      }
    }
  }

  return [...sources]
}

// ─────────────────────────────────────────────
// Action Detection (3-tier + multi-word)
// ─────────────────────────────────────────────
function detectActions(keywords: string[], text: string): string[] {
  const actions: Set<string> = new Set()

  // Phase 1: 3-tier lookup on extracted keywords (single-word keys only)
  for (const kw of keywords) {
    const result = tieredLookup(kw, ACTION_STEM, ACTION_KEYS_SINGLE)
    if (result) actions.add(result)
  }

  // Phase 2: multi-word ACTION_MAP keys checked against raw text
  const lower = text.toLowerCase()
  for (const key of ACTION_KEYS_MULTI) {
    if (lower.includes(key)) {
      actions.add(ACTION_MAP[key])
    }
  }

  // Default: if no actions detected, assume evmWrite
  if (actions.size === 0) {
    actions.add("evmWrite")
  }

  return [...actions]
}

// ─────────────────────────────────────────────
// Keyword Extraction
// ─────────────────────────────────────────────
const STOP_WORDS = new Set([
  "the", "and", "for", "that", "this", "with", "from",
  "when", "then", "than", "into", "onto", "each",
  "have", "will", "should", "could", "would",
  "create", "make", "build", "want", "need",
  "every", "also", "just", "like", "some",
])

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .filter((word) => !STOP_WORDS.has(word))
    .filter((word, i, arr) => arr.indexOf(word) === i)
}

// ─────────────────────────────────────────────
// Main Export: parseIntent
// ─────────────────────────────────────────────
export function parseIntent(prompt: string): ParsedIntent {
  const raw = prompt.trim()

  if (!raw) {
    return {
      triggerType: "unknown",
      confidence: 0,
      dataSources: [],
      conditions: [],
      actions: ["evmWrite"],
      chains: [DEFAULT_CHAIN],
      keywords: [],
      negated: false,
    }
  }

  // Step 0: Expand abbreviations ("min" → "minute", "hr" → "hour")
  const text = expandAbbreviations(raw)

  // Step 1: Extract raw keywords and compute stemmed variants
  const keywords = extractKeywords(text)
  const stemmedWords = keywords.map((w) => stemmer(w))

  // Step 2: Also stem raw whitespace-split words for trigger detection
  const allWords = text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(Boolean)
  const allStemmed = allWords.map((w) => stemmer(w))

  // Step 3: Detect negation
  const isNegated = detectNegation(text)

  // Step 4: Pipeline stages
  const { type: triggerType, confidence: rawConfidence } = detectTriggerType(text, allStemmed, allWords)
  const schedule = extractSchedule(text)
  const chains = resolveChains(text, allWords)
  const conditions = extractConditions(text)
  const dataSources = detectDataSources(keywords, text)
  const actions = detectActions(keywords, text)

  // Step 5: Adjust confidence for negation
  const confidence = isNegated ? rawConfidence * 0.4 : rawConfidence

  return {
    triggerType,
    confidence,
    schedule,
    dataSources,
    conditions,
    actions,
    chains,
    keywords,
    negated: isNegated,
  }
}
