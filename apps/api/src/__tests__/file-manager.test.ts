import { describe, test, expect } from "bun:test"
import { loadTemplateFile, loadTemplateConfig, buildFallbackConfig, detectStateKeyword, detectOnchainStateKeyword } from "../services/ai-engine/file-manager"
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
    entities: {},
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

  test("includes prompt, model names, and evms for multi-ai data source", () => {
    const intent = makeIntent({ dataSources: ["multi-ai"] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.prompt).toBeDefined()
    expect(config.openaiModel).toBe("gpt-4o")
    expect(config.claudeModel).toBe("claude-sonnet-4-20250514")
    expect(config.geminiModel).toBe("gemini-1.5-pro")
    expect(config.openaiApiEndpoint).toBeDefined()
    expect(config.evms).toBeInstanceOf(Array)
    expect(config.evms.length).toBe(1)
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

  test("dexSwap action adds swap router config fields", () => {
    const intent = makeIntent({ actions: ["dexSwap"] })
    const template = makeTemplate()
    const config = JSON.parse(buildFallbackConfig(intent, template))
    expect(config.swapRouterAddress).toBe("0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4")
    expect(config.tokenIn).toBe("0x4200000000000000000000000000000000000006")
    expect(config.poolFee).toBe(3000)
    expect(config.slippageBps).toBe(50)
    expect(config.swapAmountWei).toBe("100000000000000000")
    expect(config.recipientAddress).toBeDefined()
    expect(config.tokenOutDecimals).toBe(18)
    expect(config.tokenInDecimals).toBe(18)
    expect(config.useNativeETH).toBe(true)
    expect(config.consumerContract).toBeDefined()
  })

  test("dexSwap config includes price-feed defaults even without price-feed data source", () => {
    const intent = makeIntent({ actions: ["dexSwap"], dataSources: [] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.priceApiUrl).toBe("https://api.coingecko.com/api/v3/simple/price")
    expect(config.assetId).toBe("ethereum")
    expect(config.threshold).toBe(2000)
    expect(config.direction).toBe("below")
    expect(config.tokenInDecimals).toBe(18)
    expect(config.useNativeETH).toBe(true)
  })

  test("dexSwap does not overwrite price-feed values set by data source detection", () => {
    const intent = makeIntent({ actions: ["dexSwap"], dataSources: ["price-feed"] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    // price-feed block sets threshold=3000, dexSwap block uses ||= so keeps 3000
    expect(config.threshold).toBe(3000)
    expect(config.priceApiUrl).toBe("https://api.coingecko.com/api/v3/simple/price")
  })
})

// ─────────────────────────────────────────────
// buildFallbackConfig — state keyword detection
// ─────────────────────────────────────────────

describe("buildFallbackConfig — state keyword detection", () => {
  test("adds KV config when 'history' keyword present", () => {
    const intent = makeIntent({ keywords: ["price", "history", "monitor"] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.kvStoreUrl).toBeDefined()
    expect(config.kvApiKey).toBeDefined()
    expect(config.stateKey).toBeDefined()
  })

  test("adds KV config when 'portfolio' keyword present", () => {
    const intent = makeIntent({ keywords: ["portfolio", "rebalance"] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.kvStoreUrl).toBeDefined()
    expect(config.kvApiKey).toBeDefined()
    expect(config.stateKey).toBeDefined()
  })

  test("adds KV config when 'average' keyword present", () => {
    const intent = makeIntent({ keywords: ["price", "average", "compute"] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.kvStoreUrl).toBeDefined()
  })

  test("adds KV config when 'track' keyword present", () => {
    const intent = makeIntent({ keywords: ["track", "token", "balance"] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.kvStoreUrl).toBeDefined()
  })

  test("omits KV config when no state keywords present", () => {
    const intent = makeIntent({ keywords: ["price", "monitor", "alert"] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.kvStoreUrl).toBeUndefined()
    expect(config.kvApiKey).toBeUndefined()
    expect(config.stateKey).toBeUndefined()
  })

  test("KV config has expected placeholder values with dynamic stateKey", () => {
    const intent = makeIntent({ keywords: ["price", "trend", "weekly"] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.kvStoreUrl).toBe("PLACEHOLDER_KV_STORE_URL")
    expect(config.kvApiKey).toBe("PLACEHOLDER_KV_API_KEY")
    expect(config.stateKey).toBe("ciel-trend-data")
  })

  // ── Expanded keyword coverage ──

  test("adds KV config when 'remember' keyword present", () => {
    const intent = makeIntent({ keywords: ["remember", "price", "last"] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.kvStoreUrl).toBeDefined()
    expect(config.stateKey).toBe("ciel-remember-data")
  })

  test("adds KV config when 'persist' keyword present", () => {
    const intent = makeIntent({ keywords: ["persist", "data", "store"] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.kvStoreUrl).toBeDefined()
  })

  test("adds KV config when 'rolling' keyword present", () => {
    const intent = makeIntent({ keywords: ["rolling", "average", "compute"] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.kvStoreUrl).toBeDefined()
  })

  test("adds KV config when 'daily' keyword present", () => {
    const intent = makeIntent({ keywords: ["daily", "price", "report"] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.kvStoreUrl).toBeDefined()
  })

  // ── Dynamic stateKey ──

  test("stateKey is dynamic based on matched keyword", () => {
    const intent = makeIntent({ keywords: ["price", "history", "monitor"] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.stateKey).toBe("ciel-history-data")
  })

  test("different keywords produce different stateKeys", () => {
    const intent1 = makeIntent({ keywords: ["portfolio", "rebalance"] })
    const intent2 = makeIntent({ keywords: ["counter", "increment"] })
    const config1 = JSON.parse(buildFallbackConfig(intent1, makeTemplate()))
    const config2 = JSON.parse(buildFallbackConfig(intent2, makeTemplate()))
    expect(config1.stateKey).toBe("ciel-portfolio-data")
    expect(config2.stateKey).toBe("ciel-counter-data")
  })

  // ── Pattern 2: Onchain state detection ──

  test("'onchain' keyword adds onchainWorkflowId", () => {
    const intent = makeIntent({ keywords: ["onchain", "balance", "monitor"] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.onchainWorkflowId).toBe("PLACEHOLDER_WORKFLOW_ID")
  })

  test("'trustless' keyword adds onchainWorkflowId", () => {
    const intent = makeIntent({ keywords: ["trustless", "audit", "trail"] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.onchainWorkflowId).toBe("PLACEHOLDER_WORKFLOW_ID")
  })

  test("no onchain keywords means no onchainWorkflowId", () => {
    const intent = makeIntent({ keywords: ["price", "monitor", "alert"] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.onchainWorkflowId).toBeUndefined()
  })
})

// ─────────────────────────────────────────────
// loadTemplateFile — templates 2-10
// ─────────────────────────────────────────────

describe("loadTemplateFile — templates 2-12", () => {
  for (const id of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
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

describe("loadTemplateConfig — templates 2-12", () => {
  for (const id of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
    test(`loads template-${id}.config.json as valid JSON`, () => {
      const content = loadTemplateConfig(id)
      expect(content).not.toBeNull()
      const parsed = JSON.parse(content!)
      expect(typeof parsed).toBe("object")
      if (id === 9) {
        // Template 9 uses flat schema with evms array (no consumerContract/chainName)
        expect(parsed).toHaveProperty("evms")
        expect(parsed).toHaveProperty("prompt")
      } else if (id === 12) {
        // Template 12 uses evm_log-specific fields
        expect(parsed).toHaveProperty("tokenContractAddress")
        expect(parsed).toHaveProperty("transferEventSignature")
        expect(parsed).toHaveProperty("watchAddresses")
      } else {
        expect(parsed).toHaveProperty("consumerContract")
        expect(parsed).toHaveProperty("chainName")
      }
    })
  }
})

// ─────────────────────────────────────────────
// detectStateKeyword — stemmed matching
// ─────────────────────────────────────────────

describe("detectStateKeyword — stemmed matching", () => {
  test("exact keyword 'track' returns 'track'", () => {
    expect(detectStateKeyword(["track", "price"])).toBe("track")
  })

  test("inflected 'tracking' matches via stemmer", () => {
    const result = detectStateKeyword(["tracking", "price"])
    expect(result).toBe("tracking")
  })

  test("inflected 'averaging' matches via stemmer", () => {
    const result = detectStateKeyword(["averaging", "compute"])
    expect(result).toBe("averaging")
  })

  test("inflected 'stored' matches via stemmer", () => {
    expect(detectStateKeyword(["stored", "data"])).toBe("stored")
  })

  test("inflected 'storing' matches via stemmer", () => {
    expect(detectStateKeyword(["storing", "data"])).toBe("storing")
  })

  test("inflected 'saved' matches via stemmer", () => {
    expect(detectStateKeyword(["saved", "data"])).toBe("saved")
  })

  test("inflected 'saving' matches via stemmer", () => {
    expect(detectStateKeyword(["saving", "data"])).toBe("saving")
  })

  test("inflected 'accumulated' matches via stemmer", () => {
    expect(detectStateKeyword(["accumulated", "value"])).toBe("accumulated")
  })

  test("inflected 'counters' matches via stemmer (plural of counter)", () => {
    expect(detectStateKeyword(["counters", "items"])).toBe("counters")
  })

  test("inflected 'persisted' matches via stemmer", () => {
    expect(detectStateKeyword(["persisted", "state"])).toBe("persisted")
  })

  test("no state keywords returns null", () => {
    expect(detectStateKeyword(["price", "monitor", "alert"])).toBeNull()
  })

  test("prefers exact match over stemmed match", () => {
    // "track" is exact; "tracking" would also match via stem
    const result = detectStateKeyword(["tracking", "track"])
    expect(result).toBe("track")
  })
})

// ─────────────────────────────────────────────
// detectOnchainStateKeyword — stemmed + expanded
// ─────────────────────────────────────────────

describe("detectOnchainStateKeyword — stemmed + expanded", () => {
  test("'onchain' matches", () => {
    expect(detectOnchainStateKeyword(["onchain", "data"])).toBe("onchain")
  })

  test("'immutable' matches (expanded keyword)", () => {
    expect(detectOnchainStateKeyword(["immutable", "record"])).toBe("immutable")
  })

  test("'transparent' matches (expanded keyword)", () => {
    expect(detectOnchainStateKeyword(["transparent", "audit"])).toBe("transparent")
  })

  test("'blockchain' matches (expanded keyword)", () => {
    expect(detectOnchainStateKeyword(["blockchain", "state"])).toBe("blockchain")
  })

  test("'tamperproof' matches (expanded keyword)", () => {
    expect(detectOnchainStateKeyword(["tamperproof", "log"])).toBe("tamperproof")
  })

  test("no onchain keywords returns null", () => {
    expect(detectOnchainStateKeyword(["price", "monitor"])).toBeNull()
  })
})

// ─────────────────────────────────────────────
// buildFallbackConfig — stemmed state keywords
// ─────────────────────────────────────────────

describe("buildFallbackConfig — stemmed state keywords", () => {
  test("inflected 'tracking' triggers KV config with dynamic stateKey", () => {
    const intent = makeIntent({ keywords: ["tracking", "token", "balance"] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.kvStoreUrl).toBe("PLACEHOLDER_KV_STORE_URL")
    expect(config.kvApiKey).toBe("PLACEHOLDER_KV_API_KEY")
    expect(config.stateKey).toBe("ciel-tracking-data")
  })

  test("inflected 'averaging' triggers KV config", () => {
    const intent = makeIntent({ keywords: ["averaging", "compute"] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.kvStoreUrl).toBeDefined()
  })

  test("inflected 'stored' triggers KV config", () => {
    const intent = makeIntent({ keywords: ["stored", "value"] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.kvStoreUrl).toBeDefined()
  })
})

// ─────────────────────────────────────────────
// buildFallbackConfig — Doc 21 data sources
// ─────────────────────────────────────────────

describe("buildFallbackConfig — Doc 21 data sources", () => {
  test("github-api includes PLACEHOLDER_GITHUB_TOKEN and API URL", () => {
    const intent = makeIntent({ dataSources: ["github-api"] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.githubApiUrl).toBe("https://api.github.com")
    expect(config.githubToken).toBe("PLACEHOLDER_GITHUB_TOKEN")
    expect(config.githubOwner).toBe("PLACEHOLDER_GITHUB_OWNER")
    expect(config.githubRepo).toBe("PLACEHOLDER_GITHUB_REPO")
  })

  test("news-api includes PLACEHOLDER_NEWS_API_KEY and sentimentThreshold", () => {
    const intent = makeIntent({ dataSources: ["news-api"] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.newsApiUrl).toBe("https://newsapi.org/v2/everything")
    expect(config.newsApiKey).toBe("PLACEHOLDER_NEWS_API_KEY")
    expect(config.sentimentThreshold).toBe(0.3)
  })

  test("sports-api includes sportsApiUrl, sport and league", () => {
    const intent = makeIntent({ dataSources: ["sports-api"] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.sportsApiUrl).toBe("https://api.sportsdata.io/v3")
    expect(config.sport).toBe("football")
    expect(config.league).toBe("nfl")
  })

  test("social-api includes PLACEHOLDER_SOCIAL_BEARER_TOKEN", () => {
    const intent = makeIntent({ dataSources: ["social-api"] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.socialApiUrl).toBe("https://api.twitter.com/2")
    expect(config.socialBearerToken).toBe("PLACEHOLDER_SOCIAL_BEARER_TOKEN")
  })

  test("exchange-api includes exchangeApiUrl and tradingPair", () => {
    const intent = makeIntent({ dataSources: ["exchange-api"] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.exchangeApiUrl).toBe("https://api.binance.com/api/v3")
    expect(config.tradingPair).toBe("ETHUSDT")
  })

  test("wallet-api includes PLACEHOLDER_ETHERSCAN_API_KEY", () => {
    const intent = makeIntent({ dataSources: ["wallet-api"] })
    const config = JSON.parse(buildFallbackConfig(intent, makeTemplate()))
    expect(config.walletApiUrl).toBe("https://api.etherscan.io/api")
    expect(config.etherscanApiKey).toBe("PLACEHOLDER_ETHERSCAN_API_KEY")
  })
})

// ─────────────────────────────────────────────
// buildFallbackConfig — wallet-api trigger-type branching
// ─────────────────────────────────────────────

describe("buildFallbackConfig — wallet-api trigger-type branching", () => {
  test("wallet-api with evm_log trigger emits event-driven config", () => {
    const intent = makeIntent({
      dataSources: ["wallet-api"],
      triggerType: "evm_log",
    })
    const template = makeTemplate({ triggerType: "evm_log" })
    const config = JSON.parse(buildFallbackConfig(intent, template))
    expect(config.tokenContractAddress).toBeDefined()
    expect(config.transferEventSignature).toBe("Transfer(address,address,uint256)")
    expect(config.watchAddresses).toBeDefined()
    expect(config.minTransferAmountWei).toBeDefined()
    expect(config.filterDirection).toBe("both")
    // Should NOT have polling fields
    expect(config.walletApiUrl).toBeUndefined()
    expect(config.etherscanApiKey).toBeUndefined()
  })

  test("wallet-api with cron trigger emits polling config", () => {
    const intent = makeIntent({ dataSources: ["wallet-api"] })
    const template = makeTemplate({ triggerType: "cron" })
    const config = JSON.parse(buildFallbackConfig(intent, template))
    expect(config.walletApiUrl).toBe("https://api.etherscan.io/api")
    expect(config.etherscanApiKey).toBe("PLACEHOLDER_ETHERSCAN_API_KEY")
    // Should NOT have evm_log fields
    expect(config.tokenContractAddress).toBeUndefined()
    expect(config.watchAddresses).toBeUndefined()
  })

  test("wallet-api + dexSwap sets responseAction to swap", () => {
    const intent = makeIntent({
      dataSources: ["wallet-api"],
      actions: ["dexSwap"],
      triggerType: "evm_log",
    })
    const template = makeTemplate({ triggerType: "evm_log" })
    const config = JSON.parse(buildFallbackConfig(intent, template))
    expect(config.responseAction).toBe("swap")
  })
})
