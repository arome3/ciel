import type { ParsedIntent } from "./types"
import { isEmbeddingReady, embeddingScores } from "./embedding-matcher"

// Re-export for downstream consumers
export type { ParsedIntent } from "./types"

// ─────────────────────────────────────────────
// Interfaces
// ─────────────────────────────────────────────

export interface TemplateDefinition {
  /** Unique template ID (1-22) */
  id: number

  /** Human-readable template name */
  name: string

  /** Category for marketplace grouping */
  category: "core-defi" | "institutional" | "risk-compliance" | "ai-powered"

  /** Keywords that signal this template — used for scoring */
  keywords: string[]

  /** CRE capabilities this template requires */
  requiredCapabilities: string[]

  /** Expected trigger type */
  triggerType: "cron" | "http" | "evm_log"

  /** Default prompt fill for the LLM code generator */
  defaultPromptFill: string
}

export interface TemplateMatch {
  /** Matched template ID */
  templateId: number

  /** Matched template name */
  templateName: string

  /** Template category */
  category: string

  /** Confidence score [0, 1] */
  confidence: number

  /** Which keywords from the intent matched this template */
  matchedKeywords: string[]
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

/** Minimum confidence to return a match. Below this, return null. */
const CONFIDENCE_THRESHOLD = 0.3

/** Bonus added when trigger type matches */
const TRIGGER_MATCH_BONUS = 0.2

/** Penalty applied when trigger type mismatches (and intent is not "unknown") */
const TRIGGER_MISMATCH_PENALTY = 0.15

/** Minimum gap between top-2 scores to consider the match unambiguous */
const AMBIGUITY_THRESHOLD = 0.05

/** Weight for embedding signal in score fusion. 0 = keyword-only, 1.0 = embedding-only. */
const _rawEmbWeight = parseFloat(process.env.EMBEDDING_WEIGHT ?? "0.6")
const EMBEDDING_WEIGHT = Number.isFinite(_rawEmbWeight) ? Math.max(0, Math.min(1, _rawEmbWeight)) : 0.6

/** Weight for keyword signal in score fusion (complement of embedding weight) */
const KEYWORD_WEIGHT = 1 - EMBEDDING_WEIGHT

// ─────────────────────────────────────────────
// Template Definitions (22 Templates)
// ─────────────────────────────────────────────

export const TEMPLATES: TemplateDefinition[] = [
  // ─────────────────────────────────────────────
  // Core DeFi (Templates 1-3)
  // ─────────────────────────────────────────────
  {
    id: 1,
    name: "Price Monitoring + Alert",
    category: "core-defi",
    keywords: [
      "price", "monitor", "alert", "threshold", "drops",
      "below", "crosses", "above", "track", "watch",
      "notification", "warning", "alarm", "feed",
    ],
    requiredCapabilities: ["price-feed", "alert", "exchange-api"],
    triggerType: "cron",
    defaultPromptFill:
      "Generate a CRE workflow that monitors a price feed on a cron schedule. " +
      "When the price crosses a threshold, emit an alert action. " +
      "Use streams_lookup for the price data source and a cron trigger.",
  },

  {
    id: 2,
    name: "Cross-Chain Portfolio Rebalancer",
    category: "core-defi",
    keywords: [
      "rebalance", "portfolio", "allocation", "multi-chain",
      "balance", "yield", "drift", "weight", "cross-chain",
      "diversify", "ratio", "redistribute",
    ],
    requiredCapabilities: ["price-feed", "evmWrite", "multi-chain"],
    triggerType: "cron",
    defaultPromptFill:
      "Generate a CRE workflow that reads portfolio positions across multiple chains, " +
      "calculates drift from target allocations, and executes rebalancing trades via evmWrite. " +
      "Use a cron trigger for periodic checking.",
  },

  {
    id: 3,
    name: "AI Prediction Market Settlement",
    category: "core-defi",
    keywords: [
      "prediction", "market", "settle", "outcome", "resolution",
      "bet", "polymarket", "wager", "binary", "result",
      "prediction market", "settlement",
      "winners", "losers", "decided", "election",
      "game ends", "payout winners", "who won",
    ],
    requiredCapabilities: ["evmWrite", "multi-ai", "sports-api", "social-api", "news-api"],
    triggerType: "evm_log",
    defaultPromptFill:
      "Generate a CRE workflow that listens for prediction market resolution events, " +
      "queries multiple AI models to verify the outcome, applies consensus, " +
      "and writes the verified result onchain via evmWrite.",
  },

  // ─────────────────────────────────────────────
  // Institutional Finance (Templates 4-6)
  // ─────────────────────────────────────────────
  {
    id: 4,
    name: "Stablecoin Issuance Pipeline",
    category: "institutional",
    keywords: [
      "stablecoin", "mint", "issuance", "reserve", "compliance",
      "deposit", "usdc", "usdt", "peg", "backing",
      "collateralized", "fiat",
    ],
    requiredCapabilities: ["compliance-api", "reserve-api", "evmWrite"],
    triggerType: "http",
    defaultPromptFill:
      "Generate a CRE workflow triggered by an HTTP request (deposit notification). " +
      "Verify compliance status, check reserve backing ratio, and if both pass, " +
      "mint stablecoins via evmWrite to the depositor's address.",
  },

  {
    id: 5,
    name: "Proof of Reserve Monitor",
    category: "institutional",
    keywords: [
      "proof", "reserve", "collateralization", "ratio", "backed",
      "supply", "audit", "attestation", "solvency",
      "reserve ratio", "backing ratio",
    ],
    requiredCapabilities: ["reserve-api", "evmWrite"],
    triggerType: "cron",
    defaultPromptFill:
      "Generate a CRE workflow that periodically queries reserve holdings and token supply, " +
      "calculates the collateralization ratio, and writes a proof-of-reserve attestation " +
      "onchain via evmWrite. Alert if ratio drops below threshold.",
  },

  {
    id: 6,
    name: "Tokenized Fund Lifecycle",
    category: "institutional",
    keywords: [
      "fund", "subscription", "redemption", "nav", "shares",
      "tokenized", "asset management", "aum", "investor",
      "unit price", "lifecycle",
    ],
    requiredCapabilities: ["nav-api", "evmWrite", "compliance-api"],
    triggerType: "http",
    defaultPromptFill:
      "Generate a CRE workflow triggered by subscription/redemption HTTP requests. " +
      "Calculate current NAV, verify investor compliance, and process the transaction " +
      "by minting or burning fund token shares via evmWrite.",
  },

  // ─────────────────────────────────────────────
  // Risk & Compliance (Templates 7-8)
  // ─────────────────────────────────────────────
  {
    id: 7,
    name: "Parametric Insurance",
    category: "risk-compliance",
    keywords: [
      "insurance", "parametric", "weather", "payout", "flight",
      "delay", "crop", "rainfall", "temperature", "coverage",
      "premium", "claim", "trigger event",
    ],
    requiredCapabilities: ["weather-api", "evmWrite", "news-api"],
    triggerType: "cron",
    defaultPromptFill:
      "Generate a CRE workflow that periodically checks a weather/flight data source. " +
      "If the parametric trigger condition is met (e.g., rainfall below threshold, " +
      "flight delayed > 2 hours), automatically execute a payout via evmWrite.",
  },

  {
    id: 8,
    name: "Compliance-Gated DeFi Ops",
    category: "risk-compliance",
    keywords: [
      "compliance", "kyc", "aml", "blacklist", "sanctions",
      "gate", "screen", "check", "verify", "whitelist",
      "permitted", "restricted", "ofac",
    ],
    requiredCapabilities: ["compliance-api", "evmWrite", "wallet-api"],
    triggerType: "http",
    defaultPromptFill:
      "Generate a CRE workflow triggered by an HTTP request (DeFi operation). " +
      "Check the requesting address against compliance/sanctions lists. " +
      "If clear, proceed with the DeFi operation via evmWrite. If flagged, reject.",
  },

  // ─────────────────────────────────────────────
  // AI-Powered (Templates 9-10)
  // ─────────────────────────────────────────────
  {
    id: 9,
    name: "Multi-AI Consensus Oracle",
    category: "ai-powered",
    keywords: [
      "consensus", "multiple", "ai", "verify", "hallucination",
      "multi-model", "oracle", "gpt", "claude", "gemini",
      "agree", "median", "byzantine", "fault tolerant",
    ],
    requiredCapabilities: ["multi-ai", "evmWrite", "news-api", "social-api"],
    triggerType: "http",
    defaultPromptFill:
      "Generate a CRE workflow that queries 3 AI models (GPT-4o, Claude, Gemini) " +
      "for the same data point. Apply BFT consensus: reject outliers beyond max deviation, " +
      "compute the median of valid responses, and write the consensus value onchain via evmWrite. " +
      "This is the FLAGSHIP template — see 15-multi-ai-consensus-oracle.md for full details.",
  },

  {
    id: 10,
    name: "Custom Data Feed / NAV Oracle",
    category: "ai-powered",
    keywords: [
      "data", "feed", "oracle", "aggregate", "custom",
      "publish", "index", "composite", "weighted",
      "price feed", "data source", "api",
    ],
    requiredCapabilities: ["price-feed", "evmWrite", "github-api", "news-api", "sports-api", "social-api", "exchange-api", "wallet-api"],
    triggerType: "cron",
    defaultPromptFill:
      "Generate a CRE workflow that aggregates data from multiple custom sources " +
      "on a cron schedule. Apply weighting or averaging logic, validate the result, " +
      "and publish the aggregated data point onchain as a custom oracle via evmWrite.",
  },

  // ─────────────────────────────────────────────
  // DEX (Template 11)
  // ─────────────────────────────────────────────
  {
    id: 11,
    name: "Conditional DEX Swap",
    category: "core-defi",
    keywords: [
      "swap", "buy", "sell", "trade", "exchange", "uniswap", "dex",
      "amm", "slippage", "pool", "token", "price", "limit order",
      "conditional", "threshold", "below", "above", "drops",
    ],
    requiredCapabilities: ["price-feed", "dexSwap", "evmWrite"],
    triggerType: "cron",
    defaultPromptFill:
      "Generate a CRE workflow that monitors token prices on a cron schedule. " +
      "When the price crosses a configurable threshold, encode a Uniswap V3 " +
      "exactInputSingle call and execute via ethSendTransaction. " +
      "Report the execution result onchain via writeReport.",
  },

  // ─────────────────────────────────────────────
  // Wallet Monitoring (Template 12)
  // ─────────────────────────────────────────────
  {
    id: 12,
    name: "Wallet Activity Monitor",
    category: "core-defi",
    keywords: [
      "wallet", "watch", "monitor", "track", "whale", "transfer",
      "movement", "balance", "address", "holdings", "sends",
      "receives", "moves", "large", "threshold", "alert",
      "portfolio", "activity", "token", "erc20",
    ],
    requiredCapabilities: ["wallet-api", "alert", "evmWrite"],
    triggerType: "evm_log",
    defaultPromptFill:
      "Generate a CRE workflow that listens for ERC-20 Transfer events using EVMLogCapability. " +
      "Decode the from/to addresses and transfer value from the event log. " +
      "Filter by watched addresses and minimum amount threshold. " +
      "Execute a response action: alert via webhook, write report onchain, or trigger a reactive DEX swap.",
  },

  // ─────────────────────────────────────────────
  // Chainlink Data Feed Reader (Template 13)
  // ─────────────────────────────────────────────
  {
    id: 13,
    name: "Chainlink Data Feed Reader",
    category: "core-defi",
    keywords: [
      "data feed", "chainlink", "latestAnswer", "price proxy",
      "aggregator", "decimals", "feed", "onchain price",
      "contract read", "callContract", "price oracle",
      "read contract", "onchain data", "chainlink price feed",
      "read onchain",
    ],
    requiredCapabilities: ["chainlink-feeds", "evmRead", "evmWrite"],
    triggerType: "cron",
    defaultPromptFill:
      "Generate a CRE workflow that reads Chainlink Data Feed prices on a cron schedule. " +
      "Use callContract with encodeCallMsg and LAST_FINALIZED_BLOCK_NUMBER to read decimals() " +
      "and latestAnswer() from the feed proxy contract. Decode results with bytesToHex and " +
      "decodeFunctionResult, then write the price report onchain.",
  },

  // ─────────────────────────────────────────────
  // KV Store / Stateful Workflow (Template 14)
  // ─────────────────────────────────────────────
  {
    id: 14,
    name: "Stateful KV Store Workflow",
    category: "ai-powered",
    keywords: [
      "stateful", "persist", "remember", "counter", "accumulate",
      "s3", "storage", "history", "rolling", "trend",
      "state", "kv store", "key value", "previous",
    ],
    requiredCapabilities: ["kv-store", "evmWrite"],
    triggerType: "cron",
    defaultPromptFill:
      "Generate a CRE workflow that reads and writes state to an AWS S3 KV store. " +
      "Use ConfidentialHTTPClient with SigV4 signing and @noble/hashes for HMAC. " +
      "Track cross-run state (counters, history arrays, moving averages) " +
      "and write the latest state onchain.",
  },

  // ─────────────────────────────────────────────
  // Cross-Chain CCIP Transfer (Template 15)
  // ─────────────────────────────────────────────
  {
    id: 15,
    name: "Cross-Chain CCIP Transfer",
    category: "institutional",
    keywords: [
      "ccip", "cross-chain", "bridge", "multi-chain", "interoperability",
      "chain transfer", "token bridge", "cross chain send",
      "multi-chain token", "lane",
    ],
    requiredCapabilities: ["ccip", "evmWrite", "ccipTransfer"],
    triggerType: "cron",
    defaultPromptFill:
      "Generate a CRE workflow that monitors token balances across chains and " +
      "executes cross-chain CCIP token transfers when conditions are met. " +
      "Use getNetwork for multi-chain resolution and EVMClient for contract interactions.",
  },

  // ─────────────────────────────────────────────
  // Dual-Trigger Workflow (Template 16)
  // ─────────────────────────────────────────────
  {
    id: 16,
    name: "Dual-Trigger Workflow",
    category: "core-defi",
    keywords: [
      "dual trigger", "both schedule and event", "cron and event",
      "multiple triggers", "schedule and log", "hybrid trigger",
      "two triggers", "combined trigger",
      "timer and event", "scheduled and reactive",
      "periodic and event", "schedule and listen",
      "both cron", "both schedule", "two handlers",
      "cron and log",
    ],
    requiredCapabilities: ["price-feed", "evmWrite"],
    triggerType: "cron",
    defaultPromptFill:
      "Generate a CRE workflow that responds to both scheduled execution (cron) and " +
      "on-chain events (evm_log). Return multiple cre.handler() entries from initWorkflow. " +
      "Each trigger has its own named handler function.",
  },
  // ═══════════════════════════════════════════════
  // Institutional Gap Templates (17-22)
  // ═══════════════════════════════════════════════

  // ─────────────────────────────────────────────
  // Stablecoin Redemption/Burn (Template 17)
  // ─────────────────────────────────────────────
  {
    id: 17,
    name: "Stablecoin Redemption/Burn",
    category: "institutional",
    keywords: [
      "stablecoin", "burn", "redeem", "redemption", "destroy",
      "compliance", "usdc", "usdt", "token burn", "supply reduction",
      "burn redeem", "stablecoin redeem",
    ],
    requiredCapabilities: ["compliance-api", "burn", "evmWrite"],
    triggerType: "http",
    defaultPromptFill:
      "Generate a CRE workflow triggered by an HTTP request (redemption request). " +
      "Verify compliance status, check token balance via callContract, and burn tokens " +
      "via evmWrite. Report the burn onchain with a two-step report.",
  },

  // ─────────────────────────────────────────────
  // Payment Initiation & Confirmation (Template 18)
  // ─────────────────────────────────────────────
  {
    id: 18,
    name: "Payment Initiation & Confirmation",
    category: "institutional",
    keywords: [
      "payment", "swift", "wire", "initiate", "bank",
      "remittance", "confirmation", "transfer", "payment initiation",
      "wire transfer", "bank transfer", "payment status",
    ],
    requiredCapabilities: ["payment-api", "initiatePayment", "evmWrite", "kv-store"],
    triggerType: "cron",
    defaultPromptFill:
      "Generate a CRE workflow that periodically fetches pending payments from a payment API, " +
      "validates amounts, initiates payments via ConfidentialHTTPClient, tracks idempotency " +
      "via KV store, and records results onchain via evmWrite.",
  },

  // ─────────────────────────────────────────────
  // Escrow Lock/Release (Template 19)
  // ─────────────────────────────────────────────
  {
    id: 19,
    name: "Escrow Lock/Release",
    category: "institutional",
    keywords: [
      "escrow", "lock", "release", "collateral", "hold",
      "dvp", "delivery", "escrow lock",
      "escrow release", "lock funds", "unlock", "conditional",
    ],
    requiredCapabilities: ["settlement-api", "escrowLock", "escrowRelease", "evmWrite"],
    triggerType: "http",
    defaultPromptFill:
      "Generate a CRE workflow triggered by an HTTP request. Check escrow conditions " +
      "via settlement API. If conditions are met, release escrowed funds via evmWrite. " +
      "Otherwise, lock funds in the escrow contract. Report the action onchain.",
  },

  // ─────────────────────────────────────────────
  // Settlement Reconciliation (Template 20)
  // ─────────────────────────────────────────────
  {
    id: 20,
    name: "Settlement Reconciliation",
    category: "institutional",
    keywords: [
      "settlement", "reconciliation", "clearing", "netting", "dvp",
      "t+1", "matching", "attestation", "mismatch", "reconcile",
      "settlement cycle", "delivery versus payment",
    ],
    requiredCapabilities: ["settlement-api", "evmWrite", "alert"],
    triggerType: "cron",
    defaultPromptFill:
      "Generate a CRE workflow that periodically fetches settlement records from a settlement API, " +
      "reads on-chain settlement state via callContract, compares for mismatches, " +
      "alerts on discrepancies, and writes a reconciliation attestation onchain.",
  },

  // ─────────────────────────────────────────────
  // Shareholder Registry (Template 21)
  // ─────────────────────────────────────────────
  {
    id: 21,
    name: "Shareholder Registry",
    category: "institutional",
    keywords: [
      "shareholder", "registry", "cap table", "transfer agent",
      "equity", "share register", "beneficial owner", "holder",
      "equity holder", "share transfer",
    ],
    requiredCapabilities: ["registry-api", "compliance-api", "evmWrite"],
    triggerType: "http",
    defaultPromptFill:
      "Generate a CRE workflow triggered by an HTTP request (share transfer). " +
      "Validate the transfer parties against the registry API, check compliance, " +
      "and update the on-chain shareholder registry via evmWrite.",
  },

  // ─────────────────────────────────────────────
  // Dividend Distribution (Template 22)
  // ─────────────────────────────────────────────
  {
    id: 22,
    name: "Dividend Distribution",
    category: "institutional",
    keywords: [
      "dividend", "distribution", "shareholder payout",
      "pro rata", "dividend payout", "distribute dividend",
      "proportional", "holder payout", "monthly", "quarterly",
    ],
    requiredCapabilities: ["registry-api", "distribute", "evmWrite"],
    triggerType: "cron",
    defaultPromptFill:
      "Generate a CRE workflow that periodically fetches the holder list from a registry API, " +
      "calculates pro-rata dividend amounts, executes batch token transfers via evmWrite, " +
      "and reports the distribution summary onchain.",
  },
]

// ─────────────────────────────────────────────
// IDF Precomputation (runs once at module load)
// ─────────────────────────────────────────────
// For each keyword across all templates, compute:
//   IDF = log(N / df)
// where N = total templates, df = number of templates containing this keyword.
// Unique keywords (df=1) get ~2.3x weight; common keywords (df=4+) get ~0.9x.

const N = TEMPLATES.length

const IDF_WEIGHTS: Record<string, number> = {}

// Count document frequency for each keyword
const dfCounts: Record<string, number> = {}
for (const template of TEMPLATES) {
  // Deduplicate keywords within a single template for df counting
  const seen = new Set<string>()
  for (const kw of template.keywords) {
    if (!seen.has(kw)) {
      seen.add(kw)
      dfCounts[kw] = (dfCounts[kw] || 0) + 1
    }
  }
}

// Compute IDF weight for each keyword
for (const [kw, df] of Object.entries(dfCounts)) {
  IDF_WEIGHTS[kw] = Math.log(N / df)
}

// ─────────────────────────────────────────────
// Scoring
// ─────────────────────────────────────────────

/**
 * Scores a single template against a ParsedIntent.
 *
 * Algorithm:
 *   1. Keyword matching: substring match in either direction
 *   2. IDF-weighted base score: weightedMatchSum / totalWeightSum
 *   3. Trigger bonus/penalty
 *   4. Data source affinity (+0.1 each, max 0.2)
 *   5. Action affinity (+0.05 each, max 0.1)
 *   6. Clamp to [0, 1]
 */
function scoreTemplate(
  template: TemplateDefinition,
  intent: ParsedIntent,
): { score: number; matchedKeywords: string[] } {
  const intentKeywords = new Set(intent.keywords)
  const matchedKeywords: string[] = []

  // ── Keyword matching ──
  // Two directions:
  //   1. intentKeyword.startsWith(templateKeyword) — handles morphological suffixes
  //      (monitor→monitoring, settle→settlement, weight→weighted)
  //      Using startsWith instead of includes to prevent infix false positives
  //      like "aggregate" containing "gate" or "minute" containing "mint"
  //   2. templateKeyword.includes(intentKeyword) — handles multi-word template keywords
  //      ("prediction market" contains "prediction", "data source" contains "data")
  for (const templateKeyword of template.keywords) {
    for (const intentKeyword of intentKeywords) {
      if (
        intentKeyword === templateKeyword ||
        intentKeyword.startsWith(templateKeyword) ||
        templateKeyword.includes(intentKeyword)
      ) {
        matchedKeywords.push(templateKeyword)
        break
      }
    }
  }

  // ── IDF-weighted base score ──
  let weightedMatchSum = 0
  let totalWeightSum = 0

  for (const kw of template.keywords) {
    const weight = IDF_WEIGHTS[kw] ?? Math.log(N) // Default to max IDF if unknown
    totalWeightSum += weight
    if (matchedKeywords.includes(kw)) {
      weightedMatchSum += weight
    }
  }

  let score = totalWeightSum > 0 ? weightedMatchSum / totalWeightSum : 0

  // ── Trigger type bonus/penalty ──
  if (intent.triggerType !== "unknown") {
    if (intent.triggerType === template.triggerType) {
      score += TRIGGER_MATCH_BONUS
    } else {
      score -= TRIGGER_MISMATCH_PENALTY
    }
  }

  // ── Data source affinity bonus ──
  // +0.1 per overlap with requiredCapabilities, max 0.2
  let dataSourceBonus = 0
  for (const ds of intent.dataSources) {
    if (template.requiredCapabilities.includes(ds)) {
      dataSourceBonus += 0.1
    }
  }
  score += Math.min(dataSourceBonus, 0.2)

  // ── Action affinity bonus ──
  // +0.05 per overlap with requiredCapabilities, max 0.1
  let actionBonus = 0
  for (const action of intent.actions) {
    if (template.requiredCapabilities.includes(action)) {
      actionBonus += 0.05
    }
  }
  score += Math.min(actionBonus, 0.1)

  // ── Dual-trigger heuristic (T16) ──
  // If both cron and evmLog signals are present, T16 gets a significant boost
  if (template.id === 16 && intent.triggerScores) {
    if (intent.triggerScores.cron > 0 && intent.triggerScores.evmLog > 0) {
      score += 0.25
    }
  }

  // ── Negation dampening ──
  // If the intent parser detected negation ("don't monitor", "never alert"),
  // dampen the score by 60% (multiply by 0.4). This mirrors the intent parser's
  // own negation penalty and pushes most negated prompts below threshold.
  if (intent.negated) {
    score *= 0.4
  }

  // ── Clamp to [0, 1] ──
  score = Math.max(0, Math.min(1, score))

  return { score, matchedKeywords }
}

// ─────────────────────────────────────────────
// Capability-Based Fallback
// ─────────────────────────────────────────────

/**
 * Last-resort routing when keyword scoring fails (below threshold or ambiguous).
 * Checks unambiguous data source + action combinations to route to the right template.
 * Returns a low-confidence match with a "capability-fallback" flag.
 */
function fallbackByCapabilities(intent: ParsedIntent): TemplateMatch | null {
  // Never offer a fallback for negated intents
  if (intent.negated) return null

  const ds = new Set(intent.dataSources)
  const acts = new Set(intent.actions)

  // Order matters: check more specific combinations first
  if (ds.has("wallet-api") && (intent.triggerType === "evm_log" || acts.has("alert"))) {
    const t = TEMPLATES.find((t) => t.id === 12)!
    return { templateId: 12, templateName: t.name, category: t.category, confidence: 0.35, matchedKeywords: ["capability-fallback"] }
  }
  if (acts.has("dexSwap") && ds.has("price-feed")) {
    const t = TEMPLATES.find((t) => t.id === 11)!
    return { templateId: 11, templateName: t.name, category: t.category, confidence: 0.35, matchedKeywords: ["capability-fallback"] }
  }
  if (ds.has("weather-api") && acts.has("payout")) {
    const t = TEMPLATES.find((t) => t.id === 7)!
    return { templateId: 7, templateName: t.name, category: t.category, confidence: 0.35, matchedKeywords: ["capability-fallback"] }
  }
  if (acts.has("alert") && ds.has("price-feed")) {
    const t = TEMPLATES.find((t) => t.id === 1)!
    return { templateId: 1, templateName: t.name, category: t.category, confidence: 0.35, matchedKeywords: ["capability-fallback"] }
  }
  if (ds.has("ccip")) {
    const t = TEMPLATES.find((t) => t.id === 15)!
    return { templateId: 15, templateName: t.name, category: t.category, confidence: 0.35, matchedKeywords: ["capability-fallback"] }
  }
  if (ds.has("kv-store")) {
    const t = TEMPLATES.find((t) => t.id === 14)!
    return { templateId: 14, templateName: t.name, category: t.category, confidence: 0.35, matchedKeywords: ["capability-fallback"] }
  }
  if (ds.has("multi-ai")) {
    const t = TEMPLATES.find((t) => t.id === 9)!
    return { templateId: 9, templateName: t.name, category: t.category, confidence: 0.35, matchedKeywords: ["capability-fallback"] }
  }
  if (acts.has("burn") && ds.has("compliance-api")) {
    const t = TEMPLATES.find((t) => t.id === 17)!
    return { templateId: 17, templateName: t.name, category: t.category, confidence: 0.35, matchedKeywords: ["capability-fallback"] }
  }
  if (ds.has("payment-api") && (acts.has("initiatePayment") || acts.has("transfer"))) {
    const t = TEMPLATES.find((t) => t.id === 18)!
    return { templateId: 18, templateName: t.name, category: t.category, confidence: 0.35, matchedKeywords: ["capability-fallback"] }
  }
  if (acts.has("escrowLock") || acts.has("escrowRelease")) {
    const t = TEMPLATES.find((t) => t.id === 19)!
    return { templateId: 19, templateName: t.name, category: t.category, confidence: 0.35, matchedKeywords: ["capability-fallback"] }
  }
  if (ds.has("settlement-api")) {
    const t = TEMPLATES.find((t) => t.id === 20)!
    return { templateId: 20, templateName: t.name, category: t.category, confidence: 0.35, matchedKeywords: ["capability-fallback"] }
  }
  if (ds.has("registry-api") && acts.has("distribute")) {
    const t = TEMPLATES.find((t) => t.id === 22)!
    return { templateId: 22, templateName: t.name, category: t.category, confidence: 0.35, matchedKeywords: ["capability-fallback"] }
  }
  if (ds.has("registry-api")) {
    const t = TEMPLATES.find((t) => t.id === 21)!
    return { templateId: 21, templateName: t.name, category: t.category, confidence: 0.35, matchedKeywords: ["capability-fallback"] }
  }

  return null
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * Matches a ParsedIntent to the best CRE workflow template.
 *
 * When embedding model is loaded, fuses keyword scores with semantic embedding
 * scores: finalScore = KEYWORD_WEIGHT * keywordScore + EMBEDDING_WEIGHT * embeddingScore
 *
 * @param intent - The structured intent from parseIntent()
 * @param forceTemplateId - Optional: force a specific template (returns confidence 1.0)
 * @param prompt - Optional: raw prompt text for embedding scoring
 * @returns The best TemplateMatch above threshold, or null if no match
 */
export async function matchTemplate(
  intent: ParsedIntent,
  forceTemplateId?: number,
  prompt?: string,
): Promise<TemplateMatch | null> {
  // ── Force override path ──
  if (forceTemplateId !== undefined) {
    const forced = TEMPLATES.find((t) => t.id === forceTemplateId)
    if (!forced) {
      return null // Invalid template ID
    }
    return {
      templateId: forced.id,
      templateName: forced.name,
      category: forced.category,
      confidence: 1.0,
      matchedKeywords: intent.keywords,
    }
  }

  // ── Get embedding scores if available ──
  const embScores = (prompt && isEmbeddingReady() && EMBEDDING_WEIGHT > 0)
    ? await embeddingScores(prompt)
    : []
  const embScoreMap = new Map(embScores.map((e) => [e.templateId, e.score]))

  // ── Score each template ──
  const scored: Array<{ match: TemplateMatch; score: number }> = []

  for (const template of TEMPLATES) {
    const { score: keywordScore, matchedKeywords } = scoreTemplate(template, intent)

    // Fuse signals if embedding scores available
    let finalScore: number
    if (embScoreMap.size > 0) {
      const embScore = embScoreMap.get(template.id) ?? 0
      finalScore = KEYWORD_WEIGHT * keywordScore + EMBEDDING_WEIGHT * embScore
    } else {
      finalScore = keywordScore
    }

    // Clamp after fusion: keyword scoring can exceed 1.0 (trigger bonus + data source
    // affinity + dual-trigger boost), and fusion must stay in [0, 1]
    finalScore = Math.max(0, Math.min(1, finalScore))

    scored.push({
      score: finalScore,
      match: {
        templateId: template.id,
        templateName: template.name,
        category: template.category,
        confidence: finalScore,
        matchedKeywords,
      },
    })
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score)

  const best = scored[0]
  const runnerUp = scored[1]

  // ── Threshold check ──
  if (!best || best.score < CONFIDENCE_THRESHOLD) {
    return fallbackByCapabilities(intent)
  }

  // ── Ambiguity check ──
  // If the gap between #1 and #2 is < 0.05, the match is ambiguous
  if (runnerUp && best.score - runnerUp.score < AMBIGUITY_THRESHOLD) {
    return fallbackByCapabilities(intent)
  }

  return best.match
}

/**
 * Returns a template definition by ID. Used by the code generator (stage 3).
 */
export function getTemplateById(id: number): TemplateDefinition | undefined {
  return TEMPLATES.find((t) => t.id === id)
}

/**
 * Returns all templates. Used by the frontend for template browsing.
 */
export function getAllTemplates(): TemplateDefinition[] {
  return TEMPLATES
}
