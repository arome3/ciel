// Template 8: Compliance-Gated DeFi Ops
// Trigger: CronCapability | Capabilities: HTTPClient KYC/AML, conditional evmWrite

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
  complianceApiUrl: z.string().describe("KYC/AML compliance API endpoint"),
  sanctionsApiUrl: z.string().describe("Sanctions screening API endpoint"),
  operatorAddress: z.string().describe("Address requesting DeFi operation"),
  operationType: z.string().describe("Type of DeFi operation (swap, lend, stake)"),
  operationData: z.string().describe("JSON-encoded operation parameters"),
  consumerContract: z.string().describe("DeFi operations contract"),
  chainSelectorName: z.string().default("base-sepolia").describe("Target chain"),
  schedule: z.string().default("0 */1 * * * *").describe("Check frequency"),
})

type Config = z.infer<typeof configSchema>

const onCronTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
  runtime.log("Running compliance gate checks...")
  const httpClient = new cre.capabilities.HTTPClient()
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: runtime.config.chainSelectorName, isTestnet: true })
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  // Step 1: KYC/AML compliance check
  const kycResp = httpClient.sendRequest(runtime, {
    url: `${runtime.config.complianceApiUrl}?address=${runtime.config.operatorAddress}`,
    method: "GET",
    headers: { "Content-Type": "application/json" },
  }).result()

  const kyc = decodeJson(kycResp.body)
  if (!kyc.verified) {
    runtime.log("KYC check failed")
    return JSON.stringify({ status: "rejected", reason: "kyc_failed" })
  }

  // Step 2: Sanctions screening
  const sanctionsResp = httpClient.sendRequest(runtime, {
    url: `${runtime.config.sanctionsApiUrl}?address=${runtime.config.operatorAddress}`,
    method: "GET",
    headers: { "Content-Type": "application/json" },
  }).result()

  const sanctions = decodeJson(sanctionsResp.body)
  if (sanctions.flagged) {
    runtime.log("Sanctions screening flagged")
    return JSON.stringify({ status: "rejected", reason: "sanctions_flagged" })
  }

  // Step 3: Execute approved DeFi operation
  const reportData = encodeAbiParameters(
    parseAbiParameters("address operator, string operationType, bool approved, uint256 timestamp"),
    [
      runtime.config.operatorAddress as `0x${string}`,
      runtime.config.operationType,
      true,
      BigInt(Math.floor(runtime.now().getTime() / 1000)),
    ]
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

  runtime.log("DeFi operation approved and executed")
  return JSON.stringify({ status: "approved", operationType: runtime.config.operationType })
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
