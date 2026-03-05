// Template 16: Dual-Trigger Workflow (Cron + EVM Log)
// Triggers: CronCapability AND EVMClient.logTrigger | Capabilities: HTTPClient, EVMClient, writeReport
//
// Demonstrates a workflow that responds to BOTH scheduled execution and on-chain events.
// The cron handler periodically fetches external data and writes an onchain report.
// The log handler reacts to on-chain events (e.g., price update events) and triggers
// immediate processing.
//
// This pattern is from the official Chainlink CRE "Custom Data Feed" template,
// where a workflow both polls for data and reacts to on-chain triggers.

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

const configSchema = z.object({
  schedule: z.string().default("0 */10 * * * *").describe("Scheduled data fetch frequency"),
  dataApiUrl: z.string().describe("External data API URL"),
  chainSelectorName: z.string().default("ethereum-testnet-sepolia").describe("Chain to monitor and report to"),
  consumerContract: z.string().describe("Consumer contract for onchain reporting"),
  eventContractAddress: z.string().describe("Contract address to watch for events"),
  eventSignature: z.string().default("0x0000000000000000000000000000000000000000000000000000000000000000").describe("Event topic hash to filter"),
  minValueChange: z.number().default(100).describe("Minimum value change to trigger report update"),
})

type Config = z.infer<typeof configSchema>

// Shared reporting logic used by both triggers
function writeOnchainReport(
  runtime: Runtime<Config>,
  evmClient: InstanceType<typeof cre.capabilities.EVMClient>,
  value: bigint,
  source: string,
): void {
  // Convert source string to bytes32 without Buffer (not available in CRE sandbox)
  const sourceHex = Array.from(source)
    .map(c => c.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("")
    .padEnd(64, "0")
    .slice(0, 64)

  const reportData = encodeAbiParameters(
    parseAbiParameters("uint256 value, uint256 timestamp, bytes32 source"),
    [
      value,
      BigInt(Math.floor(runtime.now().getTime() / 1000)),
      ("0x" + sourceHex) as `0x${string}`,
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
}

// Handler 1: Scheduled data fetch
const onCronTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
  runtime.log("Cron trigger: fetching external data...")

  const httpClient = new cre.capabilities.HTTPClient()
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.chainSelectorName,
    isTestnet: true,
  })
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  // Fetch data from API
  const resp = httpClient.sendRequest(runtime, {
    url: runtime.config.dataApiUrl,
    method: "GET",
    headers: { "Content-Type": "application/json" },
  }).result()

  const data = decodeJson(resp.body) as { value?: number }
  const value = Math.round((data.value ?? 0) * 1e8)

  runtime.log(`Cron: fetched value ${value}`)

  // Write report
  writeOnchainReport(runtime, evmClient, BigInt(value), "cron")

  runtime.log("Cron report written successfully")
  return JSON.stringify({ source: "cron", value, timestamp: payload.scheduledExecutionTime })
}

// Handler 2: On-chain event reaction
const onEvmLogTrigger = (runtime: Runtime<Config>, log: EVMLog): string => {
  runtime.log("EVM log trigger: processing on-chain event...")

  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.chainSelectorName,
    isTestnet: true,
  })
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  // Validate log structure
  if (!log || !log.topics || log.topics.length < 1) {
    runtime.log("Invalid log structure")
    return JSON.stringify({ source: "event", processed: false, reason: "invalid_log" })
  }

  // Extract value from log data
  const rawValue = BigInt("0x" + bytesToHex(log.data))
  runtime.log(`Event: extracted value ${rawValue.toString()}`)

  // Only report if value change exceeds minimum threshold
  if (rawValue < BigInt(runtime.config.minValueChange)) {
    runtime.log("Value change below threshold, skipping report")
    return JSON.stringify({ source: "event", processed: false, reason: "below_threshold" })
  }

  // Write report from event data
  writeOnchainReport(runtime, evmClient, rawValue, "event")

  runtime.log("Event report written successfully")
  return JSON.stringify({ source: "event", value: rawValue.toString(), processed: true })
}

// Dual-trigger initWorkflow: returns handlers for BOTH triggers
const initWorkflow = (config: Config) => {
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: config.chainSelectorName,
    isTestnet: true,
  })

  // Trigger 1: Cron schedule
  const cronCapability = new cre.capabilities.CronCapability()
  const cronTrigger = cronCapability.trigger({ schedule: config.schedule })

  // Trigger 2: EVM log events
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)
  const logTrigger = evmClient.logTrigger({
    addresses: [hexToBase64(config.eventContractAddress)],
    topics: [hexToBase64(config.eventSignature)],
  })

  return [
    cre.handler(cronTrigger, onCronTrigger),
    cre.handler(logTrigger, onEvmLogTrigger),
  ]
}

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema })
  await runner.run(initWorkflow)
}
main()
