// Example: Event-Driven Report Writer
// Pattern: CronCapability + writeReport + viem encoding

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
  dataApiUrl: z.string().describe("Data source API URL"),
  consumerContract: z.string().describe("Onchain consumer contract"),
  chainName: z.string().default("base-sepolia").describe("Target chain"),
  cronSchedule: z.string().default("0 */10 * * * *").describe("Every 10 minutes"),
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
    // Fetch data from external source
    const response = httpClient.fetch(rt.config.dataApiUrl, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    }).result()

    const data = JSON.parse(response.body)
    const value = Math.round(data.value * 1e8)

    // Encode data for onchain consumption using viem
    const reportData = encodeAbiParameters(
      parseAbiParameters("uint256 value, uint256 timestamp, string source"),
      [BigInt(value), BigInt(Math.floor(Date.now() / 1000)), data.source]
    )

    // Write report onchain
    evmClient.writeReport({
      contractAddress: rt.config.consumerContract,
      chainSelector: getNetwork(rt.config.chainName),
      report: rt.report(reportData),
    })

    return { value, source: data.source, timestamp: Date.now() }
  })

  consensusMedianAggregation({
    fields: ["value"],
    reportId: "event_driven_report",
  })
}

export function main() {
  runner.run(initWorkflow)
}
