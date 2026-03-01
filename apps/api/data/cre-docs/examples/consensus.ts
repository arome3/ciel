// Example: API Data with Identical Consensus (Official SDK Pattern)
// Pattern: cre.capabilities.CronCapability + HTTPClient.sendRequest + identicalAggregation

import { z } from "zod"
import {
  cre,
  Runner,
  type Runtime,
  type CronPayload,
  consensusIdenticalAggregation,
} from "@chainlink/cre-sdk"

const configSchema = z.object({
  apiUrl: z.string().describe("API endpoint for data retrieval"),
  queryParam: z.string().describe("Query parameter to send"),
  schedule: z.string().default("0 0 * * * *").describe("Hourly check"),
  consumerContract: z.string().describe("Consumer contract address"),
  chainSelectorName: z.string().default("ethereum-testnet-sepolia").describe("Chain selector name"),
})

type Config = z.infer<typeof configSchema>

const onCronTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
  runtime.log("Querying API for consensus data...")

  const httpClient = new cre.capabilities.HTTPClient()
  const apiKey = runtime.getSecret({ id: "API_KEY" }).result().value

  const response = httpClient.sendRequest(runtime, {
    url: runtime.config.apiUrl,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query: runtime.config.queryParam }),
  }).result()

  const data = JSON.parse(response.body)

  runtime.log(`API returned status: ${data.status}`)
  return JSON.stringify({
    status: data.status,
    result: data.result,
    timestamp: runtime.now().getTime(),
  })
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
