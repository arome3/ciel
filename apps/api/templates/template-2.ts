// Template 2: Cross-Chain Portfolio Rebalancer
// Trigger: CronCapability | Capabilities: Multi-chain EVMClient, rebalance

import { z } from "zod"
import {
  cre,
  Runner,
  type Runtime,
  type CronPayload,
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
  chainSelectorName: z.string().default("base-sepolia").describe("Primary chain"),
  schedule: z.string().default("0 0 * * * *").describe("Hourly rebalance check"),
})

type Config = z.infer<typeof configSchema>

const onCronTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
  runtime.log("Checking portfolio drift...")
  const httpClient = new cre.capabilities.HTTPClient()
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: runtime.config.chainSelectorName, isTestnet: true })
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  // Fetch current portfolio positions
  const response = httpClient.sendRequest(runtime, {
    url: runtime.config.portfolioApiUrl,
    method: "GET",
    headers: { "Content-Type": "application/json" },
  }).result()

  const positions = JSON.parse(response.body)
  const targets = JSON.parse(runtime.config.targetAllocations)

  // Calculate drift from target allocations
  let maxDrift = 0
  let actionCount = 0

  for (const [asset, targetPct] of Object.entries(targets)) {
    const currentPct = positions[asset]?.percentage || 0
    const drift = Math.abs((currentPct as number) - (targetPct as number))
    maxDrift = Math.max(maxDrift, drift)

    if (drift > runtime.config.driftThreshold) {
      actionCount++
    }
  }

  // Write rebalance report onchain if drift exceeds threshold
  if (actionCount > 0) {
    const reportData = encodeAbiParameters(
      parseAbiParameters("uint256 maxDrift, uint256 actionCount, uint256 timestamp"),
      [BigInt(Math.round(maxDrift * 100)), BigInt(actionCount), BigInt(Math.floor(runtime.now().getTime() / 1000))]
    )

    const report = runtime.report({
      encodedPayload: reportData,
      encoderName: "evm",
      signingAlgo: "evm",
      hashingAlgo: "keccak256",
    }).result()

    evmClient.writeReport(runtime, {
      receiver: runtime.config.consumerContract,
      report,
      gasConfig: { gasLimit: 500000 },
    }).result()
  }

  runtime.log("Rebalance check complete")
  return JSON.stringify({ maxDrift: Math.round(maxDrift * 100), actionCount })
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
