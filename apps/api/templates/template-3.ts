// Template 3: AI Prediction Market Settlement
// Trigger: EVMLogCapability | Capabilities: Multi-AI, consensus

import { z } from "zod"
import {
  Runner,
  Runtime,
  EVMLogCapability,
  ConfidentialHTTPClient,
  EVMClient,
  handler,
  getNetwork,
  consensusIdenticalAggregation,
} from "@chainlink/cre-sdk"
import { encodeAbiParameters, parseAbiParameters } from "viem"

const configSchema = z.object({
  marketContract: z.string().describe("Prediction market contract address"),
  eventSignature: z.string().default("MarketResolution(uint256,string)").describe("Event to listen for"),
  openaiApiKey: z.string().describe("OpenAI API key (stored as DON secret)"),
  anthropicApiKey: z.string().describe("Anthropic API key (stored as DON secret)"),
  geminiApiKey: z.string().describe("Gemini API key (stored as DON secret)"),
  consumerContract: z.string().describe("Consumer contract address"),
  chainName: z.string().default("base-sepolia").describe("Chain to monitor"),
})

type Config = z.infer<typeof configSchema>

const runner = Runner.newRunner<Config>({ configSchema })

function initWorkflow(runtime: Runtime<Config>) {
  const logTrigger = new EVMLogCapability().trigger({
    contractAddress: runtime.config.marketContract,
    eventSignature: runtime.config.eventSignature,
    chainSelector: getNetwork(runtime.config.chainName),
  })

  const confidentialClient = new ConfidentialHTTPClient()
  const evmClient = new EVMClient()

  handler(logTrigger, (rt) => {
    // Query each AI model independently using node mode
    const nodeResult = rt.runInNodeMode((nodeRuntime) => {
      const question = "Based on current verifiable data, what is the outcome?"

      // Query OpenAI
      const openaiResp = confidentialClient.fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${nodeRuntime.config.openaiApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: question }], max_tokens: 100 }),
      }).result()

      // Query Anthropic
      const anthropicResp = confidentialClient.fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": nodeRuntime.config.anthropicApiKey, "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", messages: [{ role: "user", content: question }], max_tokens: 100 }),
      }).result()

      const openaiAnswer = JSON.parse(openaiResp.body).choices[0].message.content
      const anthropicAnswer = JSON.parse(anthropicResp.body).content[0].text

      return { openaiAnswer, anthropicAnswer }
    })

    // Write settlement report
    const reportData = encodeAbiParameters(
      parseAbiParameters("bool settled, uint256 timestamp"),
      [true, BigInt(Math.floor(Date.now() / 1000))]
    )

    evmClient.writeReport({
      contractAddress: rt.config.consumerContract,
      chainSelector: getNetwork(rt.config.chainName),
      report: rt.report(reportData),
    })

    return { settled: true, timestamp: Date.now() }
  })

  consensusIdenticalAggregation({
    fields: ["settled"],
    reportId: "market_settlement",
  })
}

export async function main() {
  runner.run(initWorkflow)
}
