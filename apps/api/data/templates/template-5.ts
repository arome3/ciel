// Template 5: Proof of Reserve Monitor
// Trigger: CronCapability | Capabilities: HTTPClient reserve, callContract, writeReport

import {
  cre,
  Runner,
  getNetwork,
  encodeAbiParameters,
  parseAbiParameters,
  encodeCallMsg,
  bytesToHex,
  LAST_FINALIZED_BLOCK_NUMBER,
  type Runtime,
  type CronPayload,
} from "@chainlink/cre-sdk"
import { z } from "zod"

// Function selectors (keccak256 of signature, first 4 bytes)
const TOTAL_SUPPLY_SELECTOR = "0x18160ddd" // totalSupply()

const configSchema = z.object({
  reserveApiUrl: z.string().describe("Reserve holdings API endpoint"),
  tokenContract: z.string().describe("Token contract to check supply"),
  minCollateralRatio: z.number().default(1.0).describe("Minimum collateralization ratio"),
  alertWebhookUrl: z.string().describe("Alert webhook for low collateral"),
  consumerContract: z.string().describe("Proof of reserve consumer contract"),
  chainSelectorName: z.string().default("ethereum-testnet-sepolia-base-1").describe("Target chain"),
  schedule: z.string().default("0 0 * * * *").describe("Hourly check"),
})

type Config = z.infer<typeof configSchema>

// ─── Handler ──────────────────────────────────────────────────────────────

const onCronTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
  const httpClient = new cre.capabilities.HTTPClient()

  runtime.log("Starting proof of reserve check")

  // Fetch off-chain reserve holdings
  const reserveResp = httpClient
    .sendRequest(runtime, {
      url: runtime.config.reserveApiUrl,
      method: "GET",
      headers: { "Content-Type": "application/json" },
    })
    .result()

  const reserves = JSON.parse(reserveResp.body)
  const totalReserves = reserves.totalValue

  // Read on-chain token supply
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.chainSelectorName,
    isTestnet: true,
  })
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  const supplyResp = evmClient.callContract(runtime, {
    call: encodeCallMsg({ from: "0x0", to: runtime.config.tokenContract, data: TOTAL_SUPPLY_SELECTOR }),
    blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
  }).result()

  const totalSupply = Number(BigInt(bytesToHex(supplyResp.data as unknown as Uint8Array)))
  const ratio = totalReserves / (totalSupply / 1e18)

  runtime.log("Reserve ratio: " + ratio + " (threshold: " + runtime.config.minCollateralRatio + ")")

  // Alert if ratio drops below threshold
  if (ratio < runtime.config.minCollateralRatio) {
    runtime.log("Low collateral alert triggered")

    httpClient
      .sendRequest(runtime, {
        url: runtime.config.alertWebhookUrl,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ratio, threshold: runtime.config.minCollateralRatio, timestamp: runtime.now().getTime() }),
      })
      .result()
  }

  // Write proof of reserve attestation onchain
  const reportData = encodeAbiParameters(
    parseAbiParameters("uint256 reserves, uint256 supply, uint256 ratio, uint256 timestamp"),
    [BigInt(Math.round(totalReserves * 1e8)), BigInt(totalSupply), BigInt(Math.round(ratio * 1e8)), BigInt(Math.floor(runtime.now().getTime() / 1000))]
  )

  runtime.log("Writing proof of reserve attestation onchain")

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

  return JSON.stringify({ ratio: Math.round(ratio * 1e8), reserves: Math.round(totalReserves * 1e8) })
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
