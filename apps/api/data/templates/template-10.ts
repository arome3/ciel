// Template 10: Custom Data Feed / NAV Oracle
// Trigger: CronCapability | Capabilities: Multi-source HTTPClient, weighted avg, writeReport

import { z } from "zod"
import {
  Runner,
  Runtime,
  CronCapability,
  HTTPClient,
  EVMClient,
  handler,
  getNetwork,
  consensusMedianAggregation,
} from "@chainlink/cre-sdk"
import { encodeAbiParameters, parseAbiParameters } from "viem"

const configSchema = z.object({
  dataSources: z.string().describe("JSON array of data source configs: [{url, weight, path}]"),
  aggregationMethod: z.enum(["weighted_average", "median", "min", "max"]).default("weighted_average").describe("How to aggregate multi-source data"),
  minSources: z.number().default(2).describe("Minimum number of sources that must respond"),
  consumerContract: z.string().describe("Oracle consumer contract address"),
  chainName: z.string().default("base-sepolia").describe("Target chain"),
  cronSchedule: z.string().default("0 */5 * * * *").describe("Update frequency"),
})

type Config = z.infer<typeof configSchema>

const runner = Runner.newRunner<Config>({ configSchema })

function initWorkflow(runtime: Runtime<Config>) {
  const cronTrigger = new CronCapability().trigger({
    cronSchedule: runtime.config.cronSchedule,
  })

  const httpClient = new HTTPClient()
  const evmClient = new EVMClient()

  handler(cronTrigger, (rt) => {
    const sources = JSON.parse(rt.config.dataSources) as Array<{
      url: string
      weight: number
      path: string
    }>

    // Fetch data from all sources
    const results: Array<{ value: number; weight: number }> = []

    for (const source of sources) {
      const resp = httpClient.fetch(source.url, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      }).result()

      const data = JSON.parse(resp.body)
      // Navigate JSON path to extract value
      const value = source.path.split(".").reduce(
        (obj: Record<string, unknown>, key: string) => (obj as Record<string, unknown>)[key] as Record<string, unknown>,
        data as Record<string, unknown>,
      ) as unknown as number

      if (typeof value === "number" && !isNaN(value)) {
        results.push({ value, weight: source.weight })
      }
    }

    // Validate minimum source requirement
    if (results.length < rt.config.minSources) {
      return { value: 0, sourceCount: results.length }
    }

    // Aggregate based on configured method
    let aggregatedValue: number

    if (rt.config.aggregationMethod === "weighted_average") {
      const totalWeight = results.reduce((sum, r) => sum + r.weight, 0)
      aggregatedValue = results.reduce((sum, r) => sum + (r.value * r.weight) / totalWeight, 0)
    } else if (rt.config.aggregationMethod === "median") {
      const sorted = results.map((r) => r.value).sort((a, b) => a - b)
      aggregatedValue = sorted[Math.floor(sorted.length / 2)]
    } else if (rt.config.aggregationMethod === "min") {
      aggregatedValue = Math.min(...results.map((r) => r.value))
    } else {
      aggregatedValue = Math.max(...results.map((r) => r.value))
    }

    // Write aggregated oracle value onchain
    const reportData = encodeAbiParameters(
      parseAbiParameters("uint256 value, uint256 sourceCount, uint256 timestamp"),
      [
        BigInt(Math.round(aggregatedValue * 1e8)),
        BigInt(results.length),
        BigInt(Math.floor(Date.now() / 1000)),
      ]
    )

    evmClient.writeReport({
      contractAddress: rt.config.consumerContract,
      chainSelector: getNetwork(rt.config.chainName),
      report: rt.report(reportData),
    })

    return { value: Math.round(aggregatedValue * 1e8), sourceCount: results.length }
  })

  consensusMedianAggregation({
    fields: ["value"],
    reportId: "custom_data_feed",
  })
}

export function main() {
  runner.run(initWorkflow)
}
