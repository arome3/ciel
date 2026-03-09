// Template 20: Settlement Reconciliation
// Trigger: CronCapability | Capabilities: settlement-api, callContract, evmWrite, alert
//
// Pattern: Cron trigger → fetch settlement records → fetch on-chain state →
//          compare/reconcile → alert on mismatch → write attestation via evmWrite
// Similar to T5 (Proof of Reserve) — compare off-chain vs on-chain

import { z } from "zod"
import {
  cre,
  Runner,
  type Runtime,
  type CronPayload,
  getNetwork,
  encodeCallMsg,
  bytesToHex,
  LAST_FINALIZED_BLOCK_NUMBER,
  encodeAbiParameters,
  parseAbiParameters,
} from "@chainlink/cre-sdk"

// Function selectors (keccak256 of signature, first 4 bytes)
const GET_TOTAL_SETTLED_SELECTOR = "0x5862a614" // getTotalSettled()

const configSchema = z.object({
  schedule: z.string().default("0 0 0 * * *").describe("Reconciliation frequency (daily)"),
  chainSelectorName: z.string().default("ethereum-testnet-sepolia-base-1").describe("Target chain"),
  consumerContract: z.string().describe("Consumer contract for attestation"),
  settlementApiUrl: z.string().describe("Settlement API endpoint"),
  settlementContractAddress: z.string().describe("On-chain settlement ledger address"),
  toleranceBps: z.number().default(10).describe("Tolerance in basis points (10 = 0.1%)"),
  alertWebhookUrl: z.string().default("").describe("Alert webhook for mismatches"),
})

type Config = z.infer<typeof configSchema>


const onCronTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
  runtime.log("Starting settlement reconciliation...")

  const httpClient = new cre.capabilities.HTTPClient()
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: runtime.config.chainSelectorName, isTestnet: true })
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  // Step 1: Fetch off-chain settlement records
  runtime.log("Fetching off-chain settlement records...")
  const settlementResp = httpClient.sendRequest(runtime, {
    url: `${runtime.config.settlementApiUrl}/daily-summary`,
    method: "GET",
    headers: { "Content-Type": "application/json" },
  }).result()

  const offchainData = JSON.parse(settlementResp.body) as {
    totalSettled: string
    recordCount: number
    date: string
  }

  // Step 2: Fetch on-chain settlement total
  runtime.log("Reading on-chain settlement total...")
  const totalResp = evmClient.callContract(runtime, {
    call: encodeCallMsg({ from: "0x0", to: runtime.config.settlementContractAddress, data: GET_TOTAL_SETTLED_SELECTOR }),
    blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
  }).result()

  const onchainTotal = BigInt(bytesToHex(totalResp.data as unknown as Uint8Array))

  // Step 3: Compare and reconcile
  const offchainTotal = BigInt(offchainData.totalSettled)
  const diff = offchainTotal > onchainTotal ? offchainTotal - onchainTotal : onchainTotal - offchainTotal
  const toleranceAmount = (offchainTotal * BigInt(runtime.config.toleranceBps)) / BigInt(10000)
  const isReconciled = diff <= toleranceAmount

  runtime.log(`Off-chain: ${offchainTotal.toString()}, On-chain: ${onchainTotal.toString()}, Diff: ${diff.toString()}, Reconciled: ${isReconciled}`)

  // Step 4: Alert on mismatch
  if (!isReconciled && runtime.config.alertWebhookUrl) {
    runtime.log("Mismatch detected — sending alert...")
    httpClient.sendRequest(runtime, {
      url: runtime.config.alertWebhookUrl,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "settlement_mismatch",
        offchain: offchainTotal.toString(),
        onchain: onchainTotal.toString(),
        difference: diff.toString(),
        date: offchainData.date,
      }),
    }).result()
  }

  // Step 5: Write reconciliation attestation onchain
  const reportData = encodeAbiParameters(
    parseAbiParameters("uint256 offchain, uint256 onchain, bool reconciled, uint256 timestamp"),
    [offchainTotal, onchainTotal, isReconciled, BigInt(Math.floor(runtime.now().getTime() / 1000))]
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

  runtime.log("Settlement reconciliation complete")
  return JSON.stringify({
    reconciled: isReconciled,
    offchain: offchainTotal.toString(),
    onchain: onchainTotal.toString(),
    difference: diff.toString(),
    records: offchainData.recordCount,
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
