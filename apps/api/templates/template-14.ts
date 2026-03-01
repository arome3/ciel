// Template 14: Stateful KV Store Workflow
// Trigger: CronCapability | Capabilities: ConfidentialHTTPClient, S3, @noble/hashes, writeReport

import { z } from "zod"
import {
  cre,
  Runner,
  type Runtime,
  type CronPayload,
  getNetwork,
  encodeAbiParameters,
  parseAbiParameters,
} from "@chainlink/cre-sdk"
import { sha256 } from "@noble/hashes/sha2"
import { hmac } from "@noble/hashes/hmac"
import { utf8ToBytes, bytesToHex as nobleHex } from "@noble/hashes/utils"

const configSchema = z.object({
  s3Bucket: z.string().describe("AWS S3 bucket name"),
  s3Region: z.string().default("us-east-1").describe("AWS region"),
  s3Key: z.string().default("workflow-state.json").describe("S3 object key"),
  dataApiUrl: z.string().describe("Data source API URL"),
  maxHistorySize: z.number().default(24).describe("Max items in history"),
  schedule: z.string().default("0 0 * * * *").describe("Hourly schedule"),
  consumerContract: z.string().describe("Consumer contract address"),
  chainSelectorName: z.string().default("ethereum-testnet-sepolia").describe("Chain selector name"),
})

type Config = z.infer<typeof configSchema>

interface WorkflowState {
  values: number[]
  count: number
  lastUpdated: string
}

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

const onCronTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
  runtime.log("Reading state from S3...")

  const kvClient = new cre.capabilities.ConfidentialHTTPClient()
  const accessKey = runtime.getSecret({ id: "AWS_ACCESS_KEY_ID" }).result().value
  const secretKey = runtime.getSecret({ id: "AWS_SECRET_ACCESS_KEY" }).result().value

  const host = `${runtime.config.s3Bucket}.s3.${runtime.config.s3Region}.amazonaws.com`
  const path = `/${runtime.config.s3Key}`
  const url = `https://${host}${path}`

  // Read current state
  let state: WorkflowState = { values: [], count: 0, lastUpdated: "" }
  try {
    const getHeaders = buildSigV4Headers("GET", host, path, runtime.config.s3Region, accessKey, secretKey, "", runtime.now())
    const getResp = kvClient.sendRequest(runtime, {
      url,
      method: "GET",
      headers: { ...getHeaders, Host: host },
    }).result()
    state = JSON.parse(getResp.body)
  } catch {
    runtime.log("No existing state found, using defaults")
  }

  // Fetch new data
  const httpClient = new cre.capabilities.HTTPClient()
  const dataResp = httpClient.sendRequest(runtime, {
    url: runtime.config.dataApiUrl,
    method: "GET",
    headers: { "Content-Type": "application/json" },
  }).result()
  const data = JSON.parse(dataResp.body)
  const newValue = Math.round((data.value ?? 0) * 1e8)

  // Update state
  state.values.push(newValue)
  if (state.values.length > runtime.config.maxHistorySize) {
    state.values = state.values.slice(state.values.length - runtime.config.maxHistorySize)
  }
  state.count += 1
  state.lastUpdated = payload.scheduledExecutionTime

  // Compute moving average
  const sum = state.values.reduce((acc, v) => acc + v, 0)
  const movingAverage = Math.round(sum / state.values.length)

  // Write updated state back to S3
  const stateBody = JSON.stringify(state)
  const putHeaders = buildSigV4Headers("PUT", host, path, runtime.config.s3Region, accessKey, secretKey, stateBody, runtime.now())
  kvClient.sendRequest(runtime, {
    url,
    method: "PUT",
    headers: { ...putHeaders, Host: host, "Content-Type": "application/json" },
    body: stateBody,
  }).result()

  runtime.log(`State updated: count=${state.count}, avg=${movingAverage}`)

  // Write report onchain
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.chainSelectorName,
    isTestnet: true,
  })
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  const encodedPayload = encodeAbiParameters(
    parseAbiParameters("uint256 value, uint256 average, uint256 count"),
    [BigInt(newValue), BigInt(movingAverage), BigInt(state.count)]
  )

  const report = runtime.report({
    encodedPayload,
    encoderName: "EVM",
    signingAlgo: "SECP256K1",
    hashingAlgo: "KECCAK256",
  }).result()

  evmClient.writeReport(runtime, {
    receiver: runtime.config.consumerContract,
    report: report.report,
    gasConfig: { gasLimit: 500000 },
  }).result()

  return JSON.stringify({ value: newValue, movingAverage, count: state.count })
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
