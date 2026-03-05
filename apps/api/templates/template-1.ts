// Template 1: Price Monitoring + Alert
// Trigger: CronCapability | Capabilities: HTTPClient, price check, alert

import { z } from "zod"
import {
  cre,
  Runner,
  type Runtime,
  type CronPayload,
  consensusMedianAggregation,
  decodeJson,
} from "@chainlink/cre-sdk"

const configSchema = z.object({
  priceApiUrl: z.string().describe("Price feed API endpoint"),
  assetId: z.string().describe("CoinGecko asset ID (e.g. ethereum, bitcoin)"),
  threshold: z.number().describe("Price threshold for alert"),
  direction: z.enum(["above", "below"]).describe("Alert when price goes above or below threshold"),
  alertWebhookUrl: z.string().describe("Webhook URL for alert notifications"),
  schedule: z.string().default("0 */5 * * * *").describe("Check frequency"),
  consumerContract: z.string().describe("Consumer contract address"),
  chainSelectorName: z.string().default("ethereum-testnet-sepolia").describe("Chain selector name"),
})

type Config = z.infer<typeof configSchema>

const onCronTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
  runtime.log("Checking price...")
  const httpClient = new cre.capabilities.HTTPClient()

  const priceResponse = httpClient.sendRequest(runtime, {
    url: `${runtime.config.priceApiUrl}?ids=${runtime.config.assetId}&vs_currencies=usd`,
    method: "GET",
    headers: { "Content-Type": "application/json" },
  }).result()

  const priceData = decodeJson(priceResponse.body)
  const currentPrice = priceData[runtime.config.assetId]?.usd ?? 0

  const shouldAlert =
    runtime.config.direction === "below"
      ? currentPrice < runtime.config.threshold
      : currentPrice > runtime.config.threshold

  if (shouldAlert) {
    httpClient.sendRequest(runtime, {
      url: runtime.config.alertWebhookUrl,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        asset: runtime.config.assetId,
        price: currentPrice,
        threshold: runtime.config.threshold,
        direction: runtime.config.direction,
        timestamp: runtime.now().getTime(),
      }),
    }).result()
  }

  return JSON.stringify({ price: Math.round(currentPrice * 1e8), alerted: shouldAlert })
}

const initWorkflow = (config: Config) => {
  const cronCapability = new cre.capabilities.CronCapability()
  return [cre.handler(cronCapability.trigger({ schedule: config.schedule }), onCronTrigger)]
}

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema })
  await runner.run(initWorkflow)
}
main()
