// Template 4: Stablecoin Issuance Pipeline
// Trigger: CronCapability | Capabilities: HTTPClient compliance + reserve, evmWrite

import { z } from "zod"
import { encodeAbiParameters, parseAbiParameters } from "viem"
import {
  cre,
  Runner,
  type Runtime,
  type CronPayload,
  getNetwork,
  consensusIdenticalAggregation,
  decodeJson,
} from "@chainlink/cre-sdk"

const configSchema = z.object({
  complianceApiUrl: z.string().describe("Compliance verification API endpoint"),
  reserveApiUrl: z.string().describe("Reserve backing verification API endpoint"),
  depositorAddress: z.string().describe("Depositor wallet address"),
  mintAmount: z.number().describe("Amount of stablecoins to mint"),
  minReserveRatio: z.number().default(1.0).describe("Minimum reserve backing ratio"),
  consumerContract: z.string().describe("Stablecoin minting contract"),
  chainSelectorName: z.string().default("base-sepolia").describe("Target chain"),
  schedule: z.string().default("0 */1 * * * *").describe("Check frequency"),
})

type Config = z.infer<typeof configSchema>

const onCronTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
  runtime.log("Starting stablecoin issuance check...")
  const httpClient = new cre.capabilities.HTTPClient()
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: runtime.config.chainSelectorName, isTestnet: true })
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  // Step 1: Verify compliance status
  const complianceResp = httpClient.sendRequest(runtime, {
    url: `${runtime.config.complianceApiUrl}?address=${runtime.config.depositorAddress}`,
    method: "GET",
    headers: { "Content-Type": "application/json" },
  }).result()

  const compliance = decodeJson(complianceResp.body)
  if (!compliance.approved) {
    runtime.log("Compliance check failed")
    return JSON.stringify({ status: "rejected", reason: "compliance_failed" })
  }

  // Step 2: Check reserve backing ratio
  const reserveResp = httpClient.sendRequest(runtime, {
    url: runtime.config.reserveApiUrl,
    method: "GET",
    headers: { "Content-Type": "application/json" },
  }).result()

  const reserve = decodeJson(reserveResp.body)
  if (reserve.ratio < runtime.config.minReserveRatio) {
    runtime.log("Insufficient reserves")
    return JSON.stringify({ status: "rejected", reason: "insufficient_reserves" })
  }

  // Step 3: Mint stablecoins via evmWrite
  const reportData = encodeAbiParameters(
    parseAbiParameters("address depositor, uint256 amount, uint256 timestamp"),
    [runtime.config.depositorAddress as `0x${string}`, BigInt(runtime.config.mintAmount), BigInt(Math.floor(runtime.now().getTime() / 1000))]
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

  runtime.log("Stablecoins minted successfully")
  return JSON.stringify({ status: "minted", amount: runtime.config.mintAmount })
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
