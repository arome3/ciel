// Template 6: Tokenized Fund Lifecycle
// Trigger: CronCapability | Capabilities: HTTPClient NAV + compliance, mint/burn

import { z } from "zod"
import {
  cre,
  Runner,
  type Runtime,
  type CronPayload,
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
  chainSelectorName: z.string().default("base-sepolia").describe("Target chain"),
  schedule: z.string().default("0 0 0 * * *").describe("Daily NAV update"),
})

type Config = z.infer<typeof configSchema>

const onCronTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
  runtime.log("Processing fund lifecycle operation...")
  const httpClient = new cre.capabilities.HTTPClient()
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: runtime.config.chainSelectorName, isTestnet: true })
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  // Fetch current NAV
  const navResp = httpClient.sendRequest(runtime, {
    url: runtime.config.navApiUrl,
    method: "GET",
    headers: { "Content-Type": "application/json" },
  }).result()

  const nav = JSON.parse(navResp.body)
  const unitPrice = nav.navPerShare

  // Verify investor compliance
  const compResp = httpClient.sendRequest(runtime, {
    url: `${runtime.config.complianceApiUrl}?address=${runtime.config.investorAddress}`,
    method: "GET",
    headers: { "Content-Type": "application/json" },
  }).result()

  const compliance = JSON.parse(compResp.body)
  if (!compliance.approved) {
    runtime.log("Investor compliance check failed")
    return JSON.stringify({ status: "rejected", reason: "compliance_failed", nav: Math.round(unitPrice * 1e8) })
  }

  // Calculate shares and process operation
  const shares = runtime.config.operation === "subscribe"
    ? Math.floor((runtime.config.amount / unitPrice) * 1e18)
    : runtime.config.amount

  const reportData = encodeAbiParameters(
    parseAbiParameters("address investor, uint256 shares, bool isMint, uint256 nav, uint256 timestamp"),
    [
      runtime.config.investorAddress as `0x${string}`,
      BigInt(shares),
      runtime.config.operation === "subscribe",
      BigInt(Math.round(unitPrice * 1e8)),
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

  runtime.log("Fund operation processed successfully")
  return JSON.stringify({ status: "processed", shares, nav: Math.round(unitPrice * 1e8) })
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
