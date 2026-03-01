// Template 17: Stablecoin Redemption/Burn
// Trigger: HTTPCapability | Capabilities: compliance-api, callContract (balanceOf), evmWrite (burn)
//
// Pattern: HTTP trigger → compliance check → balanceOf check → burn via evmWrite → report
// Reuses T4's compliance check pattern and T15's viem ABI encoding

import { z } from "zod"
import {
  cre,
  Runner,
  type Runtime,
  getNetwork,
  encodeCallMsg,
  bytesToHex,
  LAST_FINALIZED_BLOCK_NUMBER,
  encodeAbiParameters,
  parseAbiParameters,
} from "@chainlink/cre-sdk"
import { encodeFunctionData, decodeFunctionResult, parseAbi } from "viem"

const configSchema = z.object({
  chainSelectorName: z.string().default("base-sepolia").describe("Target chain"),
  consumerContract: z.string().describe("Consumer contract for onchain reporting"),
  complianceApiUrl: z.string().describe("Compliance API endpoint"),
  tokenAddress: z.string().describe("Stablecoin token contract address"),
  minBurnAmount: z.string().default("1000000000000000000").describe("Minimum burn amount in wei"),
  assetId: z.string().default("USDC").describe("Stablecoin asset identifier"),
})

type Config = z.infer<typeof configSchema>

const erc20Abi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function burn(uint256 amount) returns (bool)",
])

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

  const compliance = JSON.parse(complianceResp.body) as { approved: boolean }
  if (!compliance.approved) {
    runtime.log("Compliance check failed — redemption blocked")
    return JSON.stringify({ executed: false, reason: "compliance_failed" })
  }

  // Step 2: Check token balance
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: runtime.config.chainSelectorName, isTestnet: true })
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  const balanceData = encodeFunctionData({
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [redeemer as `0x${string}`],
  })

  const balanceResp = evmClient.callContract(runtime, {
    call: encodeCallMsg({ from: "0x0", to: runtime.config.tokenAddress, data: balanceData }),
    blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
  }).result()

  const balance = decodeFunctionResult({
    abi: erc20Abi,
    functionName: "balanceOf",
    data: bytesToHex(balanceResp.data as unknown as Uint8Array),
  }) as bigint

  runtime.log(`Token balance: ${balance.toString()}, burn amount: ${burnAmount.toString()}`)

  if (balance < burnAmount) {
    runtime.log("Insufficient balance for burn")
    return JSON.stringify({ executed: false, reason: "insufficient_balance", balance: balance.toString() })
  }

  // Step 3: Execute burn
  runtime.log("Executing token burn...")
  const burnData = encodeFunctionData({
    abi: erc20Abi,
    functionName: "burn",
    args: [burnAmount],
  })

  const burnResult = evmClient.sendTransaction(runtime, {
    to: runtime.config.tokenAddress,
    data: burnData,
  }).result()

  if (!burnResult || !burnResult.success) {
    runtime.log("Burn transaction failed")
    return JSON.stringify({ executed: false, reason: "burn_tx_failed" })
  }

  // Step 4: Report burn onchain
  const reportData = encodeAbiParameters(
    parseAbiParameters("address redeemer, uint256 amount, uint256 timestamp"),
    [redeemer as `0x${string}`, burnAmount, BigInt(Math.floor(runtime.now().getTime() / 1000))]
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
