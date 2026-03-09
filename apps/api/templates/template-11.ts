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
import { encodeAbiParameters, parseAbiParameters } from "viem"
import {
  cre,
  Runner,
  type Runtime,
  type CronPayload,
  getNetwork,
  decodeJson,
} from "@chainlink/cre-sdk"

const configSchema = z.object({
  schedule: z.string().default("0 */5 * * * *").describe("Price check frequency (6-field cron)"),
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
  chainSelectorName: z.string().default("ethereum-testnet-sepolia-base-1").describe("Target chain"),
  consumerContract: z.string().describe("Consumer contract for onchain reporting"),
  tokenOutDecimals: z.number().default(18).describe("Output token decimals (e.g. 6 for USDC, 18 for WETH)"),
})

type Config = z.infer<typeof configSchema>

// exactInputSingle function selector: 0x414bf389
const EXACT_INPUT_SINGLE_SELECTOR = "0x414bf389"

// WETH address on Base (native ETH wrapper)
const WETH_BASE = "0x4200000000000000000000000000000000000006"

const onCronTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
  runtime.log("Checking price condition for conditional swap...")
  const httpClient = new cre.capabilities.HTTPClient()
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: runtime.config.chainSelectorName, isTestnet: true })
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  // Step 1: Fetch current price
  const priceUrl = `${runtime.config.priceApiUrl}?ids=${runtime.config.assetId}&vs_currencies=usd`
  const priceResp = httpClient.sendRequest(runtime, {
    url: priceUrl,
    method: "GET",
    headers: { "Content-Type": "application/json" },
  }).result()

  let priceData: Record<string, { usd: number }>
  try {
    priceData = decodeJson(priceResp.body) as Record<string, { usd: number }>
  } catch {
    runtime.log("Failed to parse price response")
    return JSON.stringify({ executed: false, reason: "price_parse_error" })
  }
  const currentPrice = priceData[runtime.config.assetId]?.usd
  if (typeof currentPrice !== "number") {
    runtime.log("Price unavailable for asset")
    return JSON.stringify({ executed: false, reason: "price_unavailable" })
  }

  // Step 2: Check threshold condition
  const shouldSwap =
    runtime.config.direction === "below"
      ? currentPrice < runtime.config.threshold
      : currentPrice > runtime.config.threshold

  if (!shouldSwap) {
    runtime.log("Price condition not met, skipping swap")
    return JSON.stringify({ executed: false, price: currentPrice, threshold: runtime.config.threshold })
  }

  // Step 3: Compute slippage-protected amountOutMinimum
  // Convert input amount to expected output using current market price
  // priceBig uses 8-decimal fixed-point to avoid floating-point precision loss
  const amountIn = BigInt(runtime.config.swapAmountWei)
  const priceBig = BigInt(Math.round(currentPrice * 1e8))
  const outputDecimals = BigInt(10) ** BigInt(runtime.config.tokenOutDecimals ?? 18)
  const inputDecimals = BigInt(10) ** BigInt(runtime.config.tokenInDecimals)
  const expectedOutput = (amountIn * priceBig * outputDecimals) / (inputDecimals * BigInt(1e8))
  const slippageMultiplier = BigInt(10000 - runtime.config.slippageBps)
  const amountOutMinimum = (expectedOutput * slippageMultiplier) / BigInt(10000)

  // Step 4: Encode exactInputSingle params
  // ExactInputSingleParams: (address,address,uint24,address,uint256,uint256,uint160)
  const encodedParams = encodeAbiParameters(
    parseAbiParameters("address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96"),
    [
      runtime.config.tokenIn as `0x${string}`,
      runtime.config.tokenOut as `0x${string}`,
      runtime.config.poolFee,
      runtime.config.recipientAddress as `0x${string}`,
      amountIn,
      amountOutMinimum,
      BigInt(0), // no price limit
    ],
  )

  // Combine selector + encoded params
  const calldata = EXACT_INPUT_SINGLE_SELECTOR + encodedParams.slice(2)

  // Step 5: Encode swap intent into report payload → writeReport to consumer
  // Consumer contract (IReceiver.onReport) decodes and executes the swap via SwapRouter
  const isNativeETH = runtime.config.useNativeETH
  const swapValue = isNativeETH ? BigInt(runtime.config.swapAmountWei) : BigInt(0)

  runtime.log("Encoding swap intent and writing report...")
  const reportData = encodeAbiParameters(
    parseAbiParameters("address target, bytes callData, uint256 value, uint256 price, uint256 timestamp"),
    [
      runtime.config.swapRouterAddress as `0x${string}`,
      calldata as `0x${string}`,
      swapValue,
      BigInt(Math.round(currentPrice * 1e8)),
      BigInt(Math.floor(runtime.now().getTime() / 1000)),
    ],
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

  runtime.log("Swap intent reported onchain")
  return JSON.stringify({ executed: true, price: currentPrice, amountIn: runtime.config.swapAmountWei })
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
