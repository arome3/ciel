// Template 7: Parametric Insurance
// Trigger: CronCapability | Capabilities: HTTPClient weather, conditional payout

import {
  cre,
  Runner,
  getNetwork,
  encodeAbiParameters,
  parseAbiParameters,
  type Runtime,
  type CronPayload,
} from "@chainlink/cre-sdk"
import { z } from "zod"

const configSchema = z.object({
  weatherApiUrl: z.string().describe("Weather data API endpoint"),
  location: z.string().describe("Location for weather data (lat,lon or city)"),
  parameterName: z.string().default("rainfall").describe("Weather parameter to monitor"),
  triggerThreshold: z.number().describe("Threshold value that triggers payout"),
  triggerDirection: z.enum(["above", "below"]).describe("Trigger when parameter goes above or below threshold"),
  payoutAmount: z.number().describe("Payout amount in wei"),
  beneficiaryAddress: z.string().describe("Beneficiary wallet address"),
  consumerContract: z.string().describe("Insurance contract address"),
  chainSelectorName: z.string().default("base-sepolia").describe("Target chain"),
  schedule: z.string().default("0 0 */6 * * *").describe("Check every 6 hours"),
})

type Config = z.infer<typeof configSchema>

// ─── Handler ──────────────────────────────────────────────────────────────

const onCronTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
  const httpClient = new cre.capabilities.HTTPClient()

  runtime.log("Checking weather parameter: " + runtime.config.parameterName + " at " + runtime.config.location)

  // Fetch weather data
  const weatherResp = httpClient
    .sendRequest(runtime, {
      url: `${runtime.config.weatherApiUrl}?location=${runtime.config.location}&param=${runtime.config.parameterName}`,
      method: "GET",
      headers: { "Content-Type": "application/json" },
    })
    .result()

  const weather = JSON.parse(weatherResp.body)
  const currentValue = weather[runtime.config.parameterName]

  runtime.log("Current " + runtime.config.parameterName + ": " + currentValue)

  // Check parametric trigger condition
  const triggered =
    runtime.config.triggerDirection === "below"
      ? currentValue < runtime.config.triggerThreshold
      : currentValue > runtime.config.triggerThreshold

  if (triggered) {
    runtime.log("Parametric trigger hit, executing payout to " + runtime.config.beneficiaryAddress)

    const network = getNetwork({
      chainFamily: "evm",
      chainSelectorName: runtime.config.chainSelectorName,
      isTestnet: true,
    })
    const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

    // Execute automatic payout
    const reportData = encodeAbiParameters(
      parseAbiParameters("address beneficiary, uint256 amount, uint256 paramValue, uint256 timestamp"),
      [
        runtime.config.beneficiaryAddress as `0x${string}`,
        BigInt(runtime.config.payoutAmount),
        BigInt(Math.round(currentValue * 1e8)),
        BigInt(Math.floor(runtime.now().getTime() / 1000)),
      ]
    )

    const report = runtime.report({
      encodedPayload: reportData,
      encoderName: "EVM",
      signingAlgo: "SECP256K1",
      hashingAlgo: "KECCAK256",
    }).result()

    evmClient.writeReport(runtime, {
      receiver: runtime.config.consumerContract,
      report: report.report,
      gasConfig: { gasLimit: 500000 },
    }).result()
  }

  return JSON.stringify({
    parameterValue: Math.round(currentValue * 1e8),
    triggered: triggered ? 1 : 0,
  })
}

// ─── Workflow Initialization ──────────────────────────────────────────────

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
