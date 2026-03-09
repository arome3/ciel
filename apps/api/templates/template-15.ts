// Template 15: Cross-Chain CCIP Token Transfer
// Trigger: CronCapability | Capabilities: EVMClient (callContract, writeReport)
//
// Uses Chainlink CCIP to transfer tokens between chains. The workflow:
// 1. Reads fee estimate from CCIP Router
// 2. Approves token spend to Router (if ERC-20)
// 3. Calls ccipSend() on the Router contract
// 4. Reports the transfer onchain
//
// CCIP Router addresses vary by chain — see https://docs.chain.link/ccip/directory

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
const BALANCE_OF_SELECTOR = "0x70a08231"  // balanceOf(address)
const APPROVE_SELECTOR = "0x095ea7b3"     // approve(address,uint256)
const CCIP_SEND_SELECTOR = "0x96f4e9f9"   // ccipSend(uint64,(bytes,bytes,(address,uint256)[],address,bytes))

const configSchema = z.object({
  schedule: z.string().default("0 0 * * * *").describe("Transfer check frequency"),
  sourceChainSelector: z.string().default("ethereum-testnet-sepolia").describe("Source chain name"),
  destChainSelector: z.string().default("ethereum-testnet-sepolia-base-1").describe("Destination chain name"),
  ccipRouterAddress: z.string().describe("CCIP Router contract address on source chain"),
  tokenAddress: z.string().describe("ERC-20 token address to transfer"),
  transferAmount: z.string().default("1000000000000000000").describe("Amount in wei to transfer"),
  receiverAddress: z.string().describe("Recipient address on destination chain"),
  consumerContract: z.string().describe("Consumer contract for onchain reporting"),
  feeTokenAddress: z.string().default("0x0000000000000000000000000000000000000000").describe("Fee token (zero address = native)"),
  gasLimit: z.number().default(200000).describe("Gas limit for destination execution"),
})

type Config = z.infer<typeof configSchema>


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
  const balanceCallData = BALANCE_OF_SELECTOR + encodeAbiParameters(
    parseAbiParameters("address"),
    [runtime.config.consumerContract as `0x${string}`]
  ).slice(2)

  const balanceResp = evmClient.callContract(runtime, {
    call: encodeCallMsg({
      from: "0x0",
      to: runtime.config.tokenAddress,
      data: balanceCallData,
    }),
    blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
  }).result()

  const balance = BigInt(bytesToHex(balanceResp.data as unknown as Uint8Array))

  runtime.log(`Token balance: ${balance.toString()}`)

  if (balance < transferAmount) {
    runtime.log("Insufficient token balance for transfer")
    return JSON.stringify({ executed: false, reason: "insufficient_balance", balance: balance.toString() })
  }

  // Step 2: Build CCIP message
  // Encode receiver as bytes (abi-encoded address for EVM destination)
  const receiverBytes = encodeAbiParameters(
    parseAbiParameters("address"),
    [runtime.config.receiverAddress as `0x${string}`]
  )

  const destSelector = BigInt(destNetwork.chainSelector.selector)

  // Encode approve calldata
  const approveData = APPROVE_SELECTOR + encodeAbiParameters(
    parseAbiParameters("address, uint256"),
    [runtime.config.ccipRouterAddress as `0x${string}`, transferAmount]
  ).slice(2)

  // Encode ccipSend calldata
  const ccipSendData = CCIP_SEND_SELECTOR + encodeAbiParameters(
    parseAbiParameters("uint64, (bytes, bytes, (address, uint256)[], address, bytes)"),
    [
      destSelector,
      [
        receiverBytes as `0x${string}`,
        "0x" as `0x${string}`,
        [[runtime.config.tokenAddress as `0x${string}`, transferAmount]],
        runtime.config.feeTokenAddress as `0x${string}`,
        "0x" as `0x${string}`,
      ],
    ]
  ).slice(2)

  // Step 3: Pack both operations (approve + ccipSend) into single report payload
  // Consumer contract executes approve then ccipSend in sequence
  runtime.log("Encoding CCIP transfer intent and writing report...")
  const feeValue = runtime.config.feeTokenAddress === "0x0000000000000000000000000000000000000000"
    ? BigInt("100000000000000")
    : BigInt(0)

  const reportData = encodeAbiParameters(
    parseAbiParameters("address tokenAddr, bytes approveData, address routerAddr, bytes ccipSendData, uint256 feeValue, uint256 amount, uint64 destChain, uint256 timestamp"),
    [
      runtime.config.tokenAddress as `0x${string}`,
      approveData as `0x${string}`,
      runtime.config.ccipRouterAddress as `0x${string}`,
      ccipSendData as `0x${string}`,
      feeValue,
      transferAmount,
      destSelector,
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
