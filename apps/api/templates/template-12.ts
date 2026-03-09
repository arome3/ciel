// Template 12: Wallet Activity Monitor
// Trigger: EVMLog (ERC-20 Transfer event) | Capabilities: HTTPClient (alert), EVMClient (report)
//
// LIMITATION: This template monitors ERC-20 Transfer events ONLY.
// Native ETH transfers (direct value sends) do not emit Transfer events
// and require separate monitoring (e.g., tracing internal transactions).
// For WETH, this template works because WETH is an ERC-20 token.
//
// Monitors ERC-20 Transfer events on a token contract. Decodes from/to addresses
// and transfer value from event log topics + data. Filters by watched addresses
// and minimum amount threshold. Responds via webhook alert and/or onchain report.
//
// The CRE SDK handler receives (runtime, log: EVMLog) with Uint8Array
// topics/data and uses bytesToHex()/hexToBase64() for encoding.

import { z } from "zod"
import { encodeAbiParameters, parseAbiParameters } from "viem"
import {
  cre,
  Runner,
  type Runtime,
  type EVMLog,
  getNetwork,
  hexToBase64,
  bytesToHex,
  decodeJson,
} from "@chainlink/cre-sdk"

const configSchema = z.object({
  chainSelectorName: z.string().default("ethereum-testnet-sepolia-base-1").describe("Chain to monitor for Transfer events"),
  tokenContractAddress: z.string().describe("ERC-20 token contract address to watch"),
  transferEventSignature: z.string().default("Transfer(address,address,uint256)").describe("Transfer event signature"),
  watchAddresses: z.string().describe("Comma-separated list of addresses to watch (lowercase)"),
  minTransferAmountWei: z.string().default("100000000000000000000").describe("Minimum transfer amount in wei (100 tokens default)"),
  filterDirection: z.enum(["incoming", "outgoing", "both"]).default("both").describe("Filter direction: incoming, outgoing, or both"),
  knownExchangeAddresses: z.string().default("").describe("Comma-separated known exchange addresses for labeling"),
  responseAction: z.enum(["alert", "report", "swap", "both"]).default("alert").describe("Response action: alert webhook, onchain report, reactive swap, or both"),
  swapRouterAddress: z.string().default("").describe("Uniswap V3 router for reactive swap"),
  tokenIn: z.string().default("").describe("Token to swap from (e.g., WETH)"),
  tokenOut: z.string().default("").describe("Token to swap to"),
  poolFee: z.number().default(3000).describe("Pool fee tier (3000 = 0.3%)"),
  slippageBps: z.number().default(50).describe("Slippage tolerance in basis points"),
  swapAmountWei: z.string().default("100000000000000000").describe("Swap amount in wei"),
  alertWebhookUrl: z.string().default("").describe("Webhook URL for alert notifications"),
  consumerContract: z.string().describe("Consumer contract for onchain reporting"),
  enrichmentApiUrl: z.string().default("").describe("Optional API for address enrichment/labeling"),
  enrichmentApiKey: z.string().default("").describe("API key for enrichment service"),
})

type Config = z.infer<typeof configSchema>

// ERC-20 Transfer event topic hash: keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

const onEvmLogTrigger = (runtime: Runtime<Config>, log: EVMLog): string => {
  runtime.log("ERC-20 Transfer event detected, processing...")
  const httpClient = new cre.capabilities.HTTPClient()
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: runtime.config.chainSelectorName, isTestnet: true })
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  // Validate log structure
  if (!log || !log.topics || log.topics.length < 3) {
    runtime.log("Invalid log structure or insufficient topics")
    return JSON.stringify({ matched: false, reason: "invalid_log_topics" })
  }

  // Decode Transfer event fields from Uint8Array topics
  // topics[0] = event signature hash (Transfer)
  // topics[1] = from address (32-byte padded, take last 20 bytes via slice(12))
  // topics[2] = to address (32-byte padded, take last 20 bytes via slice(12))
  // data = uint256 value (not indexed)
  const eventTopic = bytesToHex(log.topics[0])
  if (eventTopic !== TRANSFER_TOPIC) {
    runtime.log("Not a Transfer event, skipping")
    return JSON.stringify({ matched: false, reason: "not_transfer_event" })
  }

  const fromAddress = ("0x" + bytesToHex(log.topics[1].slice(12))).toLowerCase()
  const toAddress = ("0x" + bytesToHex(log.topics[2].slice(12))).toLowerCase()
  const transferValue = BigInt("0x" + bytesToHex(log.data))

  runtime.log(`Transfer: ${fromAddress} -> ${toAddress}, value: ${transferValue.toString()}`)

  // Parse watch list and minimum threshold
  const watchSet = new Set(
    runtime.config.watchAddresses.split(",").map((a: string) => a.trim().toLowerCase()).filter(Boolean)
  )
  const minAmount = BigInt(runtime.config.minTransferAmountWei)

  // Direction filter
  const direction = runtime.config.filterDirection
  const isFromWatched = watchSet.has(fromAddress)
  const isToWatched = watchSet.has(toAddress)

  let matched = false
  if (direction === "incoming") matched = isToWatched
  else if (direction === "outgoing") matched = isFromWatched
  else matched = isFromWatched || isToWatched

  if (!matched) {
    runtime.log("Address not in watch list")
    return JSON.stringify({ matched: false, reason: "address_not_watched" })
  }

  // Amount threshold filter
  if (transferValue < minAmount) {
    runtime.log("Transfer below minimum threshold")
    return JSON.stringify({ matched: false, reason: "below_threshold", value: transferValue.toString() })
  }

  // Check if counterparty is a known exchange
  const exchangeSet = new Set(
    runtime.config.knownExchangeAddresses.split(",").map((a: string) => a.trim().toLowerCase()).filter(Boolean)
  )
  const counterparty = isFromWatched ? toAddress : fromAddress
  const isExchange = exchangeSet.has(counterparty)

  // Optional address enrichment (label lookup)
  let counterpartyLabel = ""
  if (runtime.config.enrichmentApiUrl) {
    try {
      const enrichResp = httpClient.sendRequest(runtime, {
        url: runtime.config.enrichmentApiUrl,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(runtime.config.enrichmentApiKey ? { "Authorization": `Bearer ${runtime.config.enrichmentApiKey}` } : {}),
        },
        body: JSON.stringify({ address: counterparty }),
      }).result()
      const enrichData = decodeJson(enrichResp.body) as { label?: string }
      counterpartyLabel = enrichData.label || ""
    } catch {
      // Enrichment failure is non-fatal
      runtime.log("Address enrichment failed, continuing without label")
    }
  }

  // Build alert payload
  const alertPayload = JSON.stringify({
    type: "wallet_activity",
    from: fromAddress,
    to: toAddress,
    value: transferValue.toString(),
    chain: runtime.config.chainSelectorName,
    isExchangeTransfer: isExchange,
    counterpartyLabel,
    direction: isFromWatched ? "outgoing" : "incoming",
    timestamp: Math.floor(runtime.now().getTime() / 1000),
  })

  // Response: alert via webhook
  const action = runtime.config.responseAction
  if ((action === "alert" || action === "both") && runtime.config.alertWebhookUrl) {
    runtime.log("Sending webhook alert...")
    httpClient.sendRequest(runtime, {
      url: runtime.config.alertWebhookUrl,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: alertPayload,
    }).result()
  }

  // Response: onchain report
  if (action === "report" || action === "both") {
    runtime.log("Writing onchain report...")
    const reportData = encodeAbiParameters(
      parseAbiParameters("address from, address to, uint256 value, uint256 timestamp"),
      [
        fromAddress as `0x${string}`,
        toAddress as `0x${string}`,
        transferValue,
        BigInt(Math.floor(runtime.now().getTime() / 1000)),
      ]
    )

    const report = runtime.report({
      encodedPayload: reportData,
      encoderName: "evm",
      signingAlgo: "evm",
      hashingAlgo: "keccak256",
    }).result()

    evmClient.writeReport(runtime, {
      receiver: runtime.config.consumerContract,
      report,
      gasConfig: { gasLimit: 500000 },
    }).result()
  }

  // Response: reactive DEX swap (counter-trade)
  if (action === "swap" || (action === "both" && runtime.config.swapRouterAddress)) {
    runtime.log("Executing reactive swap...")
    // Compute slippage-protected amountOutMinimum
    // Input-percentage approach (no price oracle in EVM-log-triggered swaps)
    const swapAmountIn = BigInt(runtime.config.swapAmountWei)
    const slippageMultiplier = BigInt(10000 - runtime.config.slippageBps)
    const amountOutMinimum = (swapAmountIn * slippageMultiplier) / BigInt(10000)

    const swapCalldata = encodeAbiParameters(
      parseAbiParameters("address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96"),
      [
        runtime.config.tokenIn as `0x${string}`,
        runtime.config.tokenOut as `0x${string}`,
        runtime.config.poolFee,
        runtime.config.consumerContract as `0x${string}`,
        swapAmountIn,
        amountOutMinimum,
        BigInt(0),
      ]
    )

    // Encode swap intent into report payload → writeReport to consumer
    const swapValue = runtime.config.tokenIn === "0x0000000000000000000000000000000000000000"
      ? BigInt(runtime.config.swapAmountWei)
      : BigInt(0)
    const swapReportData = encodeAbiParameters(
      parseAbiParameters("address target, bytes callData, uint256 value, uint256 timestamp"),
      [
        runtime.config.swapRouterAddress as `0x${string}`,
        swapCalldata as `0x${string}`,
        swapValue,
        BigInt(Math.floor(runtime.now().getTime() / 1000)),
      ]
    )
    const swapReport = runtime.report({
      encodedPayload: swapReportData,
      encoderName: "EVM",
      signingAlgo: "SECP256K1",
      hashingAlgo: "KECCAK256",
    }).result()
    evmClient.writeReport(runtime, {
      receiver: runtime.config.consumerContract,
      report: swapReport.report,
      gasConfig: { gasLimit: 500000 },
    }).result()
  }

  runtime.log("Wallet activity processed successfully")
  return JSON.stringify({
    matched: true,
    from: fromAddress,
    to: toAddress,
    value: transferValue.toString(),
    isExchange,
  })
}

const initWorkflow = (config: Config) => {
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: config.chainSelectorName, isTestnet: true })
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)
  const logTrigger = evmClient.logTrigger({
    addresses: [hexToBase64(config.tokenContractAddress)],
    topics: [TRANSFER_TOPIC],
  })
  return [cre.handler(logTrigger, onEvmLogTrigger)]
}

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema })
  await runner.run(initWorkflow)
}
main()
