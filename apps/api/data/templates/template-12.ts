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
//
// NOTE: The real CRE SDK handler receives (runtime, log: EVMLog) with Uint8Array
// topics/data and uses bytesToHex()/hexToBase64(). This template follows the
// codebase stub convention for validator compatibility.

import { z } from "zod"
import {
  Runner,
  Runtime,
  EVMLogCapability,
  HTTPClient,
  EVMClient,
  handler,
  getNetwork,
  consensusIdenticalAggregation,
} from "@chainlink/cre-sdk"
import { encodeAbiParameters, parseAbiParameters } from "viem"

const configSchema = z.object({
  chainName: z.string().default("base-sepolia").describe("Chain to monitor for Transfer events"),
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

const runner = Runner.newRunner<Config>({ configSchema })

// ERC-20 Transfer event topic hash: keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

function initWorkflow(runtime: Runtime<Config>) {
  const logTrigger = new EVMLogCapability().trigger({
    contractAddress: runtime.config.tokenContractAddress,
    eventSignature: runtime.config.transferEventSignature,
    chainSelector: getNetwork(runtime.config.chainName),
  })

  const httpClient = new HTTPClient()
  const evmClient = new EVMClient()

  handler(logTrigger, (rt, triggerOutput) => {
    // triggerOutput is the EVMLog from the Transfer event
    const log = triggerOutput
    if (!log || !("topics" in log) || !("data" in log)) {
      return { matched: false, reason: "no_log_data" }
    }
    const topics = (log as { topics: string[] }).topics
    const data = (log as { data: string }).data

    // Decode Transfer event fields
    // topics[0] = event signature hash (Transfer)
    // topics[1] = from address (32-byte padded, take last 20 bytes)
    // topics[2] = to address (32-byte padded, take last 20 bytes)
    // data = uint256 value (not indexed)
    if (topics.length < 3) {
      return { matched: false, reason: "invalid_log_topics" }
    }

    // Validate this is actually a Transfer event (topics[0] = event signature hash)
    if (topics[0] !== TRANSFER_TOPIC) {
      return { matched: false, reason: "not_transfer_event" }
    }

    const fromAddress = ("0x" + topics[1].slice(26)).toLowerCase()
    const toAddress = ("0x" + topics[2].slice(26)).toLowerCase()
    const transferValue = BigInt(data)

    // Parse watch list and minimum threshold
    const watchSet = new Set(
      rt.config.watchAddresses.split(",").map((a: string) => a.trim().toLowerCase()).filter(Boolean)
    )
    const minAmount = BigInt(rt.config.minTransferAmountWei)

    // Direction filter
    const direction = rt.config.filterDirection
    const isFromWatched = watchSet.has(fromAddress)
    const isToWatched = watchSet.has(toAddress)

    let matched = false
    if (direction === "incoming") matched = isToWatched
    else if (direction === "outgoing") matched = isFromWatched
    else matched = isFromWatched || isToWatched

    if (!matched) {
      return { matched: false, reason: "address_not_watched" }
    }

    // Amount threshold filter
    if (transferValue < minAmount) {
      return { matched: false, reason: "below_threshold", value: transferValue.toString() }
    }

    // Check if counterparty is a known exchange
    const exchangeSet = new Set(
      rt.config.knownExchangeAddresses.split(",").map((a: string) => a.trim().toLowerCase()).filter(Boolean)
    )
    const counterparty = isFromWatched ? toAddress : fromAddress
    const isExchange = exchangeSet.has(counterparty)

    // Optional address enrichment (label lookup)
    let counterpartyLabel = ""
    if (rt.config.enrichmentApiUrl) {
      try {
        const enrichResp = httpClient.fetch(rt.config.enrichmentApiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(rt.config.enrichmentApiKey ? { "Authorization": `Bearer ${rt.config.enrichmentApiKey}` } : {}),
          },
          body: JSON.stringify({ address: counterparty }),
        }).result()
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
      chain: rt.config.chainName,
      isExchangeTransfer: isExchange,
      counterpartyLabel,
      direction: isFromWatched ? "outgoing" : "incoming",
      timestamp: Math.floor(Date.now() / 1000),
    })

    // Response: alert via webhook
    const action = rt.config.responseAction
    if ((action === "alert" || action === "both") && rt.config.alertWebhookUrl) {
      httpClient.fetch(rt.config.alertWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: alertPayload,
      }).result()
    }

    // Response: onchain report
    if (action === "report" || action === "both") {
      const reportData = encodeAbiParameters(
        parseAbiParameters("address from, address to, uint256 value, uint256 timestamp"),
        [
          fromAddress as `0x${string}`,
          toAddress as `0x${string}`,
          transferValue,
          BigInt(Math.floor(Date.now() / 1000)),
        ]
      )

      evmClient.writeReport({
        contractAddress: rt.config.consumerContract,
        chainSelector: getNetwork(rt.config.chainName),
        report: rt.report(reportData),
      })
    }

    // Response: reactive DEX swap (counter-trade)
    if (action === "swap" || (action === "both" && rt.config.swapRouterAddress)) {
      // Compute slippage-protected amountOutMinimum
      // Input-percentage approach (no price oracle in EVM-log-triggered swaps)
      const swapAmountIn = BigInt(rt.config.swapAmountWei)
      const slippageMultiplier = BigInt(10000 - rt.config.slippageBps)
      const amountOutMinimum = (swapAmountIn * slippageMultiplier) / BigInt(10000)

      const swapCalldata = encodeAbiParameters(
        parseAbiParameters("address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96"),
        [
          rt.config.tokenIn as `0x${string}`,
          rt.config.tokenOut as `0x${string}`,
          rt.config.poolFee,
          rt.config.consumerContract as `0x${string}`,
          swapAmountIn,
          amountOutMinimum,
          BigInt(0),
        ]
      )

      evmClient.sendTransaction({
        contractAddress: rt.config.swapRouterAddress,
        chainSelector: getNetwork(rt.config.chainName),
        data: swapCalldata,
        value: rt.config.tokenIn === "0x0000000000000000000000000000000000000000" ? rt.config.swapAmountWei : "0",
      })
    }

    return {
      matched: true,
      from: fromAddress,
      to: toAddress,
      value: transferValue.toString(),
      isExchange,
    }
  })

  consensusIdenticalAggregation({
    fields: ["matched", "from", "to", "value"],
    reportId: "wallet_activity",
  })
}

export async function main() {
  runner.run(initWorkflow)
}
