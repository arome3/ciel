// Template 13: Chainlink Data Feed Reader
// Trigger: CronCapability | Capabilities: EVMClient.callContract, encodeCallMsg, writeReport

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
import { encodeFunctionData, decodeFunctionResult, parseAbi } from "viem"

const configSchema = z.object({
  feedAddress: z.string().describe("Chainlink Data Feed proxy contract address"),
  schedule: z.string().default("0 */5 * * * *").describe("Check frequency"),
  consumerContract: z.string().describe("Consumer contract address for report writing"),
  chainSelectorName: z.string().default("ethereum-testnet-sepolia").describe("Chain selector name"),
})

type Config = z.infer<typeof configSchema>

const feedAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestAnswer() view returns (int256)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
])

const onCronTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
  runtime.log("Reading Chainlink Data Feed...")

  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.chainSelectorName,
    isTestnet: true,
  })
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  // Read decimals
  const decimalsData = encodeFunctionData({
    abi: feedAbi,
    functionName: "decimals",
    args: [],
  })
  const decimalsResp = evmClient.callContract(runtime, {
    call: encodeCallMsg({ from: "0x0", to: runtime.config.feedAddress, data: decimalsData }),
    blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
  }).result()
  const decimals = decodeFunctionResult({
    abi: feedAbi,
    functionName: "decimals",
    data: bytesToHex(decimalsResp.data as unknown as Uint8Array),
  }) as number

  // Read latestAnswer
  const answerData = encodeFunctionData({
    abi: feedAbi,
    functionName: "latestAnswer",
    args: [],
  })
  const answerResp = evmClient.callContract(runtime, {
    call: encodeCallMsg({ from: "0x0", to: runtime.config.feedAddress, data: answerData }),
    blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
  }).result()
  const latestAnswer = decodeFunctionResult({
    abi: feedAbi,
    functionName: "latestAnswer",
    data: bytesToHex(answerResp.data as unknown as Uint8Array),
  }) as bigint

  const price = Number(latestAnswer) / Math.pow(10, decimals)
  runtime.log(`Feed price: ${price} (${decimals} decimals)`)

  // Write report onchain
  const encodedPayload = encodeAbiParameters(
    parseAbiParameters("int256 answer, uint8 decimals, uint256 timestamp"),
    [latestAnswer, decimals, BigInt(Math.floor(runtime.now().getTime() / 1000))]
  )

  const report = runtime.report({
    encodedPayload,
    encoderName: "EVM",
    signingAlgo: "SECP256K1",
    hashingAlgo: "KECCAK256",
  }).result()

  evmClient.writeReport(runtime, {
    receiver: runtime.config.consumerContract,
    report: report.report,
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
