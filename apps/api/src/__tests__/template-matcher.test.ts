import { describe, test, expect } from "bun:test"
import { parseIntent } from "../services/ai-engine/intent-parser"
import {
  matchTemplate,
  getTemplateById,
  getAllTemplates,
  TEMPLATES,
} from "../services/ai-engine/template-matcher"
import type { ParsedIntent } from "../services/ai-engine/types"

/**
 * Helper: construct a minimal ParsedIntent with controlled fields.
 * Allows testing scoreTemplate behavior by isolating single variables
 * (e.g., vary triggerType while holding keywords constant).
 */
function makeIntent(overrides: Partial<ParsedIntent>): ParsedIntent {
  return {
    triggerType: "unknown",
    confidence: 0,
    dataSources: [],
    conditions: [],
    actions: [],
    chains: ["base-sepolia"],
    keywords: [],
    negated: false,
    ...overrides,
  }
}

// ─────────────────────────────────────────────
// Suite 1: Template Reachability (10 tests)
// Each template must be reachable from a representative prompt.
// ─────────────────────────────────────────────

describe("Template Reachability", () => {
  test("T1: Price Monitoring + Alert", () => {
    const intent = parseIntent(
      "Monitor ETH price every minute and alert when it drops below $3000",
    )
    const match = matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(1)
    expect(match!.templateName).toBe("Price Monitoring + Alert")
    expect(match!.confidence).toBeGreaterThan(0.3)
  })

  test("T2: Cross-Chain Portfolio Rebalancer", () => {
    const intent = parseIntent(
      "Rebalance my multi-chain portfolio allocation every day based on yield drift",
    )
    const match = matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(2)
    expect(match!.confidence).toBeGreaterThan(0.3)
  })

  test("T3: AI Prediction Market Settlement", () => {
    const intent = parseIntent(
      "Settle prediction market outcomes using AI verification on contract event",
    )
    const match = matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(3)
    expect(match!.confidence).toBeGreaterThan(0.3)
  })

  test("T4: Stablecoin Issuance Pipeline", () => {
    const intent = parseIntent(
      "Mint stablecoins when a deposit request arrives, check compliance and reserve backing",
    )
    const match = matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(4)
    expect(match!.confidence).toBeGreaterThan(0.3)
  })

  test("T5: Proof of Reserve Monitor", () => {
    const intent = parseIntent(
      "Monitor proof of reserve collateralization ratio daily and publish attestation onchain",
    )
    const match = matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(5)
    expect(match!.confidence).toBeGreaterThan(0.3)
  })

  test("T6: Tokenized Fund Lifecycle", () => {
    const intent = parseIntent(
      "Handle fund subscription and redemption with NAV calculation for tokenized shares",
    )
    const match = matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(6)
    expect(match!.confidence).toBeGreaterThan(0.3)
  })

  test("T7: Parametric Insurance", () => {
    const intent = parseIntent(
      "Create parametric crop insurance payout when rainfall temperature drops below threshold",
    )
    const match = matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(7)
    expect(match!.confidence).toBeGreaterThan(0.3)
  })

  test("T8: Compliance-Gated DeFi Ops", () => {
    const intent = parseIntent(
      "Gate DeFi operations behind KYC AML compliance checks and sanctions blacklist screening",
    )
    const match = matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(8)
    expect(match!.confidence).toBeGreaterThan(0.3)
  })

  test("T9: Multi-AI Consensus Oracle", () => {
    const intent = parseIntent(
      "Query GPT Claude Gemini for multi-model AI consensus oracle to prevent hallucination",
    )
    const match = matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(9)
    expect(match!.confidence).toBeGreaterThan(0.3)
  })

  test("T10: Custom Data Feed / NAV Oracle", () => {
    const intent = parseIntent(
      "Aggregate custom data feed and publish weighted index oracle price onchain on schedule",
    )
    const match = matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(10)
    expect(match!.confidence).toBeGreaterThan(0.3)
  })
})

// ─────────────────────────────────────────────
// Suite 2: Edge Cases (5 tests)
// ─────────────────────────────────────────────

describe("Edge Cases", () => {
  test("garbage input returns null", () => {
    const intent = parseIntent("What is the meaning of life and the universe")
    const match = matchTemplate(intent)
    expect(match).toBeNull()
  })

  test("force override with valid ID returns confidence 1.0", () => {
    const intent = parseIntent("Anything at all here does not matter")
    const match = matchTemplate(intent, 5)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(5)
    expect(match!.confidence).toBe(1.0)
    expect(match!.templateName).toBe("Proof of Reserve Monitor")
  })

  test("force override with invalid ID returns null", () => {
    const intent = parseIntent("Anything at all here does not matter")
    const match = matchTemplate(intent, 99)
    expect(match).toBeNull()
  })

  test("force override returns intent.keywords as matchedKeywords", () => {
    const intent = parseIntent("Monitor proof of reserve ratio daily")
    const match = matchTemplate(intent, 3)
    expect(match).not.toBeNull()
    expect(match!.matchedKeywords).toEqual(intent.keywords)
  })

  test("all returned confidences are in [0, 1]", () => {
    const prompts = [
      "Monitor ETH price every minute and alert when it drops below $3000",
      "Rebalance my multi-chain portfolio allocation daily",
      "Settle prediction market outcomes using AI on contract event",
      "Mint stablecoins when deposit request arrives with compliance check",
      "Query GPT Claude Gemini for AI consensus oracle",
    ]
    for (const prompt of prompts) {
      const intent = parseIntent(prompt)
      const match = matchTemplate(intent)
      if (match) {
        expect(match.confidence).toBeGreaterThanOrEqual(0)
        expect(match.confidence).toBeLessThanOrEqual(1)
      }
    }
  })
})

// ─────────────────────────────────────────────
// Suite 3: Scoring Mechanics (6 tests)
// ─────────────────────────────────────────────

describe("Scoring Mechanics", () => {
  test("trigger match bonus increases confidence", () => {
    // Isolate trigger type by using identical keywords, varying only triggerType.
    // T1 (Price Monitoring) expects "cron". With cron trigger → +0.2 bonus.
    // With unknown trigger → no bonus/penalty. Same keywords, so keyword score identical.
    const t1Keywords = ["price", "monitor", "alert", "threshold", "drops", "below"]
    const withCron = matchTemplate(makeIntent({ triggerType: "cron", keywords: t1Keywords }))
    const withUnknown = matchTemplate(makeIntent({ triggerType: "unknown", keywords: t1Keywords }))

    expect(withCron).not.toBeNull()
    expect(withUnknown).not.toBeNull()
    expect(withCron!.templateId).toBe(1)
    expect(withUnknown!.templateId).toBe(1)
    // Cron match gets +0.2 bonus, unknown gets nothing → cron is exactly 0.2 higher
    expect(withCron!.confidence - withUnknown!.confidence).toBeCloseTo(0.2, 1)
  })

  test("trigger mismatch penalty decreases confidence", () => {
    // T3 (Prediction Market) expects "evm_log". With cron trigger → -0.15 penalty.
    // With evm_log → +0.2 bonus. Difference should be 0.35.
    const t3Keywords = ["prediction", "market", "settle", "outcome", "resolution", "binary", "result"]
    const withEvmLog = matchTemplate(makeIntent({ triggerType: "evm_log", keywords: t3Keywords }))
    const withCron = matchTemplate(makeIntent({ triggerType: "cron", keywords: t3Keywords }))

    expect(withEvmLog).not.toBeNull()
    expect(withCron).not.toBeNull()
    expect(withEvmLog!.templateId).toBe(3)
    expect(withCron!.templateId).toBe(3)
    // evm_log match: +0.2 bonus. cron mismatch: -0.15 penalty. Delta = 0.35.
    expect(withEvmLog!.confidence - withCron!.confidence).toBeCloseTo(0.35, 1)
  })

  test("data source affinity increases confidence", () => {
    // T7 (Parametric Insurance) requires "weather-api".
    // Prompt with weather keywords → parseIntent detects weather-api data source → +0.1 bonus.
    const intentWith = parseIntent(
      "Parametric insurance payout based on weather rainfall crop coverage",
    )
    const matchWith = matchTemplate(intentWith)

    const intentWithout = parseIntent(
      "Parametric insurance payout premium claim coverage",
    )
    const matchWithout = matchTemplate(intentWithout)

    // Both must match T7 — no vacuous guards
    expect(matchWith).not.toBeNull()
    expect(matchWith!.templateId).toBe(7)
    expect(matchWithout).not.toBeNull()
    expect(matchWithout!.templateId).toBe(7)
    // The version with weather-api data source affinity must score higher
    expect(matchWith!.confidence).toBeGreaterThan(matchWithout!.confidence)
  })

  test("threshold boundary: score just below 0.3 returns null", () => {
    const intent = parseIntent("Calculate something random unrelated to anything")
    const match = matchTemplate(intent)
    expect(match).toBeNull()
  })

  test("IDF weighting: unique keyword contributes more than common keyword", () => {
    // "polymarket" is unique to T3 (IDF ≈ 2.3), "oracle" is shared by T9+T10 (IDF ≈ 1.6).
    // A prompt with T3's unique keywords should strongly and unambiguously favor T3.
    const intent = parseIntent(
      "Polymarket prediction market bet wager settlement outcome resolution",
    )
    const match = matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(3)
    expect(match!.confidence).toBeGreaterThan(0.4)
  })

  test("ambiguity detection: nearly equal scores on two templates returns null", () => {
    // Constructed intent that matches ~6/14 of T1 and ~5/12 of T10 with close IDF-weighted scores.
    // T1 keywords hit: price, monitor, alert, threshold, drops, feed (6/14)
    // T10 keywords hit: feed, oracle, custom, publish, "price feed" (5/12)
    // With unknown trigger and no data source/action bonuses, the gap is < 0.05 → ambiguous.
    const ambiguousIntent = makeIntent({
      keywords: ["price", "monitor", "alert", "threshold", "feed", "drops", "oracle", "custom", "publish"],
    })
    const match = matchTemplate(ambiguousIntent)
    expect(match).toBeNull()
  })
})

// ─────────────────────────────────────────────
// Suite 3b: Negation Dampening (3 tests)
// ─────────────────────────────────────────────

describe("Negation Dampening", () => {
  test("negated prompt returns null — 'Do not monitor price, do not alert'", () => {
    const intent = parseIntent("Do not monitor the price, do not alert on anything")
    expect(intent.negated).toBe(true)
    const match = matchTemplate(intent)
    expect(match).toBeNull()
  })

  test("negated prompt has lower confidence than non-negated equivalent", () => {
    const normal = parseIntent("Monitor ETH price every minute and alert when it drops below $3000")
    const negated = parseIntent("Don't monitor ETH price every minute and don't alert when it drops below $3000")
    const matchNormal = matchTemplate(normal)
    const matchNegated = matchTemplate(negated)

    expect(matchNormal).not.toBeNull()
    // Negated version should either be null or have much lower confidence
    if (matchNegated !== null) {
      expect(matchNegated.confidence).toBeLessThan(matchNormal!.confidence * 0.5)
    }
  })

  test("'Never send alerts' returns null despite matching T1 keywords", () => {
    const intent = parseIntent("Never check price feeds or send alert notifications")
    expect(intent.negated).toBe(true)
    const match = matchTemplate(intent)
    expect(match).toBeNull()
  })
})

// ─────────────────────────────────────────────
// Suite 3c: Substring False Positive Prevention (3 tests)
// ─────────────────────────────────────────────

describe("Substring False Positive Prevention", () => {
  test("'aggregate' does NOT spuriously match 'gate' (T8 keyword)", () => {
    // "gate" is a T8 keyword for compliance gating
    // "aggregate" should not match it — they're semantically unrelated
    const intent = parseIntent("Aggregate custom data from multiple sources daily")
    const match = matchTemplate(intent)
    if (match !== null) {
      // Should match T10 (data feed), NOT T8 (compliance gating)
      expect(match.templateId).not.toBe(8)
      // "gate" should not appear in matched keywords
      expect(match.matchedKeywords).not.toContain("gate")
    }
  })

  test("'minute' does NOT spuriously match 'mint' (T4 keyword)", () => {
    // "mint" is a T4 keyword for stablecoin issuance
    // "minute" (time word) should not match it
    const intent = parseIntent("Every minute check the price feed and publish data")
    const match = matchTemplate(intent)
    if (match !== null) {
      expect(match.matchedKeywords).not.toContain("mint")
    }
  })

  test("valid prefix matches still work — 'monitoring' matches 'monitor'", () => {
    // "monitoring" starts with "monitor" — this is a valid morphological match
    const intent = parseIntent("Monitoring ETH price alerts threshold drops below watch feed")
    const match = matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(1)
    expect(match!.matchedKeywords).toContain("monitor")
  })
})

// ─────────────────────────────────────────────
// Suite 4: getTemplateById (3 tests)
// ─────────────────────────────────────────────

describe("getTemplateById", () => {
  test("valid ID returns correct template", () => {
    const template = getTemplateById(9)
    expect(template).not.toBeUndefined()
    expect(template!.name).toBe("Multi-AI Consensus Oracle")
    expect(template!.category).toBe("ai-powered")
    expect(template!.id).toBe(9)
  })

  test("ID 0 returns undefined", () => {
    expect(getTemplateById(0)).toBeUndefined()
  })

  test("ID 11 returns undefined", () => {
    expect(getTemplateById(11)).toBeUndefined()
  })
})

// ─────────────────────────────────────────────
// Suite 5: getAllTemplates (3 tests)
// ─────────────────────────────────────────────

describe("getAllTemplates", () => {
  test("returns exactly 10 templates", () => {
    const all = getAllTemplates()
    expect(all.length).toBe(10)
  })

  test("IDs are 1 through 10", () => {
    const all = getAllTemplates()
    const ids = all.map((t) => t.id).sort((a, b) => a - b)
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  test("all categories are valid enum values", () => {
    const validCategories = new Set([
      "core-defi",
      "institutional",
      "risk-compliance",
      "ai-powered",
    ])
    const all = getAllTemplates()
    for (const template of all) {
      expect(validCategories.has(template.category)).toBe(true)
    }
  })
})
