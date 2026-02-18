// Example: API Data with Identical Consensus
// Pattern: CronCapability + HTTPClient POST + identicalAggregation

import { z } from "zod"
import {
  Runner,
  Runtime,
  CronCapability,
  HTTPClient,
  handler,
  consensusIdenticalAggregation,
} from "@chainlink/cre-sdk"

const configSchema = z.object({
  apiUrl: z.string().describe("API endpoint for data retrieval"),
  apiKey: z.string().describe("API authentication key"),
  queryParam: z.string().describe("Query parameter to send"),
  cronSchedule: z.string().default("0 0 * * * *").describe("Hourly check"),
  consumerContract: z.string().describe("Consumer contract address"),
  chainName: z.string().default("base-sepolia").describe("Target chain"),
})

type Config = z.infer<typeof configSchema>

const runner = Runner.newRunner<Config>({ configSchema })

function initWorkflow(runtime: Runtime<Config>) {
  const cronTrigger = new CronCapability().trigger({
    cronSchedule: runtime.config.cronSchedule,
  })

  const httpClient = new HTTPClient()

  handler(cronTrigger, (rt) => {
    const response = httpClient.fetch(rt.config.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${rt.config.apiKey}`,
      },
      body: JSON.stringify({ query: rt.config.queryParam }),
    }).result()

    const data = JSON.parse(response.body)

    return {
      status: data.status,
      result: data.result,
      timestamp: Date.now(),
    }
  })

  consensusIdenticalAggregation({
    fields: ["status", "result"],
    reportId: "api_consensus",
  })
}

export function main() {
  runner.run(initWorkflow)
}
