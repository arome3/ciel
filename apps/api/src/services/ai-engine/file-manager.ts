// ─────────────────────────────────────────────
// File Manager — Template File Loading + Fallback Config
// ─────────────────────────────────────────────
// Loads pre-built fallback template files and builds default
// config JSON from parsed intent fields. Uses readFileSync
// to match the context-builder.ts pattern.

import { readFileSync } from "fs"
import { join } from "path"
import type { ParsedIntent } from "./types"
import type { TemplateDefinition } from "./template-matcher"
import { stemmer, buildStemmedSet } from "./nlp-utils"

const TEMPLATES_DIR = join(__dirname, "../../../templates")

export const STATE_KEYWORDS = new Set([
  // Existing
  "history", "previous", "yesterday", "portfolio", "holdings",
  "track", "accumulate", "average", "counter", "trend",
  // Temporal/persistence words
  "remember", "store", "save", "persist",
  "cumulative", "rolling", "moving", "aggregate",
  "delta", "compare", "daily", "weekly", "prior",
])

const ONCHAIN_STATE_KEYWORDS = new Set([
  "onchain", "trustless", "verifiable", "audit",
  "immutable", "transparent", "tamperproof", "blockchain",
])

// Pre-computed stemmed sets for morphological matching (e.g. "tracking" → "track")
const STATE_KEYWORDS_STEMMED = buildStemmedSet(Array.from(STATE_KEYWORDS))
const ONCHAIN_STATE_KEYWORDS_STEMMED = buildStemmedSet(Array.from(ONCHAIN_STATE_KEYWORDS))

/**
 * Loads a pre-built template TypeScript file.
 * @returns File contents as string, or null if not found
 */
export function loadTemplateFile(templateId: number): string | null {
  try {
    return readFileSync(join(TEMPLATES_DIR, `template-${templateId}.ts`), "utf-8")
  } catch {
    return null
  }
}

/**
 * Loads a pre-built template config JSON file as string.
 * @returns JSON string, or null if not found
 */
export function loadTemplateConfig(templateId: number): string | null {
  try {
    return readFileSync(join(TEMPLATES_DIR, `template-${templateId}.config.json`), "utf-8")
  } catch {
    return null
  }
}

/**
 * Detects whether any keyword matches the STATE_KEYWORDS set via exact or stemmed matching.
 * Returns the user's original keyword (for stateKey naming) or null.
 */
export function detectStateKeyword(keywords: string[]): string | null {
  // Tier 1: exact match (preferred — preserves naming)
  const exact = keywords.find((kw) => STATE_KEYWORDS.has(kw))
  if (exact) return exact
  // Tier 2: stemmed match
  for (const kw of keywords) {
    if (STATE_KEYWORDS_STEMMED.has(stemmer(kw))) return kw
  }
  return null
}

/**
 * Detects whether any keyword matches the ONCHAIN_STATE_KEYWORDS set via exact or stemmed matching.
 * Returns the user's original keyword or null.
 */
export function detectOnchainStateKeyword(keywords: string[]): string | null {
  const exact = keywords.find((kw) => ONCHAIN_STATE_KEYWORDS.has(kw))
  if (exact) return exact
  for (const kw of keywords) {
    if (ONCHAIN_STATE_KEYWORDS_STEMMED.has(stemmer(kw))) return kw
  }
  return null
}

/**
 * Builds a fallback config JSON string from intent fields.
 * Uses intent.chains, intent.schedule, and intent.dataSources
 * to populate sensible defaults.
 *
 * Note: ParsedIntent has NO .parameters field — uses
 * .chains, .schedule, .dataSources, .conditions
 */
export function buildFallbackConfig(
  intent: ParsedIntent,
  template: TemplateDefinition,
): string {
  const config: Record<string, unknown> = {}

  // Chain configuration
  const chain = intent.chains.length > 0 ? intent.chains[0] : "base-sepolia"
  config.chainName = chain

  // Schedule (for cron-triggered templates)
  if (template.triggerType === "cron" && intent.schedule) {
    config.cronSchedule = intent.schedule
  } else if (template.triggerType === "cron") {
    config.cronSchedule = "0 */5 * * * *" // Default: every 5 minutes
  }

  // Consumer contract placeholder
  config.consumerContract = "0x0000000000000000000000000000000000000000"

  // Data source hints
  if (intent.dataSources.includes("price-feed")) {
    config.priceApiUrl = "https://api.coingecko.com/api/v3/simple/price"
    config.assetId = "ethereum"
    config.threshold = 3000
    config.direction = "below"
  }

  if (intent.dataSources.includes("weather-api")) {
    config.weatherApiUrl = "https://api.weather.gov/points"
  }

  if (intent.dataSources.includes("flight-api")) {
    config.flightApiUrl = "https://api.flightaware.com/json/FlightXML3"
  }

  if (intent.dataSources.includes("reserve-api")) {
    config.reserveApiUrl = "https://api.example.com/reserves"
  }

  if (intent.dataSources.includes("nav-api")) {
    config.navApiUrl = "https://api.example.com/nav"
  }

  if (intent.dataSources.includes("compliance-api")) {
    config.complianceApiUrl = "https://api.example.com/compliance"
  }

  if (intent.dataSources.includes("defi-api")) {
    config.defiApiUrl = "https://api.example.com/defi"
  }

  if (intent.dataSources.includes("prediction-market")) {
    config.predictionMarketApiUrl = "https://api.example.com/predictions"
  }

  if (intent.dataSources.includes("github-api")) {
    config.githubApiUrl = "https://api.github.com"
    config.githubToken = "PLACEHOLDER_GITHUB_TOKEN"
    config.githubOwner = "PLACEHOLDER_GITHUB_OWNER"
    config.githubRepo = "PLACEHOLDER_GITHUB_REPO"
  }

  if (intent.dataSources.includes("news-api")) {
    config.newsApiUrl = "https://newsapi.org/v2/everything"
    config.newsApiKey = "PLACEHOLDER_NEWS_API_KEY"
    config.newsQuery = "crypto OR blockchain"
    config.sentimentThreshold = 0.3
  }

  if (intent.dataSources.includes("sports-api")) {
    config.sportsApiUrl = "https://api.sportsdata.io/v3"
    config.sport = "football"
    config.league = "nfl"
  }

  if (intent.dataSources.includes("social-api")) {
    config.socialApiUrl = "https://api.twitter.com/2"
    config.socialBearerToken = "PLACEHOLDER_SOCIAL_BEARER_TOKEN"
    config.socialQuery = "ethereum OR bitcoin"
    config.minFollowers = 10000
  }

  if (intent.dataSources.includes("exchange-api")) {
    config.exchangeApiUrl = "https://api.binance.com/api/v3"
    config.tradingPair = "ETHUSDT"
  }

  if (intent.dataSources.includes("wallet-api")) {
    if (template.triggerType === "evm_log") {
      // Event-driven: T12 Wallet Activity Monitor
      config.tokenContractAddress = "0x0000000000000000000000000000000000000000"
      config.transferEventSignature = "Transfer(address,address,uint256)"
      config.watchAddresses = "0x0000000000000000000000000000000000000000"
      config.minTransferAmountWei = "100000000000000000000"
      config.filterDirection = "both"
      config.knownExchangeAddresses = ""
      config.responseAction = "alert"
      config.alertWebhookUrl = "PLACEHOLDER_ALERT_WEBHOOK_URL"
      config.enrichmentApiUrl = ""
      config.enrichmentApiKey = ""
    } else {
      // Polling-based: fallback for cron-triggered wallet monitoring
      config.walletApiUrl = "https://api.etherscan.io/api"
      config.etherscanApiKey = "PLACEHOLDER_ETHERSCAN_API_KEY"
      config.watchAddress = "0x0000000000000000000000000000000000000000"
      config.minTransferAmount = "100000000000000000000"
      config.transferEventSignature = "Transfer(address,address,uint256)"
    }
  }

  if (intent.actions.includes("dexSwap") && intent.dataSources.includes("wallet-api")) {
    config.responseAction = "swap"
  }

  if (intent.dataSources.includes("multi-ai")) {
    config.prompt = "What is the current value?"
    config.openaiModel = "gpt-4o"
    config.claudeModel = "claude-sonnet-4-20250514"
    config.geminiModel = "gemini-1.5-pro"
    config.openaiApiEndpoint = "https://api.openai.com/v1/chat/completions"
    config.evms = [{ chainSelectorName: "base-sepolia", contractAddress: config.consumerContract || "0x0000000000000000000000000000000000000000" }]
  }

  // Alert webhook placeholder
  if (intent.actions.includes("alert")) {
    config.alertWebhookUrl = "PLACEHOLDER_ALERT_WEBHOOK_URL"
  }

  // Action-specific config
  if (
    intent.actions.includes("evmWrite") ||
    intent.actions.includes("transfer") ||
    intent.actions.includes("mint") ||
    intent.actions.includes("payout") ||
    intent.actions.includes("dexSwap")
  ) {
    config.consumerContract = config.consumerContract || "0x0000000000000000000000000000000000000000"
  }

  if (intent.actions.includes("dexSwap")) {
    config.swapRouterAddress = "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4"
    config.tokenIn = "0x4200000000000000000000000000000000000006"
    config.tokenOut = "0x0000000000000000000000000000000000000000"
    config.poolFee = 3000
    config.slippageBps = 50
    config.swapAmountWei = "100000000000000000"
    config.recipientAddress = "0x0000000000000000000000000000000000000000"
    config.tokenOutDecimals = 18
    config.tokenInDecimals = 18
    config.useNativeETH = true
    // Price-feed defaults — ensure dexSwap is self-contained even if
    // price-feed data source wasn't separately detected
    config.priceApiUrl = config.priceApiUrl || "https://api.coingecko.com/api/v3/simple/price"
    config.assetId = config.assetId || "ethereum"
    config.threshold = config.threshold || 2000
    config.direction = config.direction || "below"
  }

  if (intent.actions.includes("rebalance")) {
    config.targetAllocations = '{"ETH":50,"BTC":30,"LINK":20}'
    config.driftThreshold = 5
  }

  // State management: add KV store config when stateful keywords detected
  const stateKeyword = detectStateKeyword(intent.keywords)
  if (stateKeyword) {
    config.kvStoreUrl = "PLACEHOLDER_KV_STORE_URL"
    config.kvApiKey = "PLACEHOLDER_KV_API_KEY"
    config.stateKey = `ciel-${stateKeyword}-data`
  }

  // Onchain state: add workflow ID when onchain state keywords detected
  const onchainKeyword = detectOnchainStateKeyword(intent.keywords)
  if (onchainKeyword) {
    config.onchainWorkflowId = "PLACEHOLDER_WORKFLOW_ID"
  }

  return JSON.stringify(config, null, 2)
}
