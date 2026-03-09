// Example: Cross-Chain Balance Reader (Official SDK Pattern)
// Pattern: EVMClient.logTrigger + callContract + getNetwork + bytesToHex

import { z } from "zod"
import {
  cre,
  Runner,
  type Runtime,
  type EVMLog,
  getNetwork,
  bytesToHex,
  hexToBase64,
  encodeCallMsg,
  LAST_FINALIZED_BLOCK_NUMBER,
} from "@chainlink/cre-sdk"
import { encodeFunctionData, parseAbi, decodeFunctionResult } from "viem"

const configSchema = z.object({
  sourceContract: z.string().describe("Contract emitting events"),
  targetContract: z.string().describe("Contract to read balance from"),
  sourceChainSelector: z.string().default("ethereum-testnet-sepolia").describe("Source chain"),
  targetChainSelector: z.string().default("ethereum-testnet-sepolia-base-1").describe("Target chain"),
  consumerContract: z.string().describe("Consumer contract address"),
  transferEventSig: z.string().default("0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"),
})

type Config = z.infer<typeof configSchema>

const onTransferEvent = (runtime: Runtime<Config>, log: EVMLog): string => {
  runtime.log("Transfer event detected, reading cross-chain balance...")

  // Decode transfer event
  const fromAddress = bytesToHex(log.topics[1].slice(12))
  runtime.log(`Transfer from: ${fromAddress}`)

  // Read balance on target chain
  const targetNetwork = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.targetChainSelector,
    isTestnet: true,
  })
  const targetEvmClient = new cre.capabilities.EVMClient(targetNetwork.chainSelector.selector)

  const abi = parseAbi(["function totalSupply() view returns (uint256)"])
  const callData = encodeFunctionData({ abi, functionName: "totalSupply" })

  const result = targetEvmClient.callContract(runtime, {
    call: encodeCallMsg({ from: "0x0", to: runtime.config.targetContract, data: callData }),
    blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
  }).result()

  const totalSupply = decodeFunctionResult({
    abi,
    functionName: "totalSupply",
    data: bytesToHex(result.data as unknown as Uint8Array),
  })

  return JSON.stringify({
    totalSupply: String(totalSupply),
    chain: runtime.config.targetChainSelector,
    triggeredBy: fromAddress,
  })
}

const initWorkflow = (config: Config) => {
  const sourceNetwork = getNetwork({
    chainFamily: "evm",
    chainSelectorName: config.sourceChainSelector,
    isTestnet: true,
  })
  const sourceEvmClient = new cre.capabilities.EVMClient(sourceNetwork.chainSelector.selector)

  const logTrigger = sourceEvmClient.logTrigger({
    addresses: [hexToBase64(config.sourceContract)],
    topics: [hexToBase64(config.transferEventSig)],
  })

  return [cre.handler(logTrigger, onTransferEvent)]
}

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema })
  await runner.run(initWorkflow)
}
main()
