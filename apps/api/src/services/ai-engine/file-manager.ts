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

const TEMPLATES_DIR = join(__dirname, "../../../templates")

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

  if (intent.dataSources.includes("multi-ai")) {
    config.openaiApiKey = "sk-placeholder"
    config.anthropicApiKey = "sk-placeholder"
    config.geminiApiKey = "placeholder"
    config.queryPrompt = "What is the current value?"
  }

  // Alert webhook placeholder
  if (intent.actions.includes("alert")) {
    config.alertWebhookUrl = "https://hooks.slack.com/services/placeholder"
  }

  // Action-specific config
  if (
    intent.actions.includes("evmWrite") ||
    intent.actions.includes("transfer") ||
    intent.actions.includes("mint") ||
    intent.actions.includes("payout")
  ) {
    config.consumerContract = config.consumerContract || "0x0000000000000000000000000000000000000000"
  }

  if (intent.actions.includes("rebalance")) {
    config.targetAllocations = '{"ETH":50,"BTC":30,"LINK":20}'
    config.driftThreshold = 5
  }

  return JSON.stringify(config, null, 2)
}
