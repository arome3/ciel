// Template 2: Cross-Chain Portfolio Rebalancer
// Trigger: CronCapability | Capabilities: Multi-chain EVMClient, rebalance

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
  portfolioApiUrl: z.string().describe("Portfolio data API endpoint"),
  targetAllocations: z.string().describe("JSON string of target allocations e.g. {\"ETH\":50,\"BTC\":30,\"LINK\":20}"),
  driftThreshold: z.number().default(5).describe("Rebalance trigger threshold (percentage drift)"),
  chains: z.string().default("base-sepolia,ethereum-sepolia").describe("Comma-separated chain names"),
  consumerContract: z.string().describe("Consumer contract address"),
  chainSelectorName: z.string().default("ethereum-testnet-sepolia-base-1").describe("Primary chain"),
  schedule: z.string().default("0 0 * * * *").describe("Hourly rebalance check"),
})

type Config = z.infer<typeof configSchema>

// ─── Handler ──────────────────────────────────────────────────────────────

const onCronTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
  const httpClient = new cre.capabilities.HTTPClient()

  runtime.log("Checking portfolio drift against target allocations")

  // Fetch current portfolio positions
  const response = httpClient
    .sendRequest(runtime, {
      url: runtime.config.portfolioApiUrl,
      method: "GET",
      headers: { "Content-Type": "application/json" },
    })
    .result()

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

  runtime.log("Max drift: " + maxDrift + "%, actions needed: " + actionCount)

  // Write rebalance report onchain if drift exceeds threshold
  if (actionCount > 0) {
    const network = getNetwork({
      chainFamily: "evm",
      chainSelectorName: runtime.config.chainSelectorName,
      isTestnet: true,
    })
    const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

    const reportData = encodeAbiParameters(
      parseAbiParameters("uint256 maxDrift, uint256 actionCount, uint256 timestamp"),
      [BigInt(Math.round(maxDrift * 100)), BigInt(actionCount), BigInt(Math.floor(runtime.now().getTime() / 1000))]
    )

    runtime.log("Writing rebalance report onchain")

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
  }

  return JSON.stringify({ maxDrift: Math.round(maxDrift * 100), actionCount })
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
