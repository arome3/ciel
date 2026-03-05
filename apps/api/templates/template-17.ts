// Template 17: Stablecoin Redemption/Burn
// Trigger: HTTPCapability | Capabilities: compliance-api, callContract (balanceOf), evmWrite (burn)
//
// Pattern: HTTP trigger → compliance check → balanceOf check → burn via evmWrite → report
// Reuses T4's compliance check pattern and T15's viem ABI encoding

import { z } from "zod"
import { encodeAbiParameters, parseAbiParameters } from "viem"
import {
  cre,
  Runner,
  type Runtime,
  getNetwork,
  encodeCallMsg,
  bytesToHex,
  LAST_FINALIZED_BLOCK_NUMBER,
  decodeJson,
} from "@chainlink/cre-sdk"

// Function selectors (keccak256 of signature, first 4 bytes)
const BALANCE_OF_SELECTOR = "0x70a08231" // balanceOf(address)
const BURN_SELECTOR = "0x42966c68"       // burn(uint256)

const configSchema = z.object({
  chainSelectorName: z.string().default("base-sepolia").describe("Target chain"),
  consumerContract: z.string().describe("Consumer contract for onchain reporting"),
  complianceApiUrl: z.string().describe("Compliance API endpoint"),
  tokenAddress: z.string().describe("Stablecoin token contract address"),
  minBurnAmount: z.string().default("1000000000000000000").describe("Minimum burn amount in wei"),
  assetId: z.string().default("USDC").describe("Stablecoin asset identifier"),
})

type Config = z.infer<typeof configSchema>


const onHttpTrigger = (runtime: Runtime<Config>, payload: Record<string, unknown>): string => {
  runtime.log("Starting stablecoin redemption/burn workflow...")

  const httpClient = new cre.capabilities.HTTPClient()
  const redeemer = (payload as { redeemer?: string }).redeemer ?? runtime.config.consumerContract
  const burnAmount = BigInt((payload as { amount?: string }).amount ?? runtime.config.minBurnAmount)

  // Step 1: Compliance check
  runtime.log("Checking compliance status...")
  const complianceResp = httpClient.sendRequest(runtime, {
    url: `${runtime.config.complianceApiUrl}/check?address=${redeemer}`,
    method: "GET",
    headers: { "Content-Type": "application/json" },
  }).result()

  const compliance = decodeJson(complianceResp.body) as { approved: boolean }
  if (!compliance.approved) {
    runtime.log("Compliance check failed — redemption blocked")
    return JSON.stringify({ executed: false, reason: "compliance_failed" })
  }

  // Step 2: Check token balance
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: runtime.config.chainSelectorName, isTestnet: true })
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  const balanceCallData = BALANCE_OF_SELECTOR + encodeAbiParameters(
    parseAbiParameters("address"),
    [redeemer as `0x${string}`]
  ).slice(2)

  const balanceResp = evmClient.callContract(runtime, {
    call: encodeCallMsg({ from: "0x0", to: runtime.config.tokenAddress, data: balanceCallData }),
    blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
  }).result()

  const balance = BigInt(bytesToHex(balanceResp.data as unknown as Uint8Array))

  runtime.log(`Token balance: ${balance.toString()}, burn amount: ${burnAmount.toString()}`)

  if (balance < burnAmount) {
    runtime.log("Insufficient balance for burn")
    return JSON.stringify({ executed: false, reason: "insufficient_balance", balance: balance.toString() })
  }

  // Step 3: Encode burn intent and report onchain via writeReport
  // Consumer contract (IReceiver.onReport) decodes and executes the burn
  runtime.log("Encoding burn intent and writing report...")
  const burnData = BURN_SELECTOR + encodeAbiParameters(
    parseAbiParameters("uint256"),
    [burnAmount]
  ).slice(2)

  const reportData = encodeAbiParameters(
    parseAbiParameters("address redeemer, address target, bytes callData, uint256 amount, uint256 timestamp"),
    [
      redeemer as `0x${string}`,
      runtime.config.tokenAddress as `0x${string}`,
      burnData as `0x${string}`,
      burnAmount,
      BigInt(Math.floor(runtime.now().getTime() / 1000)),
    ]
  )

  const creReport = runtime.report({
    encodedPayload: reportData,
    encoderName: "EVM",
    signingAlgo: "SECP256K1",
    hashingAlgo: "KECCAK256",
  }).result()

  evmClient.writeReport(runtime, {
    receiver: runtime.config.consumerContract,
    report: creReport,
    gasConfig: { gasLimit: 500000 },
  }).result()

  runtime.log("Stablecoin burn completed and reported")
  return JSON.stringify({
    executed: true,
    redeemer,
    amount: burnAmount.toString(),
    asset: runtime.config.assetId,
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
