// Template 1: Price Monitoring + Alert
// Trigger: CronCapability | Capabilities: HTTPClient, price check, alert

import { z } from "zod"
import {
  Runner,
  Runtime,
  CronCapability,
  HTTPClient,
  handler,
  consensusMedianAggregation,
} from "@chainlink/cre-sdk"

const configSchema = z.object({
  priceApiUrl: z.string().describe("Price feed API endpoint"),
  assetSymbol: z.string().describe("Asset symbol (e.g. ETH, BTC)"),
  threshold: z.number().describe("Price threshold for alert"),
  direction: z.enum(["above", "below"]).describe("Alert when price goes above or below threshold"),
  alertWebhookUrl: z.string().describe("Webhook URL for alert notifications"),
  cronSchedule: z.string().default("0 */5 * * * *").describe("Check frequency"),
  consumerContract: z.string().describe("Consumer contract address"),
  chainName: z.string().default("base-sepolia").describe("Target chain"),
})

type Config = z.infer<typeof configSchema>

const runner = Runner.newRunner<Config>({ configSchema })

function initWorkflow(runtime: Runtime<Config>) {
  const cronTrigger = new CronCapability().trigger({
    cronSchedule: runtime.config.cronSchedule,
  })

  const httpClient = new HTTPClient()

  handler(cronTrigger, (rt) => {
    // Fetch current price
    const priceResponse = httpClient.fetch(
      `${rt.config.priceApiUrl}?symbol=${rt.config.assetSymbol}`,
      { method: "GET", headers: { "Content-Type": "application/json" } }
    ).result()

    const priceData = JSON.parse(priceResponse.body)
    const currentPrice = priceData.price

    // Check threshold condition
    const shouldAlert =
      rt.config.direction === "below"
        ? currentPrice < rt.config.threshold
        : currentPrice > rt.config.threshold

    if (shouldAlert) {
      // Send alert notification
      httpClient.fetch(rt.config.alertWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asset: rt.config.assetSymbol,
          price: currentPrice,
          threshold: rt.config.threshold,
          direction: rt.config.direction,
          timestamp: Date.now(),
        }),
      }).result()
    }

    return { price: Math.round(currentPrice * 1e8), alerted: shouldAlert }
  })

  consensusMedianAggregation({
    fields: ["price"],
    reportId: "price_alert",
  })
}

export function main() {
  runner.run(initWorkflow)
}
