import { describe, test, expect } from "bun:test"
import { loadTemplateFile, loadTemplateConfig, buildFallbackConfig } from "../services/ai-engine/file-manager"
import type { ParsedIntent } from "../services/ai-engine/types"
import type { TemplateDefinition } from "../services/ai-engine/template-matcher"

// ─────────────────────────────────────────────
// Test Helpers
// ─────────────────────────────────────────────

function makeIntent(overrides: Partial<ParsedIntent> = {}): ParsedIntent {
  return {
    triggerType: "cron",
    confidence: 0.8,
    schedule: "0 */5 * * * *",
    dataSources: ["price-feed"],
    conditions: ["drops below $2000"],
    actions: ["alert"],
    chains: ["base-sepolia"],
    keywords: ["price", "monitor", "alert"],
    negated: false,
    ...overrides,
  }
}

function makeTemplate(overrides: Partial<TemplateDefinition> = {}): TemplateDefinition {
  return {
    id: 1,
    name: "Price Monitoring + Alert",
    category: "core-defi",
    keywords: ["price", "monitor"],
    requiredCapabilities: ["price-feed", "alert"],
    triggerType: "cron",
    defaultPromptFill: "Generate a CRE workflow that monitors a price feed.",
    ...overrides,
  }
}

// ─────────────────────────────────────────────
// loadTemplateFile
// ─────────────────────────────────────────────

describe("loadTemplateFile", () => {
  test("loads template-1.ts successfully", () => {
    const content = loadTemplateFile(1)
    expect(content).not.toBeNull()
    expect(content).toContain("import")
    expect(content).toContain("export")
    expect(content).toContain("main")
  })

  test("returns null for non-existent template", () => {
    const content = loadTemplateFile(99)
    expect(content).toBeNull()
  })
})

// ─────────────────────────────────────────────
// loadTemplateConfig
// ─────────────────────────────────────────────

describe("loadTemplateConfig", () => {
  test("loads template-1.config.json as valid JSON string", () => {
    const content = loadTemplateConfig(1)
    expect(content).not.toBeNull()
    const parsed = JSON.parse(content!)
    expect(typeof parsed).toBe("object")
    expect(parsed).toHaveProperty("assetId")
  })

  test("returns null for non-existent config", () => {
    const content = loadTemplateConfig(99)
    expect(content).toBeNull()
  })
})

// ─────────────────────────────────────────────
// buildFallbackConfig
// ─────────────────────────────────────────────

describe("buildFallbackConfig", () => {
  test("uses intent chain as chainName", () => {
    const intent = makeIntent({ chains: ["ethereum-sepolia"] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.chainName).toBe("ethereum-sepolia")
  })

  test("defaults to base-sepolia when no chains", () => {
    const intent = makeIntent({ chains: [] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.chainName).toBe("base-sepolia")
  })

  test("includes cronSchedule from intent for cron templates", () => {
    const intent = makeIntent({ schedule: "0 0 * * *" })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.cronSchedule).toBe("0 0 * * *")
  })

  test("defaults cronSchedule when intent has no schedule", () => {
    const intent = makeIntent({ schedule: undefined })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.cronSchedule).toBe("0 */5 * * * *")
  })

  test("omits cronSchedule for http-triggered templates", () => {
    const intent = makeIntent()
    const template = makeTemplate({ triggerType: "http" })
    const config = JSON.parse(buildFallbackConfig(intent, template))
    expect(config.cronSchedule).toBeUndefined()
  })

  test("includes price-feed fields when dataSource matches", () => {
    const intent = makeIntent({ dataSources: ["price-feed"] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.priceApiUrl).toBeDefined()
    expect(config.assetId).toBe("ethereum")
    expect(config.threshold).toBe(3000)
  })

  test("includes alertWebhookUrl when alert action present", () => {
    const intent = makeIntent({ actions: ["alert"] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.alertWebhookUrl).toBeDefined()
  })

  test("returns valid JSON string", () => {
    const result = buildFallbackConfig(makeIntent(), makeTemplate())
    expect(() => JSON.parse(result)).not.toThrow()
  })

  // ── Data source coverage ──

  test("includes reserveApiUrl for reserve-api data source", () => {
    const intent = makeIntent({ dataSources: ["reserve-api"] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.reserveApiUrl).toBeDefined()
  })

  test("includes navApiUrl for nav-api data source", () => {
    const intent = makeIntent({ dataSources: ["nav-api"] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.navApiUrl).toBeDefined()
  })

  test("includes complianceApiUrl for compliance-api data source", () => {
    const intent = makeIntent({ dataSources: ["compliance-api"] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.complianceApiUrl).toBeDefined()
  })

  test("includes defiApiUrl for defi-api data source", () => {
    const intent = makeIntent({ dataSources: ["defi-api"] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.defiApiUrl).toBeDefined()
  })

  test("includes predictionMarketApiUrl for prediction-market data source", () => {
    const intent = makeIntent({ dataSources: ["prediction-market"] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.predictionMarketApiUrl).toBeDefined()
  })

  test("includes AI API keys and queryPrompt for multi-ai data source", () => {
    const intent = makeIntent({ dataSources: ["multi-ai"] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.openaiApiKey).toBeDefined()
    expect(config.anthropicApiKey).toBeDefined()
    expect(config.geminiApiKey).toBeDefined()
    expect(config.queryPrompt).toBeDefined()
  })

  // ── Action coverage ──

  test("includes consumerContract for evmWrite action", () => {
    const intent = makeIntent({ actions: ["evmWrite"] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.consumerContract).toBeDefined()
  })

  test("includes consumerContract for mint action", () => {
    const intent = makeIntent({ actions: ["mint"] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.consumerContract).toBeDefined()
  })

  test("includes consumerContract for transfer action", () => {
    const intent = makeIntent({ actions: ["transfer"] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.consumerContract).toBeDefined()
  })

  test("includes consumerContract for payout action", () => {
    const intent = makeIntent({ actions: ["payout"] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.consumerContract).toBeDefined()
  })

  test("includes targetAllocations and driftThreshold for rebalance action", () => {
    const intent = makeIntent({ actions: ["rebalance"] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.targetAllocations).toBeDefined()
    expect(config.driftThreshold).toBe(5)
  })
})

// ─────────────────────────────────────────────
// loadTemplateFile — templates 2-10
// ─────────────────────────────────────────────

describe("loadTemplateFile — templates 2-10", () => {
  for (const id of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    test(`loads template-${id}.ts successfully`, () => {
      const content = loadTemplateFile(id)
      expect(content).not.toBeNull()
      expect(content).toContain("export async function main()")
      expect(content).toContain("configSchema")
      expect(content).toContain("handler(")
    })
  }
})

// ─────────────────────────────────────────────
// loadTemplateConfig — templates 2-10
// ─────────────────────────────────────────────

describe("loadTemplateConfig — templates 2-10", () => {
  for (const id of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    test(`loads template-${id}.config.json as valid JSON`, () => {
      const content = loadTemplateConfig(id)
      expect(content).not.toBeNull()
      const parsed = JSON.parse(content!)
      expect(typeof parsed).toBe("object")
      expect(parsed).toHaveProperty("consumerContract")
      expect(parsed).toHaveProperty("chainName")
    })
  }
})
