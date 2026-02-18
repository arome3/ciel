// Template 9: Multi-AI Consensus Oracle
// Trigger: CronCapability | Capabilities: runInNodeMode, 3x AI, BFT, writeReport

import { z } from "zod"
import {
  Runner,
  Runtime,
  CronCapability,
  ConfidentialHTTPClient,
  EVMClient,
  handler,
  getNetwork,
  consensusMedianAggregation,
} from "@chainlink/cre-sdk"
import { encodeAbiParameters, parseAbiParameters } from "viem"

const configSchema = z.object({
  queryPrompt: z.string().describe("The question/prompt to send to each AI model"),
  openaiApiKey: z.string().describe("OpenAI API key (DON secret)"),
  anthropicApiKey: z.string().describe("Anthropic API key (DON secret)"),
  geminiApiKey: z.string().describe("Google Gemini API key (DON secret)"),
  maxDeviation: z.number().default(10).describe("Maximum deviation percentage for BFT consensus"),
  consumerContract: z.string().describe("Consumer contract address"),
  chainName: z.string().default("base-sepolia").describe("Target chain"),
  cronSchedule: z.string().default("0 */10 * * * *").describe("Query interval"),
})

type Config = z.infer<typeof configSchema>

const runner = Runner.newRunner<Config>({ configSchema })

function initWorkflow(runtime: Runtime<Config>) {
  const cronTrigger = new CronCapability().trigger({
    cronSchedule: runtime.config.cronSchedule,
  })

  const confidentialClient = new ConfidentialHTTPClient()
  const evmClient = new EVMClient()

  handler(cronTrigger, (rt) => {
    // Each DON node queries AI models independently
    const nodeResult = rt.runInNodeMode((nodeRuntime) => {
      // Query OpenAI GPT-4o
      const openaiResp = confidentialClient.fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${nodeRuntime.config.openaiApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [{ role: "user", content: nodeRuntime.config.queryPrompt }],
          max_tokens: 200,
        }),
      }).result()

      // Query Anthropic Claude
      const anthropicResp = confidentialClient.fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": nodeRuntime.config.anthropicApiKey,
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          messages: [{ role: "user", content: nodeRuntime.config.queryPrompt }],
          max_tokens: 200,
        }),
      }).result()

      // Query Google Gemini
      const geminiResp = confidentialClient.fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${nodeRuntime.config.geminiApiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: nodeRuntime.config.queryPrompt }] }],
          }),
        }
      ).result()

      const openaiAnswer = JSON.parse(openaiResp.body).choices[0].message.content
      const anthropicAnswer = JSON.parse(anthropicResp.body).content[0].text
      const geminiAnswer = JSON.parse(geminiResp.body).candidates[0].content.parts[0].text

      // Extract numeric values from AI responses
      const values = [openaiAnswer, anthropicAnswer, geminiAnswer]
        .map((ans: string) => parseFloat(ans.replace(/[^0-9.]/g, "")))
        .filter((v: number) => !isNaN(v))

      // BFT consensus: reject outliers beyond max deviation
      if (values.length >= 2) {
        const sorted = values.sort((a: number, b: number) => a - b)
        const median = sorted[Math.floor(sorted.length / 2)]
        const validValues = values.filter(
          (v: number) => Math.abs(v - median) / median * 100 <= nodeRuntime.config.maxDeviation
        )
        const consensusValue = validValues.reduce((a: number, b: number) => a + b, 0) / validValues.length

        return { value: Math.round(consensusValue * 1e8), modelCount: validValues.length }
      }

      return { value: 0, modelCount: 0 }
    })

    // Write consensus result onchain
    const reportData = encodeAbiParameters(
      parseAbiParameters("uint256 value, uint256 timestamp"),
      [BigInt(nodeResult.value), BigInt(Math.floor(Date.now() / 1000))]
    )

    evmClient.writeReport({
      contractAddress: rt.config.consumerContract,
      chainSelector: getNetwork(rt.config.chainName),
      report: rt.report(reportData),
    })

    return { value: nodeResult.value, modelCount: nodeResult.modelCount }
  })

  consensusMedianAggregation({
    fields: ["value"],
    reportId: "multi_ai_consensus",
  })
}

export async function main() {
  runner.run(initWorkflow)
}
