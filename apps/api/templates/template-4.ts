// Template 4: Stablecoin Issuance Pipeline
// Trigger: CronCapability | Capabilities: HTTPClient compliance + reserve, evmWrite

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
  complianceApiUrl: z.string().describe("Compliance verification API endpoint"),
  reserveApiUrl: z.string().describe("Reserve backing verification API endpoint"),
  depositorAddress: z.string().describe("Depositor wallet address"),
  mintAmount: z.number().describe("Amount of stablecoins to mint"),
  minReserveRatio: z.number().default(1.0).describe("Minimum reserve backing ratio"),
  consumerContract: z.string().describe("Stablecoin minting contract"),
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
    // Step 1: Verify compliance status
    const complianceResp = httpClient.fetch(
      `${rt.config.complianceApiUrl}?address=${rt.config.depositorAddress}`,
      { method: "GET", headers: { "Content-Type": "application/json" } }
    ).result()

    const compliance = JSON.parse(complianceResp.body)
    if (!compliance.approved) {
      return { status: "rejected", reason: "compliance_failed" }
    }

    // Step 2: Check reserve backing ratio
    const reserveResp = httpClient.fetch(rt.config.reserveApiUrl, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    }).result()

    const reserve = JSON.parse(reserveResp.body)
    if (reserve.ratio < rt.config.minReserveRatio) {
      return { status: "rejected", reason: "insufficient_reserves" }
    }

    // Step 3: Mint stablecoins via evmWrite
    const reportData = encodeAbiParameters(
      parseAbiParameters("address depositor, uint256 amount, uint256 timestamp"),
      [rt.config.depositorAddress as `0x${string}`, BigInt(rt.config.mintAmount), BigInt(Math.floor(Date.now() / 1000))]
    )

    evmClient.writeReport({
      contractAddress: rt.config.consumerContract,
      chainSelector: getNetwork(rt.config.chainName),
      report: rt.report(reportData),
    })

    return { status: "minted", amount: rt.config.mintAmount }
  })

  consensusIdenticalAggregation({
    fields: ["status"],
    reportId: "stablecoin_issuance",
  })
}

export async function main() {
  runner.run(initWorkflow)
}
