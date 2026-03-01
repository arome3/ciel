// Template 19: Escrow Lock/Release
// Trigger: HTTPCapability | Capabilities: settlement-api, evmWrite (lock/release)
//
// Pattern: HTTP trigger → check escrow conditions → if met: release, else: lock → report
// Dual-path logic similar to T11's conditional DEX swap

import { z } from "zod"
import {
  cre,
  Runner,
  type Runtime,
  getNetwork,
  encodeAbiParameters,
  parseAbiParameters,
} from "@chainlink/cre-sdk"
import { encodeFunctionData, parseAbi } from "viem"

const configSchema = z.object({
  chainSelectorName: z.string().default("base-sepolia").describe("Target chain"),
  consumerContract: z.string().describe("Consumer contract for onchain reporting"),
  escrowContractAddress: z.string().describe("Escrow smart contract address"),
  settlementApiUrl: z.string().describe("Settlement API endpoint"),
  threshold: z.string().default("100000000000000000000").describe("Escrow threshold in wei"),
})

type Config = z.infer<typeof configSchema>

const escrowAbi = parseAbi([
  "function lock(address depositor, uint256 amount) returns (bool)",
  "function release(address beneficiary, uint256 amount) returns (bool)",
  "function getLockedAmount(address depositor) view returns (uint256)",
])

const onHttpTrigger = (runtime: Runtime<Config>, payload: Record<string, unknown>): string => {
  runtime.log("Starting escrow lock/release workflow...")

  const httpClient = new cre.capabilities.HTTPClient()
  const depositor = (payload as { depositor?: string }).depositor ?? runtime.config.consumerContract
  const amount = BigInt((payload as { amount?: string }).amount ?? runtime.config.threshold)
  const action = (payload as { action?: string }).action ?? "evaluate"

  // Step 1: Check settlement conditions
  runtime.log("Checking settlement conditions...")
  const settlementResp = httpClient.sendRequest(runtime, {
    url: `${runtime.config.settlementApiUrl}/conditions?depositor=${depositor}`,
    method: "GET",
    headers: { "Content-Type": "application/json" },
  }).result()

  const conditions = JSON.parse(settlementResp.body) as {
    deliveryConfirmed: boolean
    paymentReceived: boolean
    complianceCleared: boolean
  }

  const network = getNetwork({ chainFamily: "evm", chainSelectorName: runtime.config.chainSelectorName, isTestnet: true })
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  const allConditionsMet = conditions.deliveryConfirmed && conditions.paymentReceived && conditions.complianceCleared

  let executed = false
  let executedAction = "none"

  if (allConditionsMet || action === "release") {
    // Release path: all conditions met
    runtime.log("All conditions met — releasing escrow...")
    const releaseData = encodeFunctionData({
      abi: escrowAbi,
      functionName: "release",
      args: [depositor as `0x${string}`, amount],
    })

    const releaseResult = evmClient.sendTransaction(runtime, {
      to: runtime.config.escrowContractAddress,
      data: releaseData,
    }).result()

    executed = releaseResult?.success ?? false
    executedAction = "release"
  } else if (action === "lock" || !allConditionsMet) {
    // Lock path: conditions not met, lock funds
    runtime.log("Conditions not met — locking escrow...")
    const lockData = encodeFunctionData({
      abi: escrowAbi,
      functionName: "lock",
      args: [depositor as `0x${string}`, amount],
    })

    const lockResult = evmClient.sendTransaction(runtime, {
      to: runtime.config.escrowContractAddress,
      data: lockData,
    }).result()

    executed = lockResult?.success ?? false
    executedAction = "lock"
  }

  // Step 3: Report onchain
  const reportData = encodeAbiParameters(
    parseAbiParameters("address depositor, uint256 amount, bool released, uint256 timestamp"),
    [
      depositor as `0x${string}`,
      amount,
      executedAction === "release",
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

  runtime.log(`Escrow ${executedAction} completed`)
  return JSON.stringify({
    executed,
    action: executedAction,
    depositor,
    amount: amount.toString(),
    conditions,
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
