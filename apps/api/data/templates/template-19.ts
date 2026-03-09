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

// Function selectors (keccak256 of signature, first 4 bytes)
const LOCK_SELECTOR = "0x282d3fdf"    // lock(address,uint256)
const RELEASE_SELECTOR = "0x0357371d" // release(address,uint256)

const configSchema = z.object({
  chainSelectorName: z.string().default("ethereum-testnet-sepolia-base-1").describe("Target chain"),
  consumerContract: z.string().describe("Consumer contract for onchain reporting"),
  escrowContractAddress: z.string().describe("Escrow smart contract address"),
  settlementApiUrl: z.string().describe("Settlement API endpoint"),
  threshold: z.string().default("100000000000000000000").describe("Escrow threshold in wei"),
})

type Config = z.infer<typeof configSchema>


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

  let executedAction = "none"
  let actionCallData: `0x${string}`

  if (allConditionsMet || action === "release") {
    // Release path: all conditions met
    runtime.log("All conditions met — releasing escrow...")
    actionCallData = (RELEASE_SELECTOR + encodeAbiParameters(
      parseAbiParameters("address, uint256"),
      [depositor as `0x${string}`, amount]
    ).slice(2)) as `0x${string}`
    executedAction = "release"
  } else {
    // Lock path: conditions not met, lock funds
    runtime.log("Conditions not met — locking escrow...")
    actionCallData = (LOCK_SELECTOR + encodeAbiParameters(
      parseAbiParameters("address, uint256"),
      [depositor as `0x${string}`, amount]
    ).slice(2)) as `0x${string}`
    executedAction = "lock"
  }

  // Step 3: Encode escrow action in report payload → writeReport to consumer
  const reportData = encodeAbiParameters(
    parseAbiParameters("address depositor, address target, bytes callData, uint256 amount, bool released, uint256 timestamp"),
    [
      depositor as `0x${string}`,
      runtime.config.escrowContractAddress as `0x${string}`,
      actionCallData,
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
    executed: true,
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
