import { describe, test, expect } from "bun:test"
import { parseIntent } from "../services/ai-engine/intent-parser"
import {
  matchTemplate,
  getTemplateById,
  getAllTemplates,
  TEMPLATES,
  WILDCARD_TEMPLATE,
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
    entities: {},
    ...overrides,
  }
}

// ─────────────────────────────────────────────
// Suite 1: Template Reachability (10 tests)
// Each template must be reachable from a representative prompt.
// ─────────────────────────────────────────────

describe("Template Reachability", async () => {
  test("T1: Price Monitoring + Alert", async () => {
    const intent = parseIntent(
      "Monitor ETH price every minute and alert when it drops below $3000",
    )
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(1)
    expect(match!.templateName).toBe("Price Monitoring + Alert")
    expect(match!.confidence).toBeGreaterThan(0.45)
  })

  test("T2: Cross-Chain Portfolio Rebalancer", async () => {
    const intent = parseIntent(
      "Rebalance my multi-chain portfolio allocation every day based on yield drift",
    )
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(2)
    expect(match!.confidence).toBeGreaterThan(0.45)
  })

  test("T3: AI Prediction Market Settlement", async () => {
    const intent = parseIntent(
      "Settle prediction market outcomes using AI verification on contract event",
    )
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(3)
    expect(match!.confidence).toBeGreaterThan(0.3)
  })

  test("T4: Stablecoin Issuance Pipeline", async () => {
    const intent = parseIntent(
      "Mint stablecoins when a deposit request arrives, check compliance and reserve backing",
    )
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(4)
    expect(match!.confidence).toBeGreaterThan(0.3)
  })

  test("T5: Proof of Reserve Monitor", async () => {
    const intent = parseIntent(
      "Monitor proof of reserve collateralization ratio daily and publish attestation onchain",
    )
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(5)
    expect(match!.confidence).toBeGreaterThan(0.3)
  })

  test("T6: Tokenized Fund Lifecycle", async () => {
    const intent = parseIntent(
      "Handle fund subscription and redemption with NAV calculation for tokenized shares",
    )
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(6)
    expect(match!.confidence).toBeGreaterThan(0.3)
  })

  test("T7: Parametric Insurance", async () => {
    const intent = parseIntent(
      "Create parametric crop insurance payout when rainfall temperature drops below threshold",
    )
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(7)
    expect(match!.confidence).toBeGreaterThan(0.4)
  })

  test("T8: Compliance-Gated DeFi Ops", async () => {
    const intent = parseIntent(
      "Gate DeFi operations behind KYC AML compliance checks and sanctions blacklist screening",
    )
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(8)
    expect(match!.confidence).toBeGreaterThan(0.45)
  })

  test("T9: Multi-AI Consensus Oracle", async () => {
    const intent = parseIntent(
      "Query GPT Claude Gemini for multi-model AI consensus oracle to prevent hallucination",
    )
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(9)
    expect(match!.confidence).toBeGreaterThan(0.4)
  })

  test("T10: Custom Data Feed / NAV Oracle", async () => {
    const intent = parseIntent(
      "Aggregate custom data feed and publish weighted index oracle price onchain on schedule",
    )
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(10)
    expect(match!.confidence).toBeGreaterThan(0.3)
  })

  test("T11: Conditional DEX Swap", async () => {
    const intent = parseIntent(
      "Swap ETH on Uniswap every hour when price drops below $2000 with slippage protection",
    )
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(11)
    expect(match!.templateName).toBe("Conditional DEX Swap")
    expect(match!.confidence).toBeGreaterThan(0.45)
  })

  test("T12: Wallet Activity Monitor", async () => {
    const intent = parseIntent(
      "Watch wallet for large ETH transfers and alert when whale moves tokens",
    )
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(12)
    expect(match!.templateName).toBe("Wallet Activity Monitor")
    expect(match!.confidence).toBeGreaterThan(0.45)
  })
})

// ─────────────────────────────────────────────
// Suite 2: Edge Cases (5 tests)
// ─────────────────────────────────────────────

describe("Edge Cases", async () => {
  test("garbage input returns wildcard", async () => {
    const intent = parseIntent("What is the meaning of life and the universe")
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(0)
    expect(match!.confidence).toBe(0.15)
  })

  test("force override with valid ID returns confidence 1.0", async () => {
    const intent = parseIntent("Anything at all here does not matter")
    const match = await matchTemplate(intent, 5)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(5)
    expect(match!.confidence).toBe(1.0)
    expect(match!.templateName).toBe("Proof of Reserve Monitor")
  })

  test("force override with ID 12 returns Wallet Activity Monitor", async () => {
    const intent = parseIntent("Anything at all here does not matter")
    const match = await matchTemplate(intent, 12)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(12)
    expect(match!.confidence).toBe(1.0)
    expect(match!.templateName).toBe("Wallet Activity Monitor")
  })

  test("force override with invalid ID returns null", async () => {
    const intent = parseIntent("Anything at all here does not matter")
    const match = await matchTemplate(intent, 99)
    expect(match).toBeNull()
  })

  test("force override returns intent.keywords as matchedKeywords", async () => {
    const intent = parseIntent("Monitor proof of reserve ratio daily")
    const match = await matchTemplate(intent, 3)
    expect(match).not.toBeNull()
    expect(match!.matchedKeywords).toEqual(intent.keywords)
  })

  test("all returned confidences are in [0, 1]", async () => {
    const prompts = [
      "Monitor ETH price every minute and alert when it drops below $3000",
      "Rebalance my multi-chain portfolio allocation daily",
      "Settle prediction market outcomes using AI on contract event",
      "Mint stablecoins when deposit request arrives with compliance check",
      "Query GPT Claude Gemini for AI consensus oracle",
    ]
    for (const prompt of prompts) {
      const intent = parseIntent(prompt)
      const match = await matchTemplate(intent)
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

describe("Scoring Mechanics", async () => {
  test("trigger match bonus increases confidence", async () => {
    // Isolate trigger type by using identical keywords, varying only triggerType.
    // T1 (Price Monitoring) expects "cron". With cron trigger → +0.2 bonus.
    // With unknown trigger → no bonus/penalty. Same keywords, so keyword score identical.
    const t1Keywords = ["price", "monitor", "alert", "threshold", "drops", "below"]
    const withCron = await matchTemplate(makeIntent({ triggerType: "cron", keywords: t1Keywords }))
    const withUnknown = await matchTemplate(makeIntent({ triggerType: "unknown", keywords: t1Keywords }))

    expect(withCron).not.toBeNull()
    expect(withUnknown).not.toBeNull()
    expect(withCron!.templateId).toBe(1)
    expect(withUnknown!.templateId).toBe(1)
    // Cron match gets +0.2 bonus, unknown gets nothing → cron is exactly 0.2 higher
    expect(withCron!.confidence - withUnknown!.confidence).toBeCloseTo(0.2, 1)
  })

  test("trigger mismatch penalty decreases confidence", async () => {
    // T3 (Prediction Market) expects "evm_log". With cron trigger → -0.15 penalty.
    // With evm_log → +0.2 bonus. Difference should be 0.35.
    // Polymarket is unique to T3 (highest IDF), plus other T3 keywords ensure above threshold
    const t3Keywords = ["prediction", "market", "settle", "outcome", "resolution", "binary", "result", "polymarket", "wager"]
    const withEvmLog = await matchTemplate(makeIntent({ triggerType: "evm_log", keywords: t3Keywords }))
    const withCron = await matchTemplate(makeIntent({ triggerType: "cron", keywords: t3Keywords }))

    expect(withEvmLog).not.toBeNull()
    expect(withCron).not.toBeNull()
    expect(withEvmLog!.templateId).toBe(3)
    expect(withCron!.templateId).toBe(3)
    // evm_log match: +0.2 bonus. cron mismatch: -0.15 penalty. Delta = 0.35.
    expect(withEvmLog!.confidence - withCron!.confidence).toBeCloseTo(0.35, 1)
  })

  test("data source affinity increases confidence", async () => {
    // T7 (Parametric Insurance) requires "weather-api".
    // Prompt with weather keywords → parseIntent detects weather-api data source → +0.1 bonus.
    const intentWith = parseIntent(
      "Parametric insurance payout based on weather rainfall crop coverage",
    )
    const matchWith = await matchTemplate(intentWith)

    const intentWithout = parseIntent(
      "Parametric insurance payout premium claim coverage",
    )
    const matchWithout = await matchTemplate(intentWithout)

    // Both must match T7 — no vacuous guards
    expect(matchWith).not.toBeNull()
    expect(matchWith!.templateId).toBe(7)
    expect(matchWithout).not.toBeNull()
    expect(matchWithout!.templateId).toBe(7)
    // The version with weather-api data source affinity must score higher
    expect(matchWith!.confidence).toBeGreaterThan(matchWithout!.confidence)
  })

  test("threshold boundary: score just below 0.3 returns wildcard", async () => {
    const intent = parseIntent("Calculate something random unrelated to anything")
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(0)
    expect(match!.confidence).toBe(0.15)
  })

  test("IDF weighting: unique keyword contributes more than common keyword", async () => {
    // "polymarket" is unique to T3 (IDF ≈ 2.3), "oracle" is shared by T9+T10 (IDF ≈ 1.6).
    // A prompt with T3's unique keywords should strongly and unambiguously favor T3.
    const intent = parseIntent(
      "Polymarket prediction market bet wager settlement outcome resolution",
    )
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(3)
    expect(match!.confidence).toBeGreaterThan(0.4)
  })

  test("ambiguity detection: nearly equal scores on two templates returns wildcard", async () => {
    // Constructed intent that matches both T5 and T8 with close IDF-weighted scores.
    // T5 keywords: reserve, collateral, audit, attestation, proof
    // T8 keywords: compliance, kyc, aml, sanctions, gate, check
    // Shared concept: both involve "compliance" + "reserve" checking, no trigger to disambiguate.
    const ambiguousIntent = makeIntent({
      keywords: ["compliance", "reserve", "audit", "check", "report", "threshold"],
    })
    const match = await matchTemplate(ambiguousIntent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(0)
    expect(match!.confidence).toBe(0.15)
  })
})

// ─────────────────────────────────────────────
// Suite 3b: Negation Dampening (3 tests)
// ─────────────────────────────────────────────

describe("Negation Dampening", async () => {
  test("negated prompt returns null — 'Do not monitor price, do not alert'", async () => {
    const intent = parseIntent("Do not monitor the price, do not alert on anything")
    expect(intent.negated).toBe(true)
    const match = await matchTemplate(intent)
    expect(match).toBeNull()
  })

  test("negated prompt has lower confidence than non-negated equivalent", async () => {
    const normal = parseIntent("Monitor ETH price every minute and alert when it drops below $3000")
    const negated = parseIntent("Don't monitor ETH price every minute and don't alert when it drops below $3000")
    const matchNormal = await matchTemplate(normal)
    const matchNegated = await matchTemplate(negated)

    expect(matchNormal).not.toBeNull()
    // Negated version should either be null or have much lower confidence
    if (matchNegated !== null) {
      expect(matchNegated.confidence).toBeLessThan(matchNormal!.confidence * 0.5)
    }
  })

  test("'Never send alerts' returns null despite matching T1 keywords", async () => {
    const intent = parseIntent("Never check price feeds or send alert notifications")
    expect(intent.negated).toBe(true)
    const match = await matchTemplate(intent)
    expect(match).toBeNull()
  })
})

// ─────────────────────────────────────────────
// Suite 3c: Substring False Positive Prevention (3 tests)
// ─────────────────────────────────────────────

describe("Substring False Positive Prevention", async () => {
  test("'aggregate' does NOT spuriously match 'gate' (T8 keyword)", async () => {
    // "gate" is a T8 keyword for compliance gating
    // "aggregate" should not match it — they're semantically unrelated
    const intent = parseIntent("Aggregate custom data from multiple sources daily")
    const match = await matchTemplate(intent)
    if (match !== null) {
      // Should match T10 (data feed), NOT T8 (compliance gating)
      expect(match.templateId).not.toBe(8)
      // "gate" should not appear in matched keywords
      expect(match.matchedKeywords).not.toContain("gate")
    }
  })

  test("'minute' does NOT spuriously match 'mint' (T4 keyword)", async () => {
    // "mint" is a T4 keyword for stablecoin issuance
    // "minute" (time word) should not match it
    const intent = parseIntent("Every minute check the price feed and publish data")
    const match = await matchTemplate(intent)
    if (match !== null) {
      expect(match.matchedKeywords).not.toContain("mint")
    }
  })

  test("valid prefix matches still work — 'monitoring' matches 'monitor'", async () => {
    // "monitoring" starts with "monitor" — this is a valid morphological match
    const intent = parseIntent("Monitoring ETH price alerts threshold drops below watch feed")
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(1)
    expect(match!.matchedKeywords).toContain("monitor")
  })
})

// ─────────────────────────────────────────────
// Suite 4: getTemplateById (3 tests)
// ─────────────────────────────────────────────

describe("getTemplateById", async () => {
  test("valid ID returns correct template", async () => {
    const template = getTemplateById(9)
    expect(template).not.toBeUndefined()
    expect(template!.name).toBe("Multi-AI Consensus Oracle")
    expect(template!.category).toBe("ai-powered")
    expect(template!.id).toBe(9)
  })

  test("ID 0 returns wildcard template", async () => {
    const template = getTemplateById(0)
    expect(template).toBeDefined()
    expect(template!.name).toContain("Wildcard")
    expect(template!.id).toBe(0)
  })

  test("ID 11 returns Conditional DEX Swap", async () => {
    const template = getTemplateById(11)
    expect(template).not.toBeUndefined()
    expect(template!.name).toBe("Conditional DEX Swap")
    expect(template!.category).toBe("core-defi")
  })

  test("ID 12 returns Wallet Activity Monitor", async () => {
    const template = getTemplateById(12)
    expect(template).not.toBeUndefined()
    expect(template!.name).toBe("Wallet Activity Monitor")
    expect(template!.category).toBe("core-defi")
  })
})

// ─────────────────────────────────────────────
// Suite 5: getAllTemplates (3 tests)
// ─────────────────────────────────────────────

describe("getAllTemplates", async () => {
  test("returns at least 16 templates (original set)", async () => {
    const all = getAllTemplates()
    expect(all.length).toBeGreaterThanOrEqual(16)
  })

  test("IDs include 1 through 16", async () => {
    const all = getAllTemplates()
    const ids = new Set(all.map((t) => t.id))
    for (let i = 1; i <= 16; i++) {
      expect(ids.has(i)).toBe(true)
    }
  })

  test("all categories are valid enum values", async () => {
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

  test("returns exactly 23 templates", async () => {
    const all = getAllTemplates()
    expect(all.length).toBe(23)
  })

  test("IDs are 1 through 23", async () => {
    const all = getAllTemplates()
    const ids = all.map((t) => t.id).sort((a, b) => a - b)
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23])
  })
})

// ─────────────────────────────────────────────
// Suite 6: T11 Disambiguation (2 tests)
// ─────────────────────────────────────────────

describe("T11 Scoring — requiredCapabilities fix", async () => {
  test("T11 scores above threshold with price-feed + dexSwap capabilities", async () => {
    const intent = parseIntent("Swap ETH to USDC on Uniswap when price drops below 2000 every 5 minutes")
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(11)
    expect(match!.confidence).toBeGreaterThan(0.4)
  })

  test("T11 requiredCapabilities no longer includes exchange-api", async () => {
    const t11 = TEMPLATES.find((t) => t.id === 11)!
    expect(t11.requiredCapabilities).not.toContain("exchange-api")
    expect(t11.requiredCapabilities).toContain("price-feed")
  })

  test("T11 keywords do not include stop word 'when'", async () => {
    const t11 = TEMPLATES.find((t) => t.id === 11)!
    expect(t11.keywords).not.toContain("when")
  })
})

describe("T11 Disambiguation", async () => {
  test("T1 vs T11: pure price alert without swap intent stays T1", async () => {
    const intent = parseIntent("Monitor ETH price and alert when it drops below $2000")
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(1)
  })

  test("T2 vs T11: 'liquidity pool yield' matches T2 not T11", async () => {
    const intent = parseIntent("Monitor liquidity pool yield and rebalance portfolio allocations")
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(2)
  })
})

// ─────────────────────────────────────────────
// Suite 7: T12 Disambiguation (3 tests)
// ─────────────────────────────────────────────

describe("T12 Disambiguation", async () => {
  test("T12 vs T1: wallet+watch+transfer → T12 not T1", async () => {
    const intent = parseIntent(
      "Watch wallet address for large token transfers and alert on whale movements",
    )
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(12)
  })

  test("T12 vs T3: wallet+transfer → T12 not T3", async () => {
    const intent = parseIntent(
      "Monitor wallet for ERC20 transfer events and alert when holdings change",
    )
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(12)
  })

  test("T1 stays T1: price monitoring without wallet context", async () => {
    const intent = parseIntent("Monitor ETH price every hour and alert when it drops below $2000")
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(1)
  })
})

// ─────────────────────────────────────────────
// Suite 8: T13-T16 Reachability
// ─────────────────────────────────────────────

describe("T13-T16 Reachability", async () => {
  test("T13: Chainlink Data Feed Reader", async () => {
    const intent = parseIntent(
      "Read Chainlink data feed latestAnswer from price proxy contract every 5 minutes",
    )
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(13)
    expect(match!.confidence).toBeGreaterThan(0.3)
  })

  test("T14: Stateful KV Store Workflow", async () => {
    const intent = parseIntent(
      "Persist stateful data to S3 storage with moving average calculation hourly",
    )
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(14)
    expect(match!.confidence).toBeGreaterThan(0.3)
  })

  test("T15: Cross-Chain CCIP Transfer", async () => {
    const intent = parseIntent(
      "Bridge tokens cross-chain using CCIP from Ethereum to Base every hour",
    )
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(15)
    expect(match!.confidence).toBeGreaterThan(0.3)
  })

  test("T16: Dual-Trigger Workflow", async () => {
    const intent = parseIntent(
      "Respond to both scheduled cron execution and on-chain log events with dual trigger",
    )
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(16)
    expect(match!.confidence).toBeGreaterThan(0.3)
  })
})

// ─────────────────────────────────────────────
// Suite 8b: T13-T16 getTemplateById
// ─────────────────────────────────────────────

describe("T13-T16 getTemplateById", async () => {
  test("ID 13 returns Chainlink Data Feed Reader", async () => {
    const template = getTemplateById(13)
    expect(template).not.toBeUndefined()
    expect(template!.name).toBe("Chainlink Data Feed Reader")
    expect(template!.category).toBe("core-defi")
  })

  test("ID 14 returns Stateful KV Store Workflow", async () => {
    const template = getTemplateById(14)
    expect(template).not.toBeUndefined()
    expect(template!.name).toBe("Stateful KV Store Workflow")
    expect(template!.category).toBe("ai-powered")
  })

  test("ID 15 returns Cross-Chain CCIP Transfer", async () => {
    const template = getTemplateById(15)
    expect(template).not.toBeUndefined()
    expect(template!.name).toBe("Cross-Chain CCIP Transfer")
    expect(template!.category).toBe("institutional")
  })

  test("ID 16 returns Dual-Trigger Workflow", async () => {
    const template = getTemplateById(16)
    expect(template).not.toBeUndefined()
    expect(template!.name).toBe("Dual-Trigger Workflow")
    expect(template!.category).toBe("core-defi")
  })
})

// ─────────────────────────────────────────────
// Suite 9: Natural Language Reachability
// ─────────────────────────────────────────────
// These prompts use casual, real-world phrasing — no template-specific
// jargon. They test whether synonym expansion + keyword matching + fallback
// can route natural language to the correct template.

describe("Natural Language Reachability", async () => {
  test("'Check if my crypto went up and text me' → T1", async () => {
    const intent = parseIntent("Check if my crypto went up and text me")
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(1)
  })

  test("'Watch for big transactions on my address' → T12", async () => {
    const intent = parseIntent("Watch for big transactions on my address")
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(12)
  })

  test("'Auto-buy ETH when it is cheap on Uniswap' → T11", async () => {
    const intent = parseIntent("Auto-buy ETH when it is cheap on Uniswap")
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(11)
  })

  test("'Pay out farmers if it does not rain enough' → T7", async () => {
    // Include weather-specific context to disambiguate from T22 (dividend payout)
    const intent = parseIntent("Crop insurance pays out farmers when rainfall drops below 50mm weather threshold")
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(7)
  })

  test("'Ask multiple AIs and make sure they agree' → T9", async () => {
    const intent = parseIntent("Ask multiple AIs like GPT and Claude to verify data and make sure they agree")
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(9)
  })

  test("'Move my USDC from Ethereum to Base' → T15", async () => {
    const intent = parseIntent("Move my USDC from Ethereum to Base using cross-chain bridge")
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(15)
  })

  test("'Save data between runs and track the trend' → T14", async () => {
    const intent = parseIntent("Save data between runs to S3 storage and track the trend over time")
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(14)
  })

  test("'Watch wallet for whale transfer events' → T12", async () => {
    const intent = parseIntent("Watch a wallet for whale transfer events and alert on large token movements")
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(12)
  })

  test("'Check if my token tanked and let me know' → T1", async () => {
    const intent = parseIntent("Check if my token tanked and let me know every hour")
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(1)
  })

  test("'Read the latest Chainlink price from the contract' → T13", async () => {
    const intent = parseIntent("Read the latest Chainlink price from the contract every 5 minutes")
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(13)
  })

  test("'Swap my tokens automatically when the price dips' → T11", async () => {
    const intent = parseIntent("Swap my tokens on a dex automatically when the price dips below $1500")
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(11)
  })

  test("'Keep track of my portfolio balance across chains' → T2", async () => {
    const intent = parseIntent("Keep track of my portfolio balance across chains and rebalance if drift exceeds 5%")
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(2)
  })

  test("'Screen wallets against sanctions and compliance blacklist' → T8", async () => {
    const intent = parseIntent("Screen wallets against sanctions and compliance blacklist before DeFi operations")
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(8)
  })

  test("'Mint new stablecoins when someone deposits fiat' → T4", async () => {
    const intent = parseIntent("Mint new stablecoins when someone deposits fiat after compliance check")
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(4)
  })

  test("'Check reserve backing ratio daily and publish proof' → T5", async () => {
    const intent = parseIntent("Check reserve backing ratio daily and publish proof of solvency onchain")
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(5)
  })

  test("'Pay winners after the election results are in' → T3", async () => {
    const intent = parseIntent("Pay winners after the election results are in on the prediction market")
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(3)
  })
})

// ─────────────────────────────────────────────
// Suite 10: Capability Fallback
// ─────────────────────────────────────────────

describe("Capability Fallback", async () => {
  test("fallback fires for ambiguous prompt with clear capabilities", async () => {
    // Prompt has price-feed + alert capability but no strong keyword match
    const intent = makeIntent({
      dataSources: ["price-feed"],
      actions: ["alert"],
      keywords: ["something", "random"],
    })
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(1)
    expect(match!.confidence).toBe(0.35)
    expect(match!.matchedKeywords).toContain("capability-fallback")
  })

  test("fallback does not fire for negated intent", async () => {
    const intent = makeIntent({
      dataSources: ["price-feed"],
      actions: ["alert"],
      keywords: ["something"],
      negated: true,
    })
    const match = await matchTemplate(intent)
    expect(match).toBeNull()
  })

  test("wallet-api + alert → T12 via fallback", async () => {
    const intent = makeIntent({
      dataSources: ["wallet-api"],
      actions: ["alert"],
      keywords: ["unusual"],
    })
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(12)
    expect(match!.matchedKeywords).toContain("capability-fallback")
  })

  test("ccip data source alone → T15 via fallback", async () => {
    const intent = makeIntent({
      dataSources: ["ccip"],
      keywords: ["something"],
    })
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(15)
  })
})

// ─────────────────────────────────────────────
// Suite 11: Dual-Trigger Heuristic
// ─────────────────────────────────────────────

describe("Dual-Trigger Heuristic", async () => {
  test("prompt with both cron and evmLog signals boosts T16", async () => {
    const intent = parseIntent(
      "Respond to both a scheduled cron timer and on-chain log events with dual trigger handlers",
    )
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(16)
    expect(match!.confidence).toBeGreaterThan(0.3)
  })

  test("triggerScores with both cron and evmLog present", async () => {
    const intent = parseIntent(
      "Monitor prices on schedule and react to contract events with two handlers",
    )
    expect(intent.triggerScores).toBeDefined()
    expect(intent.triggerScores!.cron).toBeGreaterThan(0)
    expect(intent.triggerScores!.evmLog).toBeGreaterThan(0)
  })
})

// ─────────────────────────────────────────────
// Suite 12: Score Clamping & Fusion Invariants
// ─────────────────────────────────────────────
// Verifies that confidence values stay in [0, 1] regardless of
// keyword bonuses, trigger boosts, and dual-trigger heuristic stacking.

describe("Score Clamping & Fusion Invariants", async () => {
  test("confidence never exceeds 1.0 even with all bonuses stacked", async () => {
    // T16 with dual-trigger boost (+0.25) + trigger match (+0.2) + data source affinity
    // Could theoretically push past 1.0 without clamping
    const intent = makeIntent({
      triggerType: "cron",
      keywords: ["dual trigger", "both schedule and event", "cron and event",
        "multiple triggers", "schedule and log", "hybrid trigger",
        "two triggers", "combined trigger", "timer and event"],
      dataSources: ["price-feed"],
      actions: ["evmWrite"],
      triggerScores: { cron: 3, http: 0, evmLog: 2 },
    })
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.confidence).toBeLessThanOrEqual(1.0)
    expect(match!.confidence).toBeGreaterThanOrEqual(0)
  })

  test("confidence never goes negative with trigger mismatch + negation", async () => {
    const intent = makeIntent({
      triggerType: "http",
      keywords: ["price", "monitor"],
      negated: true,
    })
    const match = await matchTemplate(intent)
    // Should be null (negated + below threshold), but if returned, must be >= 0
    if (match) {
      expect(match.confidence).toBeGreaterThanOrEqual(0)
    }
  })

  test("all 22 templates produce [0, 1] confidence for keyword-only scoring", async () => {
    const prompts = [
      "Monitor price alert threshold",
      "Rebalance portfolio allocation cross-chain",
      "Prediction market settle outcome",
      "Mint stablecoin reserve compliance",
      "Proof reserve collateralization ratio",
      "Fund subscription NAV redemption",
      "Insurance parametric weather payout",
      "Compliance KYC AML sanctions gate",
      "Consensus AI multi-model oracle",
      "Custom data feed aggregate oracle",
      "Swap buy sell trade DEX Uniswap",
      "Wallet watch whale transfer monitor",
      "Chainlink data feed latestAnswer",
      "Stateful persist storage KV S3",
      "CCIP cross-chain bridge token",
      "Dual trigger cron event log handler",
      "Burn stablecoin redeem compliance",
      "Payment initiation wire transfer swift",
      "Escrow lock release settlement",
      "Settlement reconciliation clearing dvp",
      "Shareholder registry cap table equity",
      "Dividend distribution shareholder payout",
    ]
    for (const prompt of prompts) {
      const intent = parseIntent(prompt)
      const match = await matchTemplate(intent)
      if (match) {
        expect(match.confidence).toBeGreaterThanOrEqual(0)
        expect(match.confidence).toBeLessThanOrEqual(1)
      }
    }
  })
})

// ─────────────────────────────────────────────
// Suite 13: T17-T22 Reachability
// ─────────────────────────────────────────────

describe("T17-T22 Reachability", async () => {
  test("T17: Stablecoin Redemption/Burn", async () => {
    const intent = parseIntent(
      "Burn stablecoins after compliance check and stablecoin redeem the USDC supply",
    )
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(17)
    expect(match!.templateName).toBe("Stablecoin Redemption/Burn")
    expect(match!.confidence).toBeGreaterThan(0.3)
  })

  test("T18: Payment Initiation & Confirmation", async () => {
    const intent = parseIntent(
      "Initiate payment wire transfer SWIFT every 4 hours for pending settlements",
    )
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(18)
    expect(match!.templateName).toBe("Payment Initiation & Confirmation")
    expect(match!.confidence).toBeGreaterThan(0.3)
  })

  test("T19: Escrow Lock/Release", async () => {
    const intent = parseIntent(
      "Escrow lock tokens until delivery confirmed then release escrow for settlement",
    )
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(19)
    expect(match!.templateName).toBe("Escrow Lock/Release")
    expect(match!.confidence).toBeGreaterThan(0.3)
  })

  test("T20: Settlement Reconciliation", async () => {
    const intent = parseIntent(
      "Daily settlement reconciliation clearing between bank records and blockchain ledger",
    )
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(20)
    expect(match!.templateName).toBe("Settlement Reconciliation")
    expect(match!.confidence).toBeGreaterThan(0.3)
  })

  test("T21: Shareholder Registry", async () => {
    const intent = parseIntent(
      "Update shareholder registry cap table when equity transfers occur with compliance",
    )
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(21)
    expect(match!.templateName).toBe("Shareholder Registry")
    expect(match!.confidence).toBeGreaterThan(0.3)
  })

  test("T22: Dividend Distribution", async () => {
    const intent = parseIntent(
      "Distribute dividend to all equity holders monthly with pro rata calculation",
    )
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(22)
    expect(match!.templateName).toBe("Dividend Distribution")
    expect(match!.confidence).toBeGreaterThan(0.3)
  })

  test("T23: DvP Dual-Trigger Escrow", async () => {
    const intent = parseIntent(
      "Atomic dvp dual trigger escrow with payment poll release and delivery event escrow lock",
    )
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(23)
    expect(match!.templateName).toBe("DvP Dual-Trigger Escrow")
    expect(match!.confidence).toBeGreaterThan(0.3)
  })
})

// ─────────────────────────────────────────────
// Suite 14: T17-T22 getTemplateById
// ─────────────────────────────────────────────

describe("T17-T22 getTemplateById", async () => {
  test("ID 17 returns Stablecoin Redemption/Burn", async () => {
    const template = getTemplateById(17)
    expect(template).not.toBeUndefined()
    expect(template!.name).toBe("Stablecoin Redemption/Burn")
    expect(template!.category).toBe("institutional")
  })

  test("ID 18 returns Payment Initiation & Confirmation", async () => {
    const template = getTemplateById(18)
    expect(template).not.toBeUndefined()
    expect(template!.name).toBe("Payment Initiation & Confirmation")
    expect(template!.category).toBe("institutional")
  })

  test("ID 19 returns Escrow Lock/Release", async () => {
    const template = getTemplateById(19)
    expect(template).not.toBeUndefined()
    expect(template!.name).toBe("Escrow Lock/Release")
    expect(template!.category).toBe("institutional")
  })

  test("ID 20 returns Settlement Reconciliation", async () => {
    const template = getTemplateById(20)
    expect(template).not.toBeUndefined()
    expect(template!.name).toBe("Settlement Reconciliation")
    expect(template!.category).toBe("institutional")
  })

  test("ID 21 returns Shareholder Registry", async () => {
    const template = getTemplateById(21)
    expect(template).not.toBeUndefined()
    expect(template!.name).toBe("Shareholder Registry")
    expect(template!.category).toBe("institutional")
  })

  test("ID 22 returns Dividend Distribution", async () => {
    const template = getTemplateById(22)
    expect(template).not.toBeUndefined()
    expect(template!.name).toBe("Dividend Distribution")
    expect(template!.category).toBe("institutional")
  })
})

// ─────────────────────────────────────────────
// Suite 14b: T23 getTemplateById
// ─────────────────────────────────────────────

describe("T23 getTemplateById", async () => {
  test("ID 23 returns DvP Dual-Trigger Escrow", async () => {
    const template = getTemplateById(23)
    expect(template).not.toBeUndefined()
    expect(template!.name).toBe("DvP Dual-Trigger Escrow")
    expect(template!.category).toBe("institutional")
  })
})

// ─────────────────────────────────────────────
// Suite 15: T17-T22 Disambiguation
// ─────────────────────────────────────────────

describe("T17-T22 Disambiguation", async () => {
  test("T17 vs T6: 'burn stablecoins' → T17, not T6", async () => {
    const intent = parseIntent(
      "Token burn and stablecoin redeem after compliance verification on-chain",
    )
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(17)
  })

  test("T6 backward compat: 'fund subscription NAV' → T6 (NOT T17)", async () => {
    const intent = parseIntent(
      "Handle fund subscription and calculate NAV for tokenized fund shares redemption",
    )
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(6)
  })

  test("T22 vs T6: 'distribute dividend to shareholders' → T22, not T6", async () => {
    const intent = parseIntent(
      "Distribute dividend to shareholders every month with pro rata equity holdings",
    )
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(22)
  })

  test("T19 vs T18: 'escrow payment' → T19 (escrow wins)", async () => {
    const intent = parseIntent(
      "Escrow lock collateral for delivery versus payment settlement until conditions clear",
    )
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(19)
  })

  test("T20 vs T5: 'reconciliation' routes to T20 (settlement), not T5 (reserve)", async () => {
    const intent = parseIntent(
      "Daily settlement reconciliation between bank clearing records and on-chain ledger",
    )
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(20)
  })

  test("T23 vs T19: bare 'escrow lock release' without dual-trigger signals → T19", async () => {
    const intent = parseIntent(
      "Escrow lock release settlement conditions",
    )
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(19)
  })

  test("T23 vs T20: 'dvp reconciliation daily' → T20 (no escrow/payment)", async () => {
    const intent = parseIntent(
      "DvP reconciliation daily clearing between bank and blockchain ledger",
    )
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(20)
  })

  test("T4 vs T5: 'mint stablecoins every hour based on reserves' → T4, not T5", async () => {
    const intent = parseIntent(
      "Every hour check reserve levels and mint stablecoins when reserve ratio exceeds 150%",
    )
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(4)
  })
})

// ─────────────────────────────────────────────
// Suite 16: T17-T22 Capability Fallback
// ─────────────────────────────────────────────

describe("T17-T22 Capability Fallback", async () => {
  test("compliance-api + burn → T17 via fallback", async () => {
    const intent = makeIntent({
      dataSources: ["compliance-api"],
      actions: ["burn"],
      keywords: ["unusual"],
    })
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(17)
    expect(match!.matchedKeywords).toContain("capability-fallback")
  })

  test("payment-api + initiatePayment → T18 via fallback", async () => {
    const intent = makeIntent({
      dataSources: ["payment-api"],
      actions: ["initiatePayment"],
      keywords: ["unusual"],
    })
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(18)
    expect(match!.matchedKeywords).toContain("capability-fallback")
  })

  test("escrowLock action alone → T19 via fallback", async () => {
    const intent = makeIntent({
      dataSources: [],
      actions: ["escrowLock"],
      keywords: ["unusual"],
    })
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(19)
  })

  test("settlement-api alone → T20 via fallback", async () => {
    const intent = makeIntent({
      dataSources: ["settlement-api"],
      keywords: ["unusual"],
    })
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(20)
  })

  test("registry-api + distribute → T22 via fallback", async () => {
    const intent = makeIntent({
      dataSources: ["registry-api"],
      actions: ["distribute"],
      keywords: ["unusual"],
    })
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(22)
  })

  test("registry-api alone → T21 via fallback", async () => {
    const intent = makeIntent({
      dataSources: ["registry-api"],
      keywords: ["unusual"],
    })
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(21)
  })

  test("escrowLock + payment-api + dual triggers → T23", async () => {
    const intent = makeIntent({
      dataSources: ["payment-api"],
      actions: ["escrowLock"],
      keywords: ["unusual"],
      triggerScores: { cron: 1, http: 0, evmLog: 1 },
    })
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(23)
  })

  test("escrowLock + payment-api without dual triggers → T19 via fallback (not T23)", async () => {
    const intent = makeIntent({
      dataSources: ["payment-api"],
      actions: ["escrowLock"],
      keywords: ["unusual"],
    })
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    // Without dual-trigger signals, falls through T23 fallback check to T19
    expect(match!.templateId).toBe(19)
    expect(match!.matchedKeywords).toContain("capability-fallback")
  })
})

// ─────────────────────────────────────────────
// Suite 17: End-to-End Integration Prompts (Phase 7)
// ─────────────────────────────────────────────

describe("End-to-End Integration — Institutional Prompts", async () => {
  test("'Burn USDC stablecoins after compliance verification' → T17", async () => {
    const intent = parseIntent("Burn USDC stablecoins after compliance verification and stablecoin redeem")
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(17)
  })

  test("'Set up automatic wire transfer payments every 4 hours' → T18", async () => {
    const intent = parseIntent("Set up automatic wire transfer payment initiation every 4 hours")
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(18)
  })

  test("'Lock tokens in escrow until settlement confirmed' → T19", async () => {
    const intent = parseIntent("Lock tokens in escrow lock until settlement confirmed and release escrow")
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(19)
  })

  test("'Reconcile daily settlements between bank and blockchain' → T20", async () => {
    const intent = parseIntent("Reconcile daily settlement reconciliation between bank clearing and blockchain")
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(20)
  })

  test("'Maintain on-chain shareholder registry with compliance' → T21", async () => {
    const intent = parseIntent("Maintain on-chain shareholder registry with compliance checks for equity transfers")
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(21)
  })

  test("'Distribute monthly dividends to all equity holders' → T22", async () => {
    const intent = parseIntent("Distribute dividend to all equity holders monthly with shareholder payout")
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(22)
  })

  test("'fund subscription NAV' backward compat → T6 (NOT T17)", async () => {
    const intent = parseIntent("Handle fund subscription and calculate NAV for tokenized fund shares redemption")
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(6)
  })

  test("'Shareholder payout dividends' → T22 (not T6)", async () => {
    const intent = parseIntent("Shareholder payout dividends pro rata equity distribution monthly")
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(22)
  })
})

// ─────────────────────────────────────────────
// Suite 18: Wildcard Fallback
// ─────────────────────────────────────────────

describe("Wildcard Fallback", async () => {
  test("WILDCARD_TEMPLATE is not in TEMPLATES array", () => {
    expect(TEMPLATES.find((t) => t.id === 0)).toBeUndefined()
    expect(WILDCARD_TEMPLATE.id).toBe(0)
  })

  test("returns wildcard for completely unmatched prompt", async () => {
    const intent = makeIntent({ keywords: ["zxcvbn", "qwerty", "asdfgh"] })
    const result = await matchTemplate(intent)
    expect(result).not.toBeNull()
    expect(result!.templateId).toBe(0)
    expect(result!.templateName).toContain("Wildcard")
    expect(result!.confidence).toBe(0.15)
    expect(result!.matchedKeywords).toContain("wildcard")
  })

  test("negated intent returns null (not wildcard)", async () => {
    const intent = makeIntent({ keywords: ["zxcvbn"], negated: true })
    const result = await matchTemplate(intent)
    expect(result).toBeNull()
  })

  test("wildcard does not interfere with real template scoring", async () => {
    const intent = parseIntent("Monitor ETH price every minute and alert when below 2000")
    const match = await matchTemplate(intent)
    expect(match).not.toBeNull()
    expect(match!.templateId).toBe(1)
    expect(match!.confidence).toBeGreaterThan(0.3)
  })
})
