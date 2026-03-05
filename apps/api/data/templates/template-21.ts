// Template 21: Shareholder Registry
// Trigger: HTTPCapability | Capabilities: registry-api, compliance-api, evmWrite
//
// Pattern: HTTP trigger → fetch registry data → validate transfer via compliance →
//          update on-chain registry via evmWrite → report
// Combines compliance gating (T8) with registry read/write

import { z } from "zod"
import {
  cre,
  Runner,
  type Runtime,
  getNetwork,
  encodeAbiParameters,
  parseAbiParameters,
} from "@chainlink/cre-sdk"

// Function selectors (keccak256 of signature, first 4 bytes)
const REGISTER_TRANSFER_SELECTOR = "0x22855ef9" // registerTransfer(address,address,uint256)

const configSchema = z.object({
  chainSelectorName: z.string().default("base-sepolia").describe("Target chain"),
  consumerContract: z.string().describe("Consumer contract for onchain reporting"),
  registryContractAddress: z.string().describe("On-chain shareholder registry contract"),
  registryApiUrl: z.string().describe("Registry/Transfer Agent API endpoint"),
  complianceApiUrl: z.string().describe("Compliance API endpoint"),
})

type Config = z.infer<typeof configSchema>


const onHttpTrigger = (runtime: Runtime<Config>, payload: Record<string, unknown>): string => {
  runtime.log("Starting shareholder registry update workflow...")

  const httpClient = new cre.capabilities.HTTPClient()
  const kvClient = new cre.capabilities.ConfidentialHTTPClient()

  const transferFrom = (payload as { from?: string }).from ?? "0x0000000000000000000000000000000000000000"
  const transferTo = (payload as { to?: string }).to ?? "0x0000000000000000000000000000000000000000"
  const shareCount = BigInt((payload as { shares?: string }).shares ?? "0")

  // Step 1: Fetch registry data to validate parties
  runtime.log("Fetching registry data...")
  const registryResp = httpClient.sendRequest(runtime, {
    url: `${runtime.config.registryApiUrl}/holders?address=${transferFrom}`,
    method: "GET",
    headers: { "Content-Type": "application/json" },
  }).result()

  const holderData = JSON.parse(registryResp.body) as { registered: boolean; currentShares: string }

  if (!holderData.registered) {
    runtime.log("Transfer sender not registered in shareholder registry")
    return JSON.stringify({ executed: false, reason: "sender_not_registered" })
  }

  if (BigInt(holderData.currentShares) < shareCount) {
    runtime.log("Insufficient shares for transfer")
    return JSON.stringify({ executed: false, reason: "insufficient_shares" })
  }

  // Step 2: Compliance check for recipient
  runtime.log("Checking recipient compliance...")
  const complianceResp = kvClient.sendRequest(runtime, {
    url: `${runtime.config.complianceApiUrl}/check?address=${transferTo}`,
    method: "GET",
    headers: { "Content-Type": "application/json" },
  }).result()

  const compliance = JSON.parse(complianceResp.body) as { approved: boolean }
  if (!compliance.approved) {
    runtime.log("Recipient failed compliance check — transfer blocked")
    return JSON.stringify({ executed: false, reason: "compliance_failed" })
  }

  // Step 3: Update on-chain registry
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: runtime.config.chainSelectorName, isTestnet: true })
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  // Step 4: Encode registry transfer and report onchain via writeReport
  runtime.log("Encoding share transfer and writing report...")
  const transferData = REGISTER_TRANSFER_SELECTOR + encodeAbiParameters(
    parseAbiParameters("address, address, uint256"),
    [transferFrom as `0x${string}`, transferTo as `0x${string}`, shareCount]
  ).slice(2)

  const reportData = encodeAbiParameters(
    parseAbiParameters("address from, address to, uint256 shares, address target, bytes callData, uint256 timestamp"),
    [
      transferFrom as `0x${string}`,
      transferTo as `0x${string}`,
      shareCount,
      runtime.config.registryContractAddress as `0x${string}`,
      transferData as `0x${string}`,
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

  runtime.log("Shareholder registry transfer completed")
  return JSON.stringify({
    executed: true,
    from: transferFrom,
    to: transferTo,
    shares: shareCount.toString(),
  })
}

const initWorkflow = (config: Config) => {
  const httpCapability = new cre.capabilities.HTTPCapability()
  return [cre.handler(httpCapability.trigger({}), onHttpTrigger)]
}

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema })
  await runner.run(initWorkflow)
}
main()
