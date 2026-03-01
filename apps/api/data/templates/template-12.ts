// Template 12: Wallet Activity Monitor
// Trigger: EVMLogCapability (ERC-20 Transfer event) | Capabilities: HTTPClient (alert), EVMClient (report)
//
// LIMITATION: This template monitors ERC-20 Transfer events ONLY.
// Native ETH transfers (direct value sends) do not emit Transfer events
// and require separate monitoring (e.g., tracing internal transactions).
// For WETH, this template works because WETH is an ERC-20 token.
//
// Monitors ERC-20 Transfer events on a token contract. Decodes from/to addresses
// and transfer value from event log topics + data. Filters by watched addresses
// and minimum amount threshold. Responds via webhook alert and/or onchain report.

import {
  cre,
  Runner,
  getNetwork,
  encodeAbiParameters,
  parseAbiParameters,
  hexToBase64,
  type Runtime,
  type EVMLog,
} from "@chainlink/cre-sdk"
import { z } from "zod"

const configSchema = z.object({
  chainSelectorName: z.string().default("base-sepolia").describe("Chain to monitor for Transfer events"),
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

// ─── Handler ──────────────────────────────────────────────────────────────

const onEvmLogTrigger = (runtime: Runtime<Config>, log: EVMLog): string => {
  const httpClient = new cre.capabilities.HTTPClient()

  runtime.log("ERC-20 Transfer event detected, processing")

  // Validate log data
  if (!log || !("topics" in log) || !("data" in log)) {
    return JSON.stringify({ matched: false, reason: "no_log_data" })
  }
  const topics = (log as { topics: string[] }).topics
  const data = (log as { data: string }).data

  // Decode Transfer event fields
  // topics[0] = event signature hash (Transfer)
  // topics[1] = from address (32-byte padded, take last 20 bytes)
  // topics[2] = to address (32-byte padded, take last 20 bytes)
  // data = uint256 value (not indexed)
  if (topics.length < 3) {
    return JSON.stringify({ matched: false, reason: "invalid_log_topics" })
  }

  // Validate this is actually a Transfer event (topics[0] = event signature hash)
  if (topics[0] !== TRANSFER_TOPIC) {
    return JSON.stringify({ matched: false, reason: "not_transfer_event" })
  }

  const fromAddress = ("0x" + topics[1].slice(26)).toLowerCase()
  const toAddress = ("0x" + topics[2].slice(26)).toLowerCase()
  const transferValue = BigInt(data)

  runtime.log("Transfer: " + fromAddress + " -> " + toAddress + " value: " + transferValue.toString())

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
    return JSON.stringify({ matched: false, reason: "address_not_watched" })
  }

  // Amount threshold filter
  if (transferValue < minAmount) {
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
      const enrichResp = httpClient
        .sendRequest(runtime, {
          url: runtime.config.enrichmentApiUrl,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(runtime.config.enrichmentApiKey ? { "Authorization": `Bearer ${runtime.config.enrichmentApiKey}` } : {}),
          },
          body: JSON.stringify({ address: counterparty }),
        })
        .result()
      const enrichData = JSON.parse(enrichResp.body) as { label?: string }
      counterpartyLabel = enrichData.label || ""
    } catch {
      // Enrichment failure is non-fatal
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
    runtime.log("Sending alert webhook notification")

    httpClient
      .sendRequest(runtime, {
        url: runtime.config.alertWebhookUrl,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: alertPayload,
      })
      .result()
  }

  // Response: onchain report
  if (action === "report" || action === "both") {
    const network = getNetwork({
      chainFamily: "evm",
      chainSelectorName: runtime.config.chainSelectorName,
      isTestnet: true,
    })
    const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

    const reportData = encodeAbiParameters(
      parseAbiParameters("address from, address to, uint256 value, uint256 timestamp"),
      [
        fromAddress as `0x${string}`,
        toAddress as `0x${string}`,
        transferValue,
        BigInt(Math.floor(runtime.now().getTime() / 1000)),
      ]
    )

    runtime.log("Writing activity report onchain")

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
  }

  // Response: reactive DEX swap (counter-trade)
  if (action === "swap" || (action === "both" && runtime.config.swapRouterAddress)) {
    const network = getNetwork({
      chainFamily: "evm",
      chainSelectorName: runtime.config.chainSelectorName,
      isTestnet: true,
    })
    const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

    // Compute slippage-protected amountOutMinimum
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

    runtime.log("Executing reactive swap")

    evmClient.sendTransaction(runtime, {
      to: runtime.config.swapRouterAddress,
      data: swapCalldata,
      value: runtime.config.tokenIn === "0x0000000000000000000000000000000000000000" ? runtime.config.swapAmountWei : "0",
    })
  }

  return JSON.stringify({
    matched: true,
    from: fromAddress,
    to: toAddress,
    value: transferValue.toString(),
    isExchange,
  })
}

// ─── Workflow Initialization ──────────────────────────────────────────────

const initWorkflow = (config: Config) => {
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: config.chainSelectorName,
    isTestnet: true,
  })
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  const logTrigger = evmClient.logTrigger({
    contractAddress: hexToBase64(config.tokenContractAddress),
    eventSignature: config.transferEventSignature,
  })

  return [cre.handler(logTrigger, onEvmLogTrigger)]
}

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema })
  await runner.run(initWorkflow)
}

main()
