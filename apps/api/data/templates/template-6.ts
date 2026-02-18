// Template 6: Tokenized Fund Lifecycle
// Trigger: CronCapability | Capabilities: HTTPClient NAV + compliance, mint/burn

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
import { encodeAbiParameters, parseAbiParameters } from "viem"

const configSchema = z.object({
  navApiUrl: z.string().describe("NAV calculation API endpoint"),
  complianceApiUrl: z.string().describe("Investor compliance API endpoint"),
  investorAddress: z.string().describe("Investor wallet address"),
  operation: z.enum(["subscribe", "redeem"]).describe("Fund operation type"),
  amount: z.number().describe("Amount in fund units"),
  consumerContract: z.string().describe("Fund token contract"),
  chainName: z.string().default("base-sepolia").describe("Target chain"),
  cronSchedule: z.string().default("0 0 0 * * *").describe("Daily NAV update"),
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
    // Fetch current NAV
    const navResp = httpClient.fetch(rt.config.navApiUrl, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    }).result()

    const nav = JSON.parse(navResp.body)
    const unitPrice = nav.navPerShare

    // Verify investor compliance
    const compResp = httpClient.fetch(
      `${rt.config.complianceApiUrl}?address=${rt.config.investorAddress}`,
      { method: "GET", headers: { "Content-Type": "application/json" } }
    ).result()

    const compliance = JSON.parse(compResp.body)
    if (!compliance.approved) {
      return { status: "rejected", reason: "compliance_failed", nav: Math.round(unitPrice * 1e8) }
    }

    // Calculate shares and process operation
    const shares = rt.config.operation === "subscribe"
      ? Math.floor((rt.config.amount / unitPrice) * 1e18)
      : rt.config.amount

    const reportData = encodeAbiParameters(
      parseAbiParameters("address investor, uint256 shares, bool isMint, uint256 nav, uint256 timestamp"),
      [
        rt.config.investorAddress as `0x${string}`,
        BigInt(shares),
        rt.config.operation === "subscribe",
        BigInt(Math.round(unitPrice * 1e8)),
        BigInt(Math.floor(Date.now() / 1000)),
      ]
    )

    evmClient.writeReport({
      contractAddress: rt.config.consumerContract,
      chainSelector: getNetwork(rt.config.chainName),
      report: rt.report(reportData),
    })

    return { status: "processed", shares, nav: Math.round(unitPrice * 1e8) }
  })

  consensusMedianAggregation({
    fields: ["nav"],
    reportId: "fund_lifecycle",
  })
}

export function main() {
  runner.run(initWorkflow)
}
