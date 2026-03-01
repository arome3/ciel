// Example: Event-Driven Report Writer (Official SDK Pattern)
// Pattern: cre.capabilities.CronCapability + HTTPClient + EVMClient + writeReport

import { z } from "zod"
import {
  cre,
  Runner,
  type Runtime,
  type CronPayload,
  getNetwork,
  encodeAbiParameters,
  parseAbiParameters,
  consensusMedianAggregation,
} from "@chainlink/cre-sdk"

const configSchema = z.object({
  dataApiUrl: z.string().describe("Data source API URL"),
  consumerContract: z.string().describe("Onchain consumer contract"),
  chainSelectorName: z.string().default("ethereum-testnet-sepolia").describe("Chain selector name"),
  schedule: z.string().default("0 */10 * * * *").describe("Every 10 minutes"),
})

type Config = z.infer<typeof configSchema>

const onCronTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
  runtime.log("Fetching data for onchain report...")

  // Fetch data from external source
  const httpClient = new cre.capabilities.HTTPClient()
  const response = httpClient.sendRequest(runtime, {
    url: runtime.config.dataApiUrl,
    method: "GET",
    headers: { "Content-Type": "application/json" },
  }).result()

  const data = JSON.parse(response.body)
  const value = Math.round(data.value * 1e8)

  // Encode data for onchain consumption
  const encodedPayload = encodeAbiParameters(
    parseAbiParameters("uint256 value, uint256 timestamp, string source"),
    [BigInt(value), BigInt(Math.floor(runtime.now().getTime() / 1000)), data.source]
  )

  // Create report with signing parameters
  const report = runtime.report({
    encodedPayload,
    encoderName: "EVM",
    signingAlgo: "SECP256K1",
    hashingAlgo: "KECCAK256",
  }).result()

  // Write report onchain
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.chainSelectorName,
    isTestnet: true,
  })
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  evmClient.writeReport(runtime, {
    receiver: runtime.config.consumerContract,
    report: report.report,
    gasConfig: { gasLimit: 500000 },
  }).result()

  runtime.log(`Report written: value=${value}, source=${data.source}`)
  return JSON.stringify({ value, source: data.source, timestamp: runtime.now().getTime() })
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
