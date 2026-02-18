// Example: Cross-Chain Balance Reader
// Pattern: EVM Log Trigger + EVMClient + getNetwork

import { z } from "zod"
import {
  Runner,
  Runtime,
  EVMLogCapability,
  EVMClient,
  handler,
  getNetwork,
  consensusIdenticalAggregation,
} from "@chainlink/cre-sdk"
import { encodeFunctionData, parseAbi, decodeFunctionResult } from "viem"

const configSchema = z.object({
  sourceContract: z.string().describe("Contract emitting events"),
  targetContract: z.string().describe("Contract to read balance from"),
  sourceChain: z.string().default("base-sepolia").describe("Source chain"),
  targetChain: z.string().default("ethereum-sepolia").describe("Target chain"),
  consumerContract: z.string().describe("Consumer contract address"),
})

type Config = z.infer<typeof configSchema>

const runner = Runner.newRunner<Config>({ configSchema })

function initWorkflow(runtime: Runtime<Config>) {
  const logTrigger = new EVMLogCapability().trigger({
    contractAddress: runtime.config.sourceContract,
    eventSignature: "Transfer(address,address,uint256)",
    chainSelector: getNetwork(runtime.config.sourceChain),
  })

  const evmClient = new EVMClient()

  handler(logTrigger, (rt) => {
    const abi = parseAbi(["function totalSupply() view returns (uint256)"])

    const result = evmClient.callContract({
      contractAddress: rt.config.targetContract,
      chainSelector: getNetwork(rt.config.targetChain),
      callData: encodeFunctionData({ abi, functionName: "totalSupply" }),
    }).result()

    const totalSupply = decodeFunctionResult({ abi, functionName: "totalSupply", data: result })

    return { totalSupply: totalSupply.toString(), chain: rt.config.targetChain }
  })

  consensusIdenticalAggregation({
    fields: ["totalSupply", "chain"],
    reportId: "cross_chain_balance",
  })
}

export function main() {
  runner.run(initWorkflow)
}
