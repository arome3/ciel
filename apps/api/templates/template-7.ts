// Template 7: Parametric Insurance
// Trigger: CronCapability | Capabilities: HTTPClient weather, conditional payout

import { z } from "zod"
import {
  Runner,
  Runtime,
  CronCapability,
  HTTPClient,
  EVMClient,
  handler,
  getNetwork,
  consensusMedianAggregation,
} from "@chainlink/cre-sdk"
import { encodeAbiParameters, parseAbiParameters } from "viem"

const configSchema = z.object({
  weatherApiUrl: z.string().describe("Weather data API endpoint"),
  location: z.string().describe("Location for weather data (lat,lon or city)"),
  parameterName: z.string().default("rainfall").describe("Weather parameter to monitor"),
  triggerThreshold: z.number().describe("Threshold value that triggers payout"),
  triggerDirection: z.enum(["above", "below"]).describe("Trigger when parameter goes above or below threshold"),
  payoutAmount: z.number().describe("Payout amount in wei"),
  beneficiaryAddress: z.string().describe("Beneficiary wallet address"),
  consumerContract: z.string().describe("Insurance contract address"),
  chainName: z.string().default("base-sepolia").describe("Target chain"),
  cronSchedule: z.string().default("0 0 */6 * * *").describe("Check every 6 hours"),
})

type Config = z.infer<typeof configSchema>

const runner = Runner.newRunner<Config>({ configSchema })

function initWorkflow(runtime: Runtime<Config>) {
  const cronTrigger = new CronCapability().trigger({
    cronSchedule: runtime.config.cronSchedule,
  })

  const httpClient = new HTTPClient()
  const evmClient = new EVMClient()

  handler(cronTrigger, (rt) => {
    // Fetch weather data
    const weatherResp = httpClient.fetch(
      `${rt.config.weatherApiUrl}?location=${rt.config.location}&param=${rt.config.parameterName}`,
      { method: "GET", headers: { "Content-Type": "application/json" } }
    ).result()

    const weather = JSON.parse(weatherResp.body)
    const currentValue = weather[rt.config.parameterName]

    // Check parametric trigger condition
    const triggered =
      rt.config.triggerDirection === "below"
        ? currentValue < rt.config.triggerThreshold
        : currentValue > rt.config.triggerThreshold

    if (triggered) {
      // Execute automatic payout
      const reportData = encodeAbiParameters(
        parseAbiParameters("address beneficiary, uint256 amount, uint256 paramValue, uint256 timestamp"),
        [
          rt.config.beneficiaryAddress as `0x${string}`,
          BigInt(rt.config.payoutAmount),
          BigInt(Math.round(currentValue * 1e8)),
          BigInt(Math.floor(Date.now() / 1000)),
        ]
      )

      evmClient.writeReport({
        contractAddress: rt.config.consumerContract,
        chainSelector: getNetwork(rt.config.chainName),
        report: rt.report(reportData),
      })
    }

    return {
      parameterValue: Math.round(currentValue * 1e8),
      triggered: triggered ? 1 : 0,
    }
  })

  consensusMedianAggregation({
    fields: ["parameterValue"],
    reportId: "parametric_insurance",
  })
}

export async function main() {
  runner.run(initWorkflow)
}
