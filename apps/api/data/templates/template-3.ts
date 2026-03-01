// Template 3: AI Prediction Market Settlement
// Trigger: EVMLogCapability | Capabilities: Multi-AI, consensus

import {
  cre,
  Runner,
  getNetwork,
  encodeAbiParameters,
  parseAbiParameters,
  type Runtime,
  type EVMLog,
} from "@chainlink/cre-sdk"
import { z } from "zod"

const configSchema = z.object({
  marketContract: z.string().describe("Prediction market contract address"),
  eventSignature: z.string().default("MarketResolution(uint256,string)").describe("Event to listen for"),
  openaiApiKey: z.string().describe("OpenAI API key (stored as DON secret)"),
  anthropicApiKey: z.string().describe("Anthropic API key (stored as DON secret)"),
  geminiApiKey: z.string().describe("Gemini API key (stored as DON secret)"),
  consumerContract: z.string().describe("Consumer contract address"),
  chainSelectorName: z.string().default("base-sepolia").describe("Chain to monitor"),
})

type Config = z.infer<typeof configSchema>

// ─── Handler ──────────────────────────────────────────────────────────────

const onEvmLogTrigger = (runtime: Runtime<Config>, log: EVMLog): string => {
  const httpClient = new cre.capabilities.HTTPClient()

  runtime.log("Market resolution event detected, querying AI models")

  // Query each AI model independently using node mode
  const nodeResult = runtime.runInNodeMode((nodeRuntime) => {
    const question = "Based on current verifiable data, what is the outcome?"

    // Query OpenAI
    const openaiResp = httpClient
      .sendRequest(nodeRuntime, {
        url: "https://api.openai.com/v1/chat/completions",
        method: "POST",
        headers: {
          "Authorization": `Bearer ${nodeRuntime.getSecret("OPENAI_API_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [{ role: "user", content: question }],
          max_tokens: 100,
        }),
      })
      .result()

    // Query Anthropic
    const anthropicResp = httpClient
      .sendRequest(nodeRuntime, {
        url: "https://api.anthropic.com/v1/messages",
        method: "POST",
        headers: {
          "x-api-key": nodeRuntime.getSecret("ANTHROPIC_API_KEY"),
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          messages: [{ role: "user", content: question }],
          max_tokens: 100,
        }),
      })
      .result()

    const openaiAnswer = JSON.parse(openaiResp.body).choices[0].message.content
    const anthropicAnswer = JSON.parse(anthropicResp.body).content[0].text

    return { openaiAnswer, anthropicAnswer }
  })

  runtime.log("AI models queried, writing settlement report")

  // Write settlement report
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.chainSelectorName,
    isTestnet: true,
  })
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  const reportData = encodeAbiParameters(
    parseAbiParameters("bool settled, uint256 timestamp"),
    [true, BigInt(Math.floor(runtime.now().getTime() / 1000))]
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

  return JSON.stringify({ settled: true, timestamp: runtime.now().getTime() })
}

// ─── Workflow Initialization ──────────────────────────────────────────────

const initWorkflow = (config: Config) => {
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: config.chainSelectorName,
    isTestnet: true,
  })
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  const logTrigger = evmClient.logTrigger({
    contractAddress: config.marketContract,
    eventSignature: config.eventSignature,
  })

  return [cre.handler(logTrigger, onEvmLogTrigger)]
}

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema })
  await runner.run(initWorkflow)
}

main()
