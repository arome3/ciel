import type { ParsedIntent } from "./types"

// Re-export for downstream consumers
export type { ParsedIntent } from "./types"

// ─────────────────────────────────────────────
// Interfaces
// ─────────────────────────────────────────────

export interface TemplateDefinition {
  /** Unique template ID (1-10) */
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

// ─────────────────────────────────────────────
// Template Definitions (10 Templates)
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
    requiredCapabilities: ["price-feed", "alert"],
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
    ],
    requiredCapabilities: ["evmWrite", "multi-ai"],
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
    requiredCapabilities: ["weather-api", "evmWrite"],
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
    requiredCapabilities: ["compliance-api", "evmWrite"],
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
    requiredCapabilities: ["multi-ai", "evmWrite"],
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
    requiredCapabilities: ["price-feed", "evmWrite"],
    triggerType: "cron",
    defaultPromptFill:
      "Generate a CRE workflow that aggregates data from multiple custom sources " +
      "on a cron schedule. Apply weighting or averaging logic, validate the result, " +
      "and publish the aggregated data point onchain as a custom oracle via evmWrite.",
  },
]

// ─────────────────────────────────────────────
// IDF Precomputation (runs once at module load)
// ─────────────────────────────────────────────
// For each keyword across all templates, compute:
//   IDF = log(N / df)
// where N = total templates, df = number of templates containing this keyword.
// Unique keywords (df=1) get ~2.3x weight; common keywords (df=4+) get ~0.9x.

const N = TEMPLATES.length // 10

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
// Public API
// ─────────────────────────────────────────────

/**
 * Matches a ParsedIntent to the best CRE workflow template.
 *
 * @param intent - The structured intent from parseIntent()
 * @param forceTemplateId - Optional: force a specific template (returns confidence 1.0)
 * @returns The best TemplateMatch above threshold, or null if no match
 */
export function matchTemplate(
  intent: ParsedIntent,
  forceTemplateId?: number,
): TemplateMatch | null {
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

  // ── Score each template ──
  const scored: Array<{ match: TemplateMatch; score: number }> = []

  for (const template of TEMPLATES) {
    const { score, matchedKeywords } = scoreTemplate(template, intent)
    scored.push({
      score,
      match: {
        templateId: template.id,
        templateName: template.name,
        category: template.category,
        confidence: score,
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
    return null
  }

  // ── Ambiguity check ──
  // If the gap between #1 and #2 is < 0.05, the match is ambiguous
  if (runnerUp && best.score - runnerUp.score < AMBIGUITY_THRESHOLD) {
    return null
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
