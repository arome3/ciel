// Template 8: Compliance-Gated DeFi Ops
// Trigger: CronCapability | Capabilities: HTTPClient KYC/AML, conditional evmWrite

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
  complianceApiUrl: z.string().describe("KYC/AML compliance API endpoint"),
  sanctionsApiUrl: z.string().describe("Sanctions screening API endpoint"),
  operatorAddress: z.string().describe("Address requesting DeFi operation"),
  operationType: z.string().describe("Type of DeFi operation (swap, lend, stake)"),
  operationData: z.string().describe("JSON-encoded operation parameters"),
  consumerContract: z.string().describe("DeFi operations contract"),
  chainSelectorName: z.string().default("ethereum-testnet-sepolia-base-1").describe("Target chain"),
  schedule: z.string().default("0 */1 * * * *").describe("Check frequency"),
})

type Config = z.infer<typeof configSchema>

// ─── Handler ──────────────────────────────────────────────────────────────

const onCronTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
  const httpClient = new cre.capabilities.HTTPClient()

  runtime.log("Running compliance gate for DeFi operation: " + runtime.config.operationType)

  // Step 1: KYC/AML compliance check
  const kycResp = httpClient
    .sendRequest(runtime, {
      url: `${runtime.config.complianceApiUrl}?address=${runtime.config.operatorAddress}`,
      method: "GET",
      headers: { "Content-Type": "application/json" },
    })
    .result()

  const kyc = JSON.parse(kycResp.body)
  if (!kyc.verified) {
    runtime.log("KYC check failed for " + runtime.config.operatorAddress)
    return JSON.stringify({ status: "rejected", reason: "kyc_failed" })
  }

  // Step 2: Sanctions screening
  const sanctionsResp = httpClient
    .sendRequest(runtime, {
      url: `${runtime.config.sanctionsApiUrl}?address=${runtime.config.operatorAddress}`,
      method: "GET",
      headers: { "Content-Type": "application/json" },
    })
    .result()

  const sanctions = JSON.parse(sanctionsResp.body)
  if (sanctions.flagged) {
    runtime.log("Sanctions flag raised for " + runtime.config.operatorAddress)
    return JSON.stringify({ status: "rejected", reason: "sanctions_flagged" })
  }

  runtime.log("Compliance checks passed, executing DeFi operation")

  // Step 3: Execute approved DeFi operation
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.chainSelectorName,
    isTestnet: true,
  })
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

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
    encoderName: "EVM",
    signingAlgo: "SECP256K1",
    hashingAlgo: "KECCAK256",
  }).result()

  evmClient.writeReport(runtime, {
    receiver: runtime.config.consumerContract,
    report: report.report,
    gasConfig: { gasLimit: 500000 },
  }).result()

  return JSON.stringify({ status: "approved", operationType: runtime.config.operationType })
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
