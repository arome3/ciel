// Template 5: Proof of Reserve Monitor
// Trigger: CronCapability | Capabilities: HTTPClient reserve, callContract, writeReport

import { z } from "zod"
import { encodeAbiParameters, parseAbiParameters } from "viem"
import {
  cre,
  Runner,
  type Runtime,
  type CronPayload,
  getNetwork,
  consensusMedianAggregation,
  decodeJson,
} from "@chainlink/cre-sdk"

// Function selectors (keccak256 of signature, first 4 bytes)
const TOTAL_SUPPLY_SELECTOR = "0x18160ddd" // totalSupply()

const configSchema = z.object({
  reserveApiUrl: z.string().describe("Reserve holdings API endpoint"),
  tokenContract: z.string().describe("Token contract to check supply"),
  minCollateralRatio: z.number().default(1.0).describe("Minimum collateralization ratio"),
  alertWebhookUrl: z.string().describe("Alert webhook for low collateral"),
  consumerContract: z.string().describe("Proof of reserve consumer contract"),
  chainSelectorName: z.string().default("base-sepolia").describe("Target chain"),
  schedule: z.string().default("0 0 * * * *").describe("Hourly check"),
})

type Config = z.infer<typeof configSchema>

const onCronTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
  runtime.log("Checking proof of reserve...")
  const httpClient = new cre.capabilities.HTTPClient()
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: runtime.config.chainSelectorName, isTestnet: true })
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  // Fetch off-chain reserve holdings
  const reserveResp = httpClient.sendRequest(runtime, {
    url: runtime.config.reserveApiUrl,
    method: "GET",
    headers: { "Content-Type": "application/json" },
  }).result()

  const reserves = decodeJson(reserveResp.body)
  const totalReserves = reserves.totalValue

  // Read on-chain token supply
  const supplyResult = evmClient.callContract({
    contractAddress: runtime.config.tokenContract,
    chainSelector: network.chainSelector.selector,
    callData: TOTAL_SUPPLY_SELECTOR,
  }).result()

  const totalSupply = Number(BigInt(supplyResult))
  const ratio = totalReserves / (totalSupply / 1e18)

  // Alert if ratio drops below threshold
  if (ratio < runtime.config.minCollateralRatio) {
    runtime.log("Low collateral ratio detected, sending alert")
    httpClient.sendRequest(runtime, {
      url: runtime.config.alertWebhookUrl,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ratio, threshold: runtime.config.minCollateralRatio, timestamp: runtime.now().getTime() }),
    }).result()
  }

  // Write proof of reserve attestation onchain
  const reportData = encodeAbiParameters(
    parseAbiParameters("uint256 reserves, uint256 supply, uint256 ratio, uint256 timestamp"),
    [BigInt(Math.round(totalReserves * 1e8)), BigInt(totalSupply), BigInt(Math.round(ratio * 1e8)), BigInt(Math.floor(runtime.now().getTime() / 1000))]
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

  runtime.log("Proof of reserve attestation written")
  return JSON.stringify({ ratio: Math.round(ratio * 1e8), reserves: Math.round(totalReserves * 1e8) })
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
