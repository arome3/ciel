// Template 13: Chainlink Data Feed Reader
// Trigger: CronCapability | Capabilities: EVMClient.callContract, encodeCallMsg, writeReport

import { z } from "zod"
import { encodeAbiParameters, parseAbiParameters } from "viem"
import {
  cre,
  Runner,
  type Runtime,
  type CronPayload,
  getNetwork,
  encodeCallMsg,
  bytesToHex,
  LAST_FINALIZED_BLOCK_NUMBER,
} from "@chainlink/cre-sdk"

// Function selectors (keccak256 of signature, first 4 bytes)
const DECIMALS_SELECTOR = "0x313ce567"      // decimals()
const LATEST_ANSWER_SELECTOR = "0x50d25bcd" // latestAnswer()

const configSchema = z.object({
  feedAddress: z.string().describe("Chainlink Data Feed proxy contract address"),
  schedule: z.string().default("0 */5 * * * *").describe("Check frequency"),
  consumerContract: z.string().describe("Consumer contract address for report writing"),
  chainSelectorName: z.string().default("ethereum-testnet-sepolia").describe("Chain selector name"),
})

type Config = z.infer<typeof configSchema>

const onCronTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
  runtime.log("Reading Chainlink Data Feed...")

  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.chainSelectorName,
    isTestnet: true,
  })
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  // Read decimals
  const decimalsResp = evmClient.callContract(runtime, {
    call: encodeCallMsg({ from: "0x0", to: runtime.config.feedAddress, data: DECIMALS_SELECTOR }),
    blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
  }).result()
  const rawDecimalsHex = bytesToHex(decimalsResp.data as unknown as Uint8Array)
  const decimals = Number(BigInt(rawDecimalsHex))

  // Read latestAnswer
  const answerResp = evmClient.callContract(runtime, {
    call: encodeCallMsg({ from: "0x0", to: runtime.config.feedAddress, data: LATEST_ANSWER_SELECTOR }),
    blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
  }).result()
  const latestAnswer = BigInt(bytesToHex(answerResp.data as unknown as Uint8Array))

  const price = Number(latestAnswer) / Math.pow(10, decimals)
  runtime.log(`Feed price: ${price} (${decimals} decimals)`)

  // Write report onchain
  const encodedPayload = encodeAbiParameters(
    parseAbiParameters("int256 answer, uint8 decimals, uint256 timestamp"),
    [latestAnswer, decimals, BigInt(Math.floor(runtime.now().getTime() / 1000))]
  )

  const creReport = runtime.report({
    encodedPayload,
    encoderName: "EVM",
    signingAlgo: "SECP256K1",
    hashingAlgo: "KECCAK256",
  }).result()

  evmClient.writeReport(runtime, {
    receiver: runtime.config.consumerContract,
    report: creReport,
    gasConfig: { gasLimit: 500000 },
  }).result()

  runtime.log("Report written successfully")
  return JSON.stringify({ price, decimals, answer: latestAnswer.toString() })
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
