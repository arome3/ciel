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

  // GitHub / CI-CD (Doc 21)
  "github": "github-api",
  "gitlab": "github-api",
  "repository": "github-api",
  "pull request": "github-api",
  "merge": "github-api",
  "commit": "github-api",
  "contributor": "github-api",
  "cicd": "github-api",
  "pipeline": "github-api",

  // News & Sentiment (Doc 21)
  "news": "news-api",
  "reuters": "news-api",
  "bloomberg": "news-api",
  "headline": "news-api",
  "sentiment": "news-api",
  "article": "news-api",
  "press": "news-api",
  "media": "news-api",
  "inflation": "news-api",
  "breaking": "news-api",

  // Sports (Doc 21)
  "score": "sports-api",
  "game": "sports-api",
  "match": "sports-api",
  "tournament": "sports-api",
  "winner": "sports-api",
  "espn": "sports-api",
  "nfl": "sports-api",
  "nba": "sports-api",
  "super bowl": "sports-api",
  "world cup": "sports-api",
  "championship": "sports-api",

  // Social / Web3 Social (Doc 21)
  "twitter": "social-api",
  "tweet": "social-api",
  "farcaster": "social-api",
  "lens": "social-api",
  "follower": "social-api",
  "viral": "social-api",
  "trending": "social-api",
  "influencer": "social-api",
  "mention": "social-api",
  "hashtag": "social-api",

  // Exchange / CEX (Doc 21)
  "binance": "exchange-api",
  "coinbase": "exchange-api",
  "kraken": "exchange-api",
  "exchange": "exchange-api",
  "order book": "exchange-api",
  "spot price": "exchange-api",
  "trading pair": "exchange-api",
  "limit order": "exchange-api",
  "cex": "exchange-api",

  // Wallet / On-chain Analytics (Doc 21)
  "wallet": "wallet-api",
  "whale": "wallet-api",
  "address": "wallet-api",
  "balance": "wallet-api",
  "etherscan": "wallet-api",
  "portfolio": "wallet-api",
  "holdings": "wallet-api",
  "nonce": "wallet-api",
  "transaction history": "wallet-api",
}

// ── Disambiguation: keywords that are polysemous and need confirming context ──
const AMBIGUOUS_KEYWORDS = new Set([
  "score",        // sports-api — but "risk score", "credit score"
  "game",         // sports-api — but "game theory", "gamification"
  "balance",      // wallet-api — but "work-life balance", "rebalance"
  "match",        // sports-api — but "pattern match", "regex match"
  "address",      // wallet-api — but "address this issue"
  "exchange",     // exchange-api — but "data exchange", "information exchange"
  "pool",         // defi-api — but "thread pool", "connection pool"
  "media",        // news-api — but "media type", "rich media"
  "article",      // news-api — but "article of agreement"
  "portfolio",    // wallet-api — but "portfolio rebalancer" (T2 context)
  "holdings",     // wallet-api — but generic finance term
  "outcome",      // prediction-market — but "project outcome"
  "resolution",   // prediction-market — but "screen resolution"
])

// ── Entity map: brand names / proper nouns → data source (always non-ambiguous) ──
const ENTITY_MAP: Record<string, string> = {
  "binance": "exchange-api",
  "coinbase": "exchange-api",
  "kraken": "exchange-api",
  "reuters": "news-api",
  "bloomberg": "news-api",
  "espn": "sports-api",
  "twitter": "social-api",
  "farcaster": "social-api",
  "github": "github-api",
  "gitlab": "github-api",
  "etherscan": "wallet-api",
}

// Pre-compute stemmed lookup (includes both original keys and stemmed variants)
const DATA_SOURCE_STEM = buildStemmedMap(DATA_SOURCE_MAP)
const DATA_SOURCE_KEYS = Object.keys(DATA_SOURCE_MAP)
// Single-word keys only (multi-word handled by Phase 3)
const DATA_SOURCE_KEYS_SINGLE = DATA_SOURCE_KEYS.filter((k) => !k.includes(" "))
// Fuzzy matching for single-word keys >3 chars (disambiguation handles false positives)
const DATA_SOURCE_KEYS_FUZZY = DATA_SOURCE_KEYS_SINGLE.filter((k) => k.length > 3)
// Pre-compiled word-boundary regex for multi-word keys (prevents substring matches)
const DATA_SOURCE_MULTI_REGEX: Array<{ key: string; regex: RegExp; source: string }> =
  DATA_SOURCE_KEYS
    .filter((k) => k.includes(" "))
    .sort((a, b) => b.length - a.length)
    .map((k) => ({
      key: k,
      regex: new RegExp("\\b" + k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i"),
      source: DATA_SOURCE_MAP[k],
    }))

// Pre-compute: for each source, which keywords are NON-ambiguous (can confirm)
const CONFIRMING_BY_SOURCE: Record<string, Set<string>> = {}
for (const [key, source] of Object.entries(DATA_SOURCE_MAP)) {
  if (!AMBIGUOUS_KEYWORDS.has(key)) {
    if (!CONFIRMING_BY_SOURCE[source]) CONFIRMING_BY_SOURCE[source] = new Set()
    CONFIRMING_BY_SOURCE[source].add(key)
  }
}

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

  // DEX swaps (Template 11)
  "swap": "dexSwap",
  "buy": "dexSwap",
  "sell": "dexSwap",
  "trade": "dexSwap",
  "uniswap": "dexSwap",
  "sushiswap": "dexSwap",
  "dex": "dexSwap",
  "amm": "dexSwap",
  "slippage": "dexSwap",

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
// Pre-compiled word-boundary regex for multi-word action keys
const ACTION_MULTI_REGEX: Array<{ key: string; regex: RegExp; action: string }> =
  ACTION_KEYS
    .filter((k) => k.includes(" "))
    .sort((a, b) => b.length - a.length)
    .map((k) => ({
      key: k,
      regex: new RegExp("\\b" + k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i"),
      action: ACTION_MAP[k],
    }))

// ── dexSwap disambiguation: generic keywords that trigger dexSwap but are polysemous ──
const GENERIC_DEX_KEYWORDS = new Set(["buy", "sell", "trade", "exchange", "pool"])
// Confirming keywords: if at least one of these is present, dexSwap is intentional
const DEX_CONFIRMING_KEYWORDS = new Set([
  "swap", "uniswap", "sushiswap", "dex", "amm", "slippage",
  "liquidity", "router", "token",
])
// Pre-compiled word-boundary regex for short confirming keywords (≤4 chars)
const DEX_CONFIRMING_REGEX = /\b(?:dex|amm)\b/i

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
// Data Source Detection (3-tier + disambiguation + entity extraction)
// ─────────────────────────────────────────────
function detectDataSources(
  keywords: string[],
  text: string,
): { sources: string[]; entities: Record<string, string[]> } {
  const sources: Set<string> = new Set()
  const entities: Record<string, string[]> = {}
  // Track which keywords triggered each source (for disambiguation)
  const sourceTriggeredBy: Record<string, string[]> = {}

  const trackTrigger = (source: string, keyword: string) => {
    if (!sourceTriggeredBy[source]) sourceTriggeredBy[source] = []
    sourceTriggeredBy[source].push(keyword)
  }

  // Phase 1: 3-tier lookup on extracted keywords (single-word, >3 char fuzzy)
  for (const kw of keywords) {
    const result = tieredLookup(kw, DATA_SOURCE_STEM, DATA_SOURCE_KEYS_FUZZY)
    if (result) {
      sources.add(result)
      trackTrigger(result, kw)
    }
    // Entity extraction: brand names are always non-ambiguous
    if (ENTITY_MAP[kw]) {
      const entitySource = ENTITY_MAP[kw]
      sources.add(entitySource)
      trackTrigger(entitySource, kw)
      if (!entities[entitySource]) entities[entitySource] = []
      if (!entities[entitySource].includes(kw)) entities[entitySource].push(kw)
    }
  }

  // Phase 2: word-boundary scan for ≤3 char keys on raw text
  for (const key of DATA_SOURCE_KEYS) {
    if (key.length <= 3) {
      if (new RegExp("\\b" + key + "\\b", "i").test(text)) {
        sources.add(DATA_SOURCE_MAP[key])
        trackTrigger(DATA_SOURCE_MAP[key], key)
      }
    }
  }

  // Phase 3: multi-word keys with word-boundary protection
  for (const { key, regex, source } of DATA_SOURCE_MULTI_REGEX) {
    if (regex.test(text)) {
      sources.add(source)
      trackTrigger(source, key)
    }
  }

  // Phase 4: Disambiguation — remove sources with no confirming trigger
  // A trigger confirms a source if it's: a brand name (ENTITY_MAP), or a
  // non-ambiguous canonical key (direct or stemmed match against CONFIRMING_BY_SOURCE)
  for (const source of [...sources]) {
    const triggers = sourceTriggeredBy[source] || []
    if (triggers.length === 0) continue
    const confirming = CONFIRMING_BY_SOURCE[source]
    const hasConfirmation = triggers.some((kw) => {
      // Brand names always confirm
      if (ENTITY_MAP[kw] === source) return true
      // Direct non-ambiguous key match
      if (confirming && confirming.has(kw)) return true
      // Stemmed match against confirming keys
      if (confirming) {
        const kwStem = stemmer(kw)
        for (const ck of confirming) {
          if (stemmer(ck) === kwStem) return true
        }
      }
      return false
    })
    if (!hasConfirmation) {
      sources.delete(source)
    }
  }

  return { sources: [...sources], entities }
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

  // Phase 2: multi-word action keys with word-boundary protection
  for (const { regex, action } of ACTION_MULTI_REGEX) {
    if (regex.test(text)) {
      actions.add(action)
    }
  }

  // Phase 3: word-boundary scan for ≤3 char action keys on raw text
  for (const key of ACTION_KEYS) {
    if (key.length <= 3 && !key.includes(" ")) {
      if (new RegExp("\\b" + key + "\\b", "i").test(text)) {
        actions.add(ACTION_MAP[key])
      }
    }
  }

  // Phase 4: Action disambiguation — remove dexSwap if triggered only by generic keywords
  // Mirrors the data source disambiguation pattern (detectDataSources Phase 4)
  if (actions.has("dexSwap")) {
    const hasConfirming = keywords.some((kw) => DEX_CONFIRMING_KEYWORDS.has(kw))
      || DEX_CONFIRMING_REGEX.test(text)
    if (!hasConfirming) {
      actions.delete("dexSwap")
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
      entities: {},
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
  const { sources: dataSources, entities } = detectDataSources(keywords, text)
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
    entities,
  }
}
