// Template 8: Compliance-Gated DeFi Ops
// Trigger: CronCapability | Capabilities: HTTPClient KYC/AML, conditional evmWrite

import { z } from "zod"
import {
  Runner,
  Runtime,
  CronCapability,
  HTTPClient,
  EVMClient,
  handler,
  getNetwork,
  consensusIdenticalAggregation,
} from "@chainlink/cre-sdk"
import { encodeAbiParameters, parseAbiParameters } from "viem"

const configSchema = z.object({
  complianceApiUrl: z.string().describe("KYC/AML compliance API endpoint"),
  sanctionsApiUrl: z.string().describe("Sanctions screening API endpoint"),
  operatorAddress: z.string().describe("Address requesting DeFi operation"),
  operationType: z.string().describe("Type of DeFi operation (swap, lend, stake)"),
  operationData: z.string().describe("JSON-encoded operation parameters"),
  consumerContract: z.string().describe("DeFi operations contract"),
  chainName: z.string().default("base-sepolia").describe("Target chain"),
  cronSchedule: z.string().default("0 */1 * * * *").describe("Check frequency"),
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
    // Step 1: KYC/AML compliance check
    const kycResp = httpClient.fetch(
      `${rt.config.complianceApiUrl}?address=${rt.config.operatorAddress}`,
      { method: "GET", headers: { "Content-Type": "application/json" } }
    ).result()

    const kyc = JSON.parse(kycResp.body)
    if (!kyc.verified) {
      return { status: "rejected", reason: "kyc_failed" }
    }

    // Step 2: Sanctions screening
    const sanctionsResp = httpClient.fetch(
      `${rt.config.sanctionsApiUrl}?address=${rt.config.operatorAddress}`,
      { method: "GET", headers: { "Content-Type": "application/json" } }
    ).result()

    const sanctions = JSON.parse(sanctionsResp.body)
    if (sanctions.flagged) {
      return { status: "rejected", reason: "sanctions_flagged" }
    }

    // Step 3: Execute approved DeFi operation
    const reportData = encodeAbiParameters(
      parseAbiParameters("address operator, string operationType, bool approved, uint256 timestamp"),
      [
        rt.config.operatorAddress as `0x${string}`,
        rt.config.operationType,
        true,
        BigInt(Math.floor(Date.now() / 1000)),
      ]
    )

    evmClient.writeReport({
      contractAddress: rt.config.consumerContract,
      chainSelector: getNetwork(rt.config.chainName),
      report: rt.report(reportData),
    })

    return { status: "approved", operationType: rt.config.operationType }
  })

  consensusIdenticalAggregation({
    fields: ["status"],
    reportId: "compliance_gate",
  })
}

export async function main() {
  runner.run(initWorkflow)
}
