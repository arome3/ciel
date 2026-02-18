// Template 2: Cross-Chain Portfolio Rebalancer
// Trigger: CronCapability | Capabilities: Multi-chain EVMClient, rebalance

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
  portfolioApiUrl: z.string().describe("Portfolio data API endpoint"),
  targetAllocations: z.string().describe("JSON string of target allocations e.g. {\"ETH\":50,\"BTC\":30,\"LINK\":20}"),
  driftThreshold: z.number().default(5).describe("Rebalance trigger threshold (percentage drift)"),
  chains: z.string().default("base-sepolia,ethereum-sepolia").describe("Comma-separated chain names"),
  consumerContract: z.string().describe("Consumer contract address"),
  chainName: z.string().default("base-sepolia").describe("Primary chain"),
  cronSchedule: z.string().default("0 0 * * * *").describe("Hourly rebalance check"),
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
    // Fetch current portfolio positions
    const response = httpClient.fetch(rt.config.portfolioApiUrl, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    }).result()

    const positions = JSON.parse(response.body)
    const targets = JSON.parse(rt.config.targetAllocations)

    // Calculate drift from target allocations
    let maxDrift = 0
    let actionCount = 0

    for (const [asset, targetPct] of Object.entries(targets)) {
      const currentPct = positions[asset]?.percentage || 0
      const drift = Math.abs((currentPct as number) - (targetPct as number))
      maxDrift = Math.max(maxDrift, drift)

      if (drift > rt.config.driftThreshold) {
        actionCount++
      }
    }

    // Write rebalance report onchain if drift exceeds threshold
    if (actionCount > 0) {
      const reportData = encodeAbiParameters(
        parseAbiParameters("uint256 maxDrift, uint256 actionCount, uint256 timestamp"),
        [BigInt(Math.round(maxDrift * 100)), BigInt(actionCount), BigInt(Math.floor(Date.now() / 1000))]
      )

      evmClient.writeReport({
        contractAddress: rt.config.consumerContract,
        chainSelector: getNetwork(rt.config.chainName),
        report: rt.report(reportData),
      })
    }

    return { maxDrift: Math.round(maxDrift * 100), actionCount }
  })

  consensusMedianAggregation({
    fields: ["maxDrift", "actionCount"],
    reportId: "rebalance_report",
  })
}

export async function main() {
  runner.run(initWorkflow)
}
