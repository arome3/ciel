// Template 10: Custom Data Feed / NAV Oracle
// Trigger: CronCapability | Capabilities: Multi-source HTTPClient, weighted avg, writeReport

import {
  cre,
  Runner,
  getNetwork,
  encodeAbiParameters,
  parseAbiParameters,
  type Runtime,
  type CronPayload,
} from "@chainlink/cre-sdk"
import { z } from "zod"

const configSchema = z.object({
  dataSources: z.string().describe("JSON array of data source configs: [{url, weight, path}]"),
  aggregationMethod: z.enum(["weighted_average", "median", "min", "max"]).default("weighted_average").describe("How to aggregate multi-source data"),
  minSources: z.number().default(2).describe("Minimum number of sources that must respond"),
  consumerContract: z.string().describe("Oracle consumer contract address"),
  chainSelectorName: z.string().default("ethereum-testnet-sepolia-base-1").describe("Target chain"),
  schedule: z.string().default("0 */5 * * * *").describe("Update frequency"),
})

type Config = z.infer<typeof configSchema>

// ─── Handler ──────────────────────────────────────────────────────────────

const onCronTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
  const httpClient = new cre.capabilities.HTTPClient()

  runtime.log("Fetching data from multiple sources for aggregation")

  const sources = JSON.parse(runtime.config.dataSources) as Array<{
    url: string
    weight: number
    path: string
  }>

  // Fetch data from all sources
  const results: Array<{ value: number; weight: number }> = []

  for (const source of sources) {
    const resp = httpClient
      .sendRequest(runtime, {
        url: source.url,
        method: "GET",
        headers: { "Content-Type": "application/json" },
      })
      .result()

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
  if (results.length < runtime.config.minSources) {
    runtime.log("Insufficient sources: " + results.length + " < " + runtime.config.minSources)
    return JSON.stringify({ value: 0, sourceCount: results.length })
  }

  // Aggregate based on configured method
  let aggregatedValue: number

  if (runtime.config.aggregationMethod === "weighted_average") {
    const totalWeight = results.reduce((sum, r) => sum + r.weight, 0)
    aggregatedValue = results.reduce((sum, r) => sum + (r.value * r.weight) / totalWeight, 0)
  } else if (runtime.config.aggregationMethod === "median") {
    const sorted = results.map((r) => r.value).sort((a, b) => a - b)
    aggregatedValue = sorted[Math.floor(sorted.length / 2)]
  } else if (runtime.config.aggregationMethod === "min") {
    aggregatedValue = Math.min(...results.map((r) => r.value))
  } else {
    aggregatedValue = Math.max(...results.map((r) => r.value))
  }

  runtime.log("Aggregated value: " + aggregatedValue + " from " + results.length + " sources")

  // Write aggregated oracle value onchain
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.chainSelectorName,
    isTestnet: true,
  })
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  const reportData = encodeAbiParameters(
    parseAbiParameters("uint256 value, uint256 sourceCount, uint256 timestamp"),
    [
      BigInt(Math.round(aggregatedValue * 1e8)),
      BigInt(results.length),
      BigInt(Math.floor(runtime.now().getTime() / 1000)),
    ]
  )

  const report = runtime.report({
    encodedPayload: reportData,
    encoderName: "EVM",
    signingAlgo: "SECP256K1",
    hashingAlgo: "KECCAK256",
  }).result()

  evmClient.writeReport(runtime, {
    receiver: runtime.config.consumerContract,
    report: report.report,
    gasConfig: { gasLimit: 500000 },
  }).result()

  return JSON.stringify({ value: Math.round(aggregatedValue * 1e8), sourceCount: results.length })
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
