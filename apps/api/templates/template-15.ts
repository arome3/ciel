// Template 15: Cross-Chain CCIP Token Transfer
// Trigger: CronCapability | Capabilities: EVMClient (callContract, sendTransaction), writeReport
//
// Uses Chainlink CCIP to transfer tokens between chains. The workflow:
// 1. Reads fee estimate from CCIP Router
// 2. Approves token spend to Router (if ERC-20)
// 3. Calls ccipSend() on the Router contract
// 4. Reports the transfer onchain
//
// CCIP Router addresses vary by chain — see https://docs.chain.link/ccip/directory

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
  schedule: z.string().default("0 0 * * * *").describe("Transfer check frequency"),
  sourceChainSelector: z.string().default("ethereum-testnet-sepolia").describe("Source chain name"),
  destChainSelector: z.string().default("base-testnet-sepolia").describe("Destination chain name"),
  ccipRouterAddress: z.string().describe("CCIP Router contract address on source chain"),
  tokenAddress: z.string().describe("ERC-20 token address to transfer"),
  transferAmount: z.string().default("1000000000000000000").describe("Amount in wei to transfer"),
  receiverAddress: z.string().describe("Recipient address on destination chain"),
  consumerContract: z.string().describe("Consumer contract for onchain reporting"),
  feeTokenAddress: z.string().default("0x0000000000000000000000000000000000000000").describe("Fee token (zero address = native)"),
  gasLimit: z.number().default(200000).describe("Gas limit for destination execution"),
})

type Config = z.infer<typeof configSchema>

const routerAbi = parseAbi([
  "function getFee(uint64 destinationChainSelector, (bytes receiver, bytes data, (address token, uint256 amount)[] tokenAmounts, address feeToken, bytes extraArgs) message) view returns (uint256)",
])

const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
])

const onCronTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
  runtime.log("Starting CCIP cross-chain transfer workflow...")

  const sourceNetwork = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.sourceChainSelector,
    isTestnet: true,
  })
  const destNetwork = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.destChainSelector,
    isTestnet: true,
  })

  const evmClient = new cre.capabilities.EVMClient(sourceNetwork.chainSelector.selector)
  const transferAmount = BigInt(runtime.config.transferAmount)

  // Step 1: Check sender's token balance (contract's own balance)
  const balanceData = encodeFunctionData({
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [runtime.config.consumerContract as `0x${string}`],
  })

  const balanceResp = evmClient.callContract(runtime, {
    call: encodeCallMsg({
      from: "0x0",
      to: runtime.config.tokenAddress,
      data: balanceData,
    }),
    blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
  }).result()

  const balance = decodeFunctionResult({
    abi: erc20Abi,
    functionName: "balanceOf",
    data: bytesToHex(balanceResp.data as unknown as Uint8Array),
  }) as bigint

  runtime.log(`Token balance: ${balance.toString()}`)

  if (balance < transferAmount) {
    runtime.log("Insufficient token balance for transfer")
    return JSON.stringify({ executed: false, reason: "insufficient_balance", balance: balance.toString() })
  }

  // Step 2: Approve Router to spend tokens
  runtime.log("Approving CCIP Router for token spend...")
  const approveData = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [runtime.config.ccipRouterAddress as `0x${string}`, transferAmount],
  })

  evmClient.sendTransaction(runtime, {
    to: runtime.config.tokenAddress,
    data: approveData,
  }).result()

  // Step 3: Build CCIP message and send
  // Encode receiver as bytes (abi-encoded address for EVM destination)
  const receiverBytes = encodeAbiParameters(
    parseAbiParameters("address"),
    [runtime.config.receiverAddress as `0x${string}`]
  )

  // Build ccipSend calldata
  // ccipSend(uint64 destChainSelector, EVM2AnyMessage message)
  // EVM2AnyMessage: (bytes receiver, bytes data, EVMTokenAmount[] tokenAmounts, address feeToken, bytes extraArgs)
  const ccipMessage = encodeAbiParameters(
    parseAbiParameters("bytes receiver, bytes data, (address token, uint256 amount)[] tokenAmounts, address feeToken, bytes extraArgs"),
    [
      receiverBytes as `0x${string}`,
      "0x" as `0x${string}`,
      [{ token: runtime.config.tokenAddress as `0x${string}`, amount: transferAmount }],
      runtime.config.feeTokenAddress as `0x${string}`,
      "0x" as `0x${string}`,
    ]
  )

  // Send CCIP message
  runtime.log("Sending CCIP transfer...")
  const destSelector = BigInt(destNetwork.chainSelector.selector)

  const ccipRouterAbi = parseAbi([
    "function ccipSend(uint64 destinationChainSelector, (bytes receiver, bytes data, (address token, uint256 amount)[] tokenAmounts, address feeToken, bytes extraArgs) message) payable returns (bytes32)",
  ])

  const ccipSendData = encodeFunctionData({
    abi: ccipRouterAbi,
    functionName: "ccipSend",
    args: [
      destSelector,
      {
        receiver: receiverBytes as `0x${string}`,
        data: "0x" as `0x${string}`,
        tokenAmounts: [{ token: runtime.config.tokenAddress as `0x${string}`, amount: transferAmount }],
        feeToken: runtime.config.feeTokenAddress as `0x${string}`,
        extraArgs: "0x" as `0x${string}`,
      },
    ],
  })

  const txResult = evmClient.sendTransaction(runtime, {
    to: runtime.config.ccipRouterAddress,
    data: ccipSendData,
    value: runtime.config.feeTokenAddress === "0x0000000000000000000000000000000000000000" ? "100000000000000" : "0",
  }).result()

  if (!txResult || !txResult.success) {
    runtime.log("CCIP transfer transaction failed")
    return JSON.stringify({ executed: false, reason: "ccip_tx_failed" })
  }

  // Step 4: Report transfer onchain
  const reportData = encodeAbiParameters(
    parseAbiParameters("uint256 amount, uint64 destChain, uint256 timestamp"),
    [
      transferAmount,
      destSelector,
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

  runtime.log("CCIP transfer completed and reported")
  return JSON.stringify({
    executed: true,
    amount: runtime.config.transferAmount,
    source: runtime.config.sourceChainSelector,
    destination: runtime.config.destChainSelector,
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
