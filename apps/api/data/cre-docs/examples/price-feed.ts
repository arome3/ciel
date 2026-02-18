// Example: Price Feed Monitor with Cron Trigger
// Pattern: CronCapability + HTTPClient + median consensus

import { z } from "zod"
import {
  Runner,
  Runtime,
  CronCapability,
  HTTPClient,
  handler,
  consensusMedianAggregation,
} from "@chainlink/cre-sdk"
import { encodeAbiParameters, parseAbiParameters } from "viem"

const configSchema = z.object({
  priceApiUrl: z.string().describe("Price API endpoint"),
  assetSymbol: z.string().describe("Asset symbol to monitor (e.g. ETH)"),
  cronSchedule: z.string().default("0 */5 * * * *").describe("Cron schedule"),
  consumerContract: z.string().describe("Onchain consumer contract address"),
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
    const response = httpClient.fetch(
      `${rt.config.priceApiUrl}?symbol=${rt.config.assetSymbol}`,
      { method: "GET", headers: { "Content-Type": "application/json" } }
    ).result()

    const data = JSON.parse(response.body)
    const price = Math.round(data.price * 1e8) // 8 decimal precision

    return { price, timestamp: Date.now() }
  })

  consensusMedianAggregation({
    fields: ["price"],
    reportId: "price_feed",
  })
}

export function main() {
  runner.run(initWorkflow)
}
