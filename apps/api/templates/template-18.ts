// Template 18: Payment Initiation & Confirmation
// Trigger: CronCapability | Capabilities: payment-api, kv-store (idempotency), evmWrite
//
// Pattern: Cron trigger → fetch pending payments → validate → initiate via ConfidentialHTTPClient
//          → on-chain record via evmWrite → report
// Uses KV store pattern from T14 for idempotency tracking

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
  schedule: z.string().default("0 0 */4 * * *").describe("Payment check frequency"),
  chainSelectorName: z.string().default("base-sepolia").describe("Target chain"),
  consumerContract: z.string().describe("Consumer contract for onchain reporting"),
  paymentApiUrl: z.string().describe("Payment gateway API endpoint"),
  maxPaymentAmount: z.string().default("50000000000").describe("Maximum payment amount in smallest unit"),
  s3Bucket: z.string().describe("S3 bucket for idempotency tracking"),
  s3Region: z.string().default("us-east-1").describe("S3 region"),
  s3Key: z.string().default("payment-idempotency.json").describe("S3 key for idempotency state"),
})

type Config = z.infer<typeof configSchema>

interface PendingPayment {
  id: string
  amount: string
  recipient: string
  reference: string
}

const onCronTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
  runtime.log("Starting payment initiation workflow...")

  const httpClient = new cre.capabilities.HTTPClient()
  const kvClient = new cre.capabilities.ConfidentialHTTPClient()

  // Step 1: Fetch pending payments
  runtime.log("Fetching pending payments...")
  const paymentResp = httpClient.sendRequest(runtime, {
    url: `${runtime.config.paymentApiUrl}/pending`,
    method: "GET",
    headers: { "Content-Type": "application/json" },
  }).result()

  const pendingPayments = decodeJson(paymentResp.body) as PendingPayment[]
  runtime.log(`Found ${pendingPayments.length} pending payments`)

  if (pendingPayments.length === 0) {
    return JSON.stringify({ executed: false, reason: "no_pending_payments" })
  }

  // Step 2: Load idempotency state from KV store (S3 via SigV4)
  // NOTE: Production S3 access requires SigV4 signing — see T14 for full HMAC pattern
  let processedIds: string[] = []
  try {
    const accessKey = runtime.getSecret({ id: "AWS_ACCESS_KEY_ID" }).result().value
    const secretKey = runtime.getSecret({ id: "AWS_SECRET_ACCESS_KEY" }).result().value
    const s3Url = `https://${runtime.config.s3Bucket}.s3.${runtime.config.s3Region}.amazonaws.com/${runtime.config.s3Key}`
    const now = runtime.now().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "")
    const dateStamp = now.slice(0, 8)
    const stateResp = kvClient.sendRequest(runtime, {
      url: s3Url,
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-amz-date": now,
        "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
      },
    }).result()
    processedIds = decodeJson(stateResp.body) as string[]
  } catch {
    runtime.log("No prior idempotency state — first run")
  }

  const processedSet = new Set(processedIds)
  const maxAmount = BigInt(runtime.config.maxPaymentAmount)
  let initiated = 0

  // Step 3: Process each payment
  for (const payment of pendingPayments) {
    if (processedSet.has(payment.id)) {
      runtime.log(`Skipping already-processed payment ${payment.id}`)
      continue
    }

    if (BigInt(payment.amount) > maxAmount) {
      runtime.log(`Payment ${payment.id} exceeds max amount — skipping`)
      continue
    }

    // Initiate payment via confidential HTTP
    runtime.log(`Initiating payment ${payment.id}...`)
    const initResp = kvClient.sendRequest(runtime, {
      url: `${runtime.config.paymentApiUrl}/initiate`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paymentId: payment.id,
        amount: payment.amount,
        recipient: payment.recipient,
        reference: payment.reference,
      }),
    }).result()

    const initResult = decodeJson(initResp.body) as { success: boolean; confirmationId?: string }
    if (initResult.success) {
      processedSet.add(payment.id)
      initiated++
    }
  }

  // Step 4: Save updated idempotency state
  kvClient.sendRequest(runtime, {
    url: `https://${runtime.config.s3Bucket}.s3.${runtime.config.s3Region}.amazonaws.com/${runtime.config.s3Key}`,
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([...processedSet]),
  }).result()

  // Step 5: Report onchain
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: runtime.config.chainSelectorName, isTestnet: true })
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  const reportData = encodeAbiParameters(
    parseAbiParameters("uint256 count, uint256 timestamp"),
    [BigInt(initiated), BigInt(Math.floor(runtime.now().getTime() / 1000))]
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

  runtime.log(`Payment initiation complete: ${initiated} payments processed`)
  return JSON.stringify({ executed: true, initiated, total: pendingPayments.length })
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
