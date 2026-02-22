// Template 11: Conditional DEX Swap (Uniswap V3)
// Trigger: CronCapability | Capabilities: HTTPClient (price), EVMClient (swap + report)
//
// PREREQUISITE: For ERC-20 token swaps (not native ETH), the workflow's address
// must have prior ERC-20 approve() to the SwapRouter contract for tokenIn.
// This template handles the swap itself, not the approval (separate concern).
//
// SwapRouter02 addresses:
//   Base Sepolia: 0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4
//   Base Mainnet: 0x2626664c2603336E57B271c5C0b26F421741e481

import { z } from "zod"
import {
  Runner,
  Runtime,
  CronCapability,
  HTTPClient,
  EVMClient,
  handler,
  getNetwork,
  consensusIdenticalAggregation,
} from "@chainlink/cre-sdk"
import { encodeAbiParameters, parseAbiParameters } from "viem"

const configSchema = z.object({
  cronSchedule: z.string().default("0 */5 * * * *").describe("Price check frequency (6-field cron)"),
  priceApiUrl: z.string().describe("Price API base URL (e.g. CoinGecko)"),
  assetId: z.string().describe("Asset identifier for price API (e.g. 'ethereum')"),
  direction: z.enum(["below", "above"]).default("below").describe("Trigger direction: 'below' or 'above'"),
  threshold: z.number().describe("Price threshold in USD"),
  swapAmountWei: z.string().describe("Swap input amount in wei"),
  swapRouterAddress: z.string().describe("Uniswap V3 SwapRouter02 contract address"),
  tokenIn: z.string().describe("Input token address (e.g. WETH)"),
  tokenOut: z.string().describe("Output token address"),
  poolFee: z.number().default(3000).describe("Pool fee tier (500=0.05%, 3000=0.3%, 10000=1%)"),
  slippageBps: z.number().default(50).describe("Slippage tolerance in basis points (50 = 0.5%)"),
  tokenInDecimals: z.number().default(18).describe("Input token decimals (e.g. 6 for USDC, 18 for WETH)"),
  useNativeETH: z.boolean().default(true).describe("Whether tokenIn is native ETH (uses msg.value)"),
  recipientAddress: z.string().describe("Address that receives output tokens"),
  chainName: z.string().default("base-sepolia").describe("Target chain"),
  consumerContract: z.string().describe("Consumer contract for onchain reporting"),
  tokenOutDecimals: z.number().default(18).describe("Output token decimals (e.g. 6 for USDC, 18 for WETH)"),
})

type Config = z.infer<typeof configSchema>

const runner = Runner.newRunner<Config>({ configSchema })

// exactInputSingle function selector: 0x414bf389
const EXACT_INPUT_SINGLE_SELECTOR = "0x414bf389"

// WETH address on Base (native ETH wrapper)
const WETH_BASE = "0x4200000000000000000000000000000000000006"

function initWorkflow(runtime: Runtime<Config>) {
  const cronTrigger = new CronCapability().trigger({
    cronSchedule: runtime.config.cronSchedule,
  })

  const httpClient = new HTTPClient()
  const evmClient = new EVMClient()

  handler(cronTrigger, (rt) => {
    // Step 1: Fetch current price
    const priceUrl = `${rt.config.priceApiUrl}?ids=${rt.config.assetId}&vs_currencies=usd`
    const priceResp = httpClient.fetch(priceUrl, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    }).result()

    let priceData: Record<string, { usd: number }>
    try {
      priceData = JSON.parse(priceResp.body) as Record<string, { usd: number }>
    } catch {
      return { executed: false, reason: "price_parse_error" }
    }
    const currentPrice = priceData[rt.config.assetId]?.usd
    if (typeof currentPrice !== "number") {
      return { executed: false, reason: "price_unavailable" }
    }

    // Step 2: Check threshold condition
    const shouldSwap =
      rt.config.direction === "below"
        ? currentPrice < rt.config.threshold
        : currentPrice > rt.config.threshold

    if (!shouldSwap) {
      return { executed: false, price: currentPrice, threshold: rt.config.threshold }
    }

    // Step 3: Compute slippage-protected amountOutMinimum
    // Convert input amount to expected output using current market price
    // priceBig uses 8-decimal fixed-point to avoid floating-point precision loss
    const amountIn = BigInt(rt.config.swapAmountWei)
    const priceBig = BigInt(Math.round(currentPrice * 1e8))
    const outputDecimals = BigInt(10) ** BigInt(rt.config.tokenOutDecimals ?? 18)
    const inputDecimals = BigInt(10) ** BigInt(rt.config.tokenInDecimals)
    const expectedOutput = (amountIn * priceBig * outputDecimals) / (inputDecimals * BigInt(1e8))
    const slippageMultiplier = BigInt(10000 - rt.config.slippageBps)
    const amountOutMinimum = (expectedOutput * slippageMultiplier) / BigInt(10000)

    // Step 4: Encode exactInputSingle params
    // ExactInputSingleParams: (address,address,uint24,address,uint256,uint256,uint160)
    const encodedParams = encodeAbiParameters(
      parseAbiParameters("address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96"),
      [
        rt.config.tokenIn as `0x${string}`,
        rt.config.tokenOut as `0x${string}`,
        rt.config.poolFee,
        rt.config.recipientAddress as `0x${string}`,
        amountIn,
        amountOutMinimum,
        BigInt(0), // no price limit
      ],
    )

    // Combine selector + encoded params
    const calldata = EXACT_INPUT_SINGLE_SELECTOR + encodedParams.slice(2)

    // Step 5: Execute swap via sendTransaction
    const chainSelector = getNetwork(rt.config.chainName)
    const isNativeETH = rt.config.useNativeETH

    const txResult = evmClient.sendTransaction({
      contractAddress: rt.config.swapRouterAddress,
      chainSelector,
      data: calldata,
      ...(isNativeETH ? { value: rt.config.swapAmountWei } : {}),
    }).result()

    // Only report onchain if swap succeeded
    if (!txResult || !txResult.success) {
      return { executed: false, reason: "swap_tx_failed", price: currentPrice }
    }

    // Step 6: Report execution onchain
    const reportData = encodeAbiParameters(
      parseAbiParameters("uint256 price, uint256 amountIn, uint256 timestamp"),
      [
        BigInt(Math.round(currentPrice * 1e8)),
        amountIn,
        BigInt(Math.floor(Date.now() / 1000)),
      ],
    )

    evmClient.writeReport({
      contractAddress: rt.config.consumerContract,
      chainSelector,
      report: rt.report(reportData),
    })

    return { executed: true, price: currentPrice, amountIn: rt.config.swapAmountWei }
  })

  consensusIdenticalAggregation({
    fields: ["price"],
    reportId: "dex_swap",
  })
}

export async function main() {
  runner.run(initWorkflow)
}
