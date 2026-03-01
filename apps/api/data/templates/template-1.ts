// Template 1: Price Monitoring + Alert
// Trigger: CronCapability | Capabilities: HTTPClient, price check, alert

import {
  cre,
  Runner,
  type Runtime,
  type CronPayload,
} from "@chainlink/cre-sdk"
import { z } from "zod"

const configSchema = z.object({
  priceApiUrl: z.string().describe("Price feed API endpoint"),
  assetSymbol: z.string().describe("Asset symbol (e.g. ETH, BTC)"),
  threshold: z.number().describe("Price threshold for alert"),
  direction: z.enum(["above", "below"]).describe("Alert when price goes above or below threshold"),
  alertWebhookUrl: z.string().describe("Webhook URL for alert notifications"),
  schedule: z.string().default("0 */5 * * * *").describe("Check frequency"),
  consumerContract: z.string().describe("Consumer contract address"),
  chainSelectorName: z.string().default("base-sepolia").describe("Target chain"),
})

type Config = z.infer<typeof configSchema>

// ─── Handler ──────────────────────────────────────────────────────────────

const onCronTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
  const httpClient = new cre.capabilities.HTTPClient()

  runtime.log("Fetching current price for " + runtime.config.assetSymbol)

  // Fetch current price
  const priceResponse = httpClient
    .sendRequest(runtime, {
      url: `${runtime.config.priceApiUrl}?symbol=${runtime.config.assetSymbol}`,
      method: "GET",
      headers: { "Content-Type": "application/json" },
    })
    .result()

  const priceData = JSON.parse(priceResponse.body)
  const currentPrice = priceData.price

  runtime.log("Current price: " + currentPrice)

  // Check threshold condition
  const shouldAlert =
    runtime.config.direction === "below"
      ? currentPrice < runtime.config.threshold
      : currentPrice > runtime.config.threshold

  if (shouldAlert) {
    runtime.log("Threshold triggered, sending alert")

    // Send alert notification
    httpClient
      .sendRequest(runtime, {
        url: runtime.config.alertWebhookUrl,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asset: runtime.config.assetSymbol,
          price: currentPrice,
          threshold: runtime.config.threshold,
          direction: runtime.config.direction,
          timestamp: runtime.now().getTime(),
        }),
      })
      .result()
  }

  return JSON.stringify({ price: Math.round(currentPrice * 1e8), alerted: shouldAlert })
}

// ─── Workflow Initialization ──────────────────────────────────────────────

const initWorkflow = (config: Config) => {
  const cronTrigger = new cre.capabilities.CronCapability().trigger({
    schedule: config.schedule,
  })

  return [cre.handler(cronTrigger, onCronTrigger)]
}

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema })
  await runner.run(initWorkflow)
}

main()
