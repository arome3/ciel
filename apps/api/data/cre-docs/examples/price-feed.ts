// Example: Price Feed Monitor with Cron Trigger (Official SDK Pattern)
// Pattern: cre.capabilities.CronCapability + HTTPClient.sendRequest + median consensus

import { z } from "zod"
import {
  cre,
  Runner,
  type Runtime,
  type CronPayload,
  consensusMedianAggregation,
} from "@chainlink/cre-sdk"

const configSchema = z.object({
  priceApiUrl: z.string().describe("Price API endpoint"),
  assetSymbol: z.string().describe("Asset symbol to monitor (e.g. ETH)"),
  schedule: z.string().default("0 */5 * * * *").describe("Cron schedule"),
  consumerContract: z.string().describe("Onchain consumer contract address"),
  chainSelectorName: z.string().default("ethereum-testnet-sepolia").describe("Chain selector name"),
})

type Config = z.infer<typeof configSchema>

const onCronTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
  runtime.log("Fetching price data...")

  const httpClient = new cre.capabilities.HTTPClient()
  const response = httpClient.sendRequest(runtime, {
    url: `${runtime.config.priceApiUrl}?symbol=${runtime.config.assetSymbol}`,
    method: "GET",
    headers: { "Content-Type": "application/json" },
  }).result()

  const data = JSON.parse(response.body)
  const price = Math.round(data.price * 1e8) // 8 decimal precision

  runtime.log(`Price for ${runtime.config.assetSymbol}: ${price}`)
  return JSON.stringify({ price, timestamp: runtime.now().getTime() })
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
