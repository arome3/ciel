// Template 5: Proof of Reserve Monitor
// Trigger: CronCapability | Capabilities: HTTPClient reserve, callContract, writeReport

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
import { encodeFunctionData, parseAbi, decodeFunctionResult, encodeAbiParameters, parseAbiParameters } from "viem"

const configSchema = z.object({
  reserveApiUrl: z.string().describe("Reserve holdings API endpoint"),
  tokenContract: z.string().describe("Token contract to check supply"),
  minCollateralRatio: z.number().default(1.0).describe("Minimum collateralization ratio"),
  alertWebhookUrl: z.string().describe("Alert webhook for low collateral"),
  consumerContract: z.string().describe("Proof of reserve consumer contract"),
  chainName: z.string().default("base-sepolia").describe("Target chain"),
  cronSchedule: z.string().default("0 0 * * * *").describe("Hourly check"),
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
    // Fetch off-chain reserve holdings
    const reserveResp = httpClient.fetch(rt.config.reserveApiUrl, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    }).result()

    const reserves = JSON.parse(reserveResp.body)
    const totalReserves = reserves.totalValue

    // Read on-chain token supply
    const abi = parseAbi(["function totalSupply() view returns (uint256)"])
    const supplyResult = evmClient.callContract({
      contractAddress: rt.config.tokenContract,
      chainSelector: getNetwork(rt.config.chainName),
      callData: encodeFunctionData({ abi, functionName: "totalSupply" }),
    }).result()

    const totalSupply = Number(decodeFunctionResult({ abi, functionName: "totalSupply", data: supplyResult }))
    const ratio = totalReserves / (totalSupply / 1e18)

    // Alert if ratio drops below threshold
    if (ratio < rt.config.minCollateralRatio) {
      httpClient.fetch(rt.config.alertWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ratio, threshold: rt.config.minCollateralRatio, timestamp: Date.now() }),
      }).result()
    }

    // Write proof of reserve attestation onchain
    const reportData = encodeAbiParameters(
      parseAbiParameters("uint256 reserves, uint256 supply, uint256 ratio, uint256 timestamp"),
      [BigInt(Math.round(totalReserves * 1e8)), BigInt(totalSupply), BigInt(Math.round(ratio * 1e8)), BigInt(Math.floor(Date.now() / 1000))]
    )

    evmClient.writeReport({
      contractAddress: rt.config.consumerContract,
      chainSelector: getNetwork(rt.config.chainName),
      report: rt.report(reportData),
    })

    return { ratio: Math.round(ratio * 1e8), reserves: Math.round(totalReserves * 1e8) }
  })

  consensusMedianAggregation({
    fields: ["ratio", "reserves"],
    reportId: "proof_of_reserve",
  })
}

export function main() {
  runner.run(initWorkflow)
}
