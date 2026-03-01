// Template 22: Dividend Distribution
// Trigger: CronCapability | Capabilities: registry-api, evmWrite (batch transfers)
//
// Pattern: Cron trigger → fetch holder list from registry → calculate pro-rata amounts
//          → batch evmWrite transfers → report summary
// Uses multi-recipient pattern with batching logic

import { z } from "zod"
import {
  cre,
  Runner,
  type Runtime,
  type CronPayload,
  getNetwork,
  encodeAbiParameters,
  parseAbiParameters,
} from "@chainlink/cre-sdk"
import { encodeFunctionData, parseAbi } from "viem"

const configSchema = z.object({
  schedule: z.string().default("0 0 9 1 * *").describe("Distribution schedule (monthly 1st at 9am)"),
  chainSelectorName: z.string().default("base-sepolia").describe("Target chain"),
  consumerContract: z.string().describe("Consumer contract for onchain reporting"),
  registryApiUrl: z.string().describe("Registry API endpoint for holder list"),
  distributionTokenAddress: z.string().describe("Token address for dividend payments"),
  totalDistributionAmount: z.string().default("1000000000000000000000").describe("Total distribution amount in wei"),
  minSharesForDividend: z.string().default("100").describe("Minimum shares to qualify for dividend"),
})

type Config = z.infer<typeof configSchema>

const erc20Abi = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
])

interface ShareHolder {
  address: string
  shares: string
}

const onCronTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
  runtime.log("Starting dividend distribution workflow...")

  const httpClient = new cre.capabilities.HTTPClient()
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: runtime.config.chainSelectorName, isTestnet: true })
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  // Step 1: Fetch holder list from registry
  runtime.log("Fetching shareholder list...")
  const holdersResp = httpClient.sendRequest(runtime, {
    url: `${runtime.config.registryApiUrl}/holders?minShares=${runtime.config.minSharesForDividend}`,
    method: "GET",
    headers: { "Content-Type": "application/json" },
  }).result()

  const holders = JSON.parse(holdersResp.body) as ShareHolder[]
  runtime.log(`Found ${holders.length} eligible shareholders`)

  if (holders.length === 0) {
    return JSON.stringify({ executed: false, reason: "no_eligible_holders" })
  }

  // Step 2: Calculate total shares and pro-rata amounts
  let totalShares = BigInt(0)
  for (const holder of holders) {
    totalShares += BigInt(holder.shares)
  }

  const totalAmount = BigInt(runtime.config.totalDistributionAmount)
  let distributed = BigInt(0)
  let successCount = 0

  // Step 3: Execute batch transfers
  for (const holder of holders) {
    const holderShares = BigInt(holder.shares)
    const proRataAmount = (totalAmount * holderShares) / totalShares

    if (proRataAmount === BigInt(0)) continue

    runtime.log(`Distributing ${proRataAmount.toString()} to ${holder.address}`)

    const transferData = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [holder.address as `0x${string}`, proRataAmount],
    })

    const txResult = evmClient.sendTransaction(runtime, {
      to: runtime.config.distributionTokenAddress,
      data: transferData,
    }).result()

    if (txResult?.success) {
      distributed += proRataAmount
      successCount++
    } else {
      runtime.log(`Transfer to ${holder.address} failed`)
    }
  }

  // Step 4: Report distribution summary onchain
  const reportData = encodeAbiParameters(
    parseAbiParameters("uint256 totalDistributed, uint256 recipientCount, uint256 timestamp"),
    [distributed, BigInt(successCount), BigInt(Math.floor(runtime.now().getTime() / 1000))]
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

  runtime.log(`Dividend distribution complete: ${successCount}/${holders.length} recipients`)
  return JSON.stringify({
    executed: true,
    totalDistributed: distributed.toString(),
    recipients: successCount,
    totalHolders: holders.length,
  })
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
