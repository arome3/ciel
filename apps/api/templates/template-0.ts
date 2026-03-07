// Wildcard scaffold — minimal CRE workflow structure
// Used as fallback when LLM generation fails on unmatched prompts
import { z } from "zod"
import { cre, Runner, type Runtime, decodeJson } from "@chainlink/cre-sdk"

const configSchema = z.object({
  apiUrl: z.string().describe("API endpoint URL"),
  schedule: z.string().default("0 */5 * * * *").describe("Cron schedule"),
  consumerContract: z.string().describe("On-chain consumer contract address"),
})

type Config = z.infer<typeof configSchema>

const onCronTrigger = (runtime: Runtime<Config>): string => {
  const httpClient = new cre.capabilities.HTTPClient()
  const response = httpClient.sendRequest(runtime, {
    url: runtime.config.apiUrl,
    method: "GET",
  }).result()

  const data = decodeJson(response.body) as Record<string, unknown>
  runtime.log(`Fetched data: ${JSON.stringify(data)}`)

  return JSON.stringify({ timestamp: runtime.now().getTime(), data })
}

const initWorkflow = (config: Config) => {
  const cronTrigger = new cre.capabilities.CronCapability().trigger({
    schedule: config.schedule,
  })
  return [cre.handler(cronTrigger, onCronTrigger)]
}

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema })
  await runner.run(initWorkflow)
}

main()
