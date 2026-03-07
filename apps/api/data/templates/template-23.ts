// Template 23: DvP Dual-Trigger Escrow
// Triggers: EVMClient.logTrigger AND CronCapability | Capabilities: settlement-api, payment-api, escrowLock, escrowRelease, evmWrite, kv-store
//
// Two-phase Delivery vs Payment (DvP) workflow:
//   Phase B (evm_log): Reacts to delivery confirmation events on-chain.
//     1. Extracts depositor + tradeId + amount from log topics/data
//     2. Validates delivery via settlement API
//     3. Locks escrow via writeReport
//     4. Initiates payment via ConfidentialHTTPClient
//     5. Writes trade state to S3 KV store (SigV4)
//   Phase C (cron): Polls payment status and releases escrow.
//     1. Reads pending trades from S3 KV store
//     2. Polls payment API for status
//     3. Releases escrow when payment confirmed, marks failed on timeout
//     4. Updates trade state in S3
//
// Combines patterns from T16 (dual-trigger), T19 (escrow lock/release),
// T18 (payment initiation), and T14 (S3 KV state with SigV4).

import { z } from "zod"
import { encodeAbiParameters, parseAbiParameters } from "viem"
import {
  cre,
  Runner,
  type Runtime,
  type CronPayload,
  type EVMLog,
  getNetwork,
  bytesToHex,
  hexToBase64,
  decodeJson,
} from "@chainlink/cre-sdk"
import { sha256 } from "@noble/hashes/sha2"
import { hmac } from "@noble/hashes/hmac"
import { utf8ToBytes, bytesToHex as nobleHex } from "@noble/hashes/utils"

const configSchema = z.object({
  schedule: z.string().default("0 */5 * * * *").describe("Payment poll frequency"),
  chainSelectorName: z.string().default("base-sepolia").describe("Target chain"),
  consumerContract: z.string().describe("Consumer contract for onchain reporting"),
  escrowContractAddress: z.string().describe("Escrow smart contract address"),
  deliveryContractAddress: z.string().describe("Contract emitting delivery events"),
  deliveryEventSignature: z.string().describe("Delivery event topic hash"),
  settlementApiUrl: z.string().describe("Settlement validation API endpoint"),
  paymentApiUrl: z.string().describe("Payment gateway API endpoint"),
  s3Bucket: z.string().describe("S3 bucket for trade state"),
  s3Region: z.string().default("us-east-1").describe("S3 region"),
  s3Key: z.string().default("dvp-trades.json").describe("S3 key for trade state"),
  paymentTimeoutMs: z.number().default(86400000).describe("Payment timeout in ms (default 24h)"),
  maxTradeAmount: z.string().default("1000000000000000000000").describe("Max trade amount in wei"),
})

type Config = z.infer<typeof configSchema>

// Escrow function selectors (keccak256 first 4 bytes)
const LOCK_SELECTOR = "0x282d3fdf"    // lock(address,uint256)
const RELEASE_SELECTOR = "0x0357371d" // release(address,uint256)

interface TradeState {
  tradeId: string
  depositor: string
  amount: string
  paymentId: string
  status: "pending" | "completed" | "failed"
  lockedAt: number
}

// Reused from T14: SigV4 signing for S3 KV store access
function buildSigV4Headers(
  method: string,
  host: string,
  path: string,
  region: string,
  accessKey: string,
  secretKey: string,
  body: string,
  now: Date,
): Record<string, string> {
  const dateStamp = now.toISOString().replace(/[-:]/g, "").slice(0, 8)
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "")
  const service = "s3"

  const payloadHash = nobleHex(sha256(utf8ToBytes(body || "")))
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date"

  const canonicalRequest = [method, path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n")
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, nobleHex(sha256(utf8ToBytes(canonicalRequest)))].join("\n")

  const kDate = hmac(sha256, utf8ToBytes(`AWS4${secretKey}`), utf8ToBytes(dateStamp))
  const kRegion = hmac(sha256, kDate, utf8ToBytes(region))
  const kService = hmac(sha256, kRegion, utf8ToBytes(service))
  const kSigning = hmac(sha256, kService, utf8ToBytes("aws4_request"))
  const signature = nobleHex(hmac(sha256, kSigning, utf8ToBytes(stringToSign)))

  return {
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
    Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  }
}

// ─────────────────────────────────────────────
// Handler 1: Delivery Event → Lock Escrow + Initiate Payment
// ─────────────────────────────────────────────

const onDeliveryEvent = (runtime: Runtime<Config>, log: EVMLog): string => {
  runtime.log("DvP: delivery event received, starting lock + payment phase...")

  // Extract trade data from log topics and data
  if (!log || !log.topics || log.topics.length < 3) {
    runtime.log("Invalid log structure — need at least 3 topics")
    return JSON.stringify({ source: "delivery_event", error: "invalid_log" })
  }

  const depositor = "0x" + bytesToHex(log.topics[1]).slice(24)
  const tradeId = bytesToHex(log.topics[2])
  const amount = BigInt("0x" + bytesToHex(log.data))

  // Validate amount limit
  if (amount > BigInt(runtime.config.maxTradeAmount)) {
    runtime.log(`Trade amount ${amount} exceeds max ${runtime.config.maxTradeAmount}`)
    return JSON.stringify({ source: "delivery_event", tradeId, error: "exceeds_max_amount" })
  }

  // Step 1: Validate delivery via settlement API
  const httpClient = new cre.capabilities.HTTPClient()
  const settlementResp = httpClient.sendRequest(runtime, {
    url: `${runtime.config.settlementApiUrl}/validate?tradeId=${tradeId}`,
    method: "GET",
    headers: { "Content-Type": "application/json" },
  }).result()

  const validation = decodeJson(settlementResp.body) as { deliveryConfirmed: boolean }
  if (!validation.deliveryConfirmed) {
    runtime.log("Delivery not confirmed by settlement API")
    return JSON.stringify({ source: "delivery_event", tradeId, error: "delivery_not_confirmed" })
  }

  // Step 2: Lock escrow via writeReport
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: runtime.config.chainSelectorName, isTestnet: true })
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  const lockCallData = (LOCK_SELECTOR + encodeAbiParameters(
    parseAbiParameters("address, uint256"),
    [depositor as `0x${string}`, amount]
  ).slice(2)) as `0x${string}`

  const lockReportData = encodeAbiParameters(
    parseAbiParameters("address depositor, address target, bytes callData, uint256 amount, uint256 timestamp"),
    [
      depositor as `0x${string}`,
      runtime.config.escrowContractAddress as `0x${string}`,
      lockCallData,
      amount,
      BigInt(Math.floor(runtime.now().getTime() / 1000)),
    ]
  )

  const lockReport = runtime.report({
    encodedPayload: lockReportData,
    encoderName: "EVM",
    signingAlgo: "SECP256K1",
    hashingAlgo: "KECCAK256",
  }).result()

  evmClient.writeReport(runtime, {
    receiver: runtime.config.consumerContract,
    report: lockReport,
    gasConfig: { gasLimit: 500000 },
  }).result()

  runtime.log(`Escrow locked for trade ${tradeId}`)

  // Step 3: Initiate payment via ConfidentialHTTPClient
  const kvClient = new cre.capabilities.ConfidentialHTTPClient()
  const paymentResp = kvClient.sendRequest(runtime, {
    url: `${runtime.config.paymentApiUrl}/initiate`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tradeId,
      depositor,
      amount: amount.toString(),
    }),
  }).result()

  const paymentResult = decodeJson(paymentResp.body) as { paymentId: string }

  // Step 4: Write trade state to S3 KV store
  const accessKey = runtime.getSecret({ id: "AWS_ACCESS_KEY_ID" }).result().value
  const secretKey = runtime.getSecret({ id: "AWS_SECRET_ACCESS_KEY" }).result().value
  const host = `${runtime.config.s3Bucket}.s3.${runtime.config.s3Region}.amazonaws.com`
  const path = `/${runtime.config.s3Key}`
  const url = `https://${host}${path}`

  // Read existing trades
  let trades: TradeState[] = []
  try {
    const getHeaders = buildSigV4Headers("GET", host, path, runtime.config.s3Region, accessKey, secretKey, "", runtime.now())
    const getResp = kvClient.sendRequest(runtime, {
      url,
      method: "GET",
      headers: { ...getHeaders, Host: host },
    }).result()
    trades = decodeJson(getResp.body) as TradeState[]
  } catch {
    runtime.log("No existing trade state — first trade")
  }

  // Add new trade
  const newTrade: TradeState = {
    tradeId,
    depositor,
    amount: amount.toString(),
    paymentId: paymentResult.paymentId,
    status: "pending",
    lockedAt: runtime.now().getTime(),
  }
  trades.push(newTrade)

  // Write updated state
  const stateBody = JSON.stringify(trades)
  const putHeaders = buildSigV4Headers("PUT", host, path, runtime.config.s3Region, accessKey, secretKey, stateBody, runtime.now())
  kvClient.sendRequest(runtime, {
    url,
    method: "PUT",
    headers: { ...putHeaders, Host: host, "Content-Type": "application/json" },
    body: stateBody,
  }).result()

  runtime.log(`Trade state saved: ${trades.length} trades total`)
  return JSON.stringify({ source: "delivery_event", tradeId, action: "lock", paymentId: paymentResult.paymentId })
}

// ─────────────────────────────────────────────
// Handler 2: Payment Poll → Release Escrow on Confirmation
// ─────────────────────────────────────────────

const onPaymentPoll = (runtime: Runtime<Config>, payload: CronPayload): string => {
  runtime.log("DvP: polling payment status for pending trades...")

  const kvClient = new cre.capabilities.ConfidentialHTTPClient()
  const httpClient = new cre.capabilities.HTTPClient()
  const accessKey = runtime.getSecret({ id: "AWS_ACCESS_KEY_ID" }).result().value
  const secretKey = runtime.getSecret({ id: "AWS_SECRET_ACCESS_KEY" }).result().value
  const host = `${runtime.config.s3Bucket}.s3.${runtime.config.s3Region}.amazonaws.com`
  const path = `/${runtime.config.s3Key}`
  const url = `https://${host}${path}`

  // Read trade state from S3
  let trades: TradeState[] = []
  try {
    const getHeaders = buildSigV4Headers("GET", host, path, runtime.config.s3Region, accessKey, secretKey, "", runtime.now())
    const getResp = kvClient.sendRequest(runtime, {
      url,
      method: "GET",
      headers: { ...getHeaders, Host: host },
    }).result()
    trades = decodeJson(getResp.body) as TradeState[]
  } catch {
    runtime.log("No trade state found — nothing to poll")
    return JSON.stringify({ source: "payment_poll", tradesProcessed: 0, released: 0, expired: 0 })
  }

  const now = runtime.now().getTime()
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: runtime.config.chainSelectorName, isTestnet: true })
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  let released = 0
  let expired = 0
  let processed = 0

  for (const trade of trades) {
    if (trade.status !== "pending") continue
    processed++

    // Poll payment status
    const statusResp = httpClient.sendRequest(runtime, {
      url: `${runtime.config.paymentApiUrl}/status?paymentId=${trade.paymentId}`,
      method: "GET",
      headers: { "Content-Type": "application/json" },
    }).result()

    const status = decodeJson(statusResp.body) as { confirmed: boolean }

    if (status.confirmed) {
      // Release escrow
      const releaseCallData = (RELEASE_SELECTOR + encodeAbiParameters(
        parseAbiParameters("address, uint256"),
        [trade.depositor as `0x${string}`, BigInt(trade.amount)]
      ).slice(2)) as `0x${string}`

      const releaseReportData = encodeAbiParameters(
        parseAbiParameters("address depositor, address target, bytes callData, uint256 amount, bool released, uint256 timestamp"),
        [
          trade.depositor as `0x${string}`,
          runtime.config.escrowContractAddress as `0x${string}`,
          releaseCallData,
          BigInt(trade.amount),
          true,
          BigInt(Math.floor(now / 1000)),
        ]
      )

      const creReport = runtime.report({
        encodedPayload: releaseReportData,
        encoderName: "EVM",
        signingAlgo: "SECP256K1",
        hashingAlgo: "KECCAK256",
      }).result()

      evmClient.writeReport(runtime, {
        receiver: runtime.config.consumerContract,
        report: creReport,
        gasConfig: { gasLimit: 500000 },
      }).result()

      trade.status = "completed"
      released++
      runtime.log(`Trade ${trade.tradeId}: payment confirmed, escrow released`)
    } else if (now - trade.lockedAt > runtime.config.paymentTimeoutMs) {
      // Payment timed out — mark failed, do NOT release
      trade.status = "failed"
      expired++
      runtime.log(`Trade ${trade.tradeId}: payment timed out after ${runtime.config.paymentTimeoutMs}ms`)
    }
  }

  // Write updated state back to S3
  const stateBody = JSON.stringify(trades)
  const putHeaders = buildSigV4Headers("PUT", host, path, runtime.config.s3Region, accessKey, secretKey, stateBody, runtime.now())
  kvClient.sendRequest(runtime, {
    url,
    method: "PUT",
    headers: { ...putHeaders, Host: host, "Content-Type": "application/json" },
    body: stateBody,
  }).result()

  runtime.log(`Payment poll complete: ${processed} processed, ${released} released, ${expired} expired`)
  return JSON.stringify({ source: "payment_poll", tradesProcessed: processed, released, expired })
}

// ─────────────────────────────────────────────
// Dual-Trigger initWorkflow: evm_log + cron
// ─────────────────────────────────────────────

const initWorkflow = (config: Config) => {
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: config.chainSelectorName,
    isTestnet: true,
  })

  // Trigger 1: Delivery event on-chain
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)
  const logTrigger = evmClient.logTrigger({
    addresses: [hexToBase64(config.deliveryContractAddress)],
    topics: [hexToBase64(config.deliveryEventSignature)],
  })

  // Trigger 2: Cron poll for payment status
  const cronCapability = new cre.capabilities.CronCapability()
  const cronTrigger = cronCapability.trigger({ schedule: config.schedule })

  return [
    cre.handler(logTrigger, onDeliveryEvent),
    cre.handler(cronTrigger, onPaymentPoll),
  ]
}

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema })
  await runner.run(initWorkflow)
}
main()
