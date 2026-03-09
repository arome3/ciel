// Template 3: AI Prediction Market Settlement
// Trigger: EVMLogCapability | Capabilities: Multi-AI, consensus

import { z } from "zod"
import { encodeAbiParameters, parseAbiParameters } from "viem"
import {
  cre,
  Runner,
  type Runtime,
  type EVMLog,
  getNetwork,
  hexToBase64,
  consensusIdenticalAggregation,
  decodeJson,
} from "@chainlink/cre-sdk"

const configSchema = z.object({
  marketContract: z.string().describe("Prediction market contract address"),
  eventSignature: z.string().default("MarketResolution(uint256,string)").describe("Event to listen for"),
  openaiApiKey: z.string().describe("OpenAI API key (stored as DON secret)"),
  anthropicApiKey: z.string().describe("Anthropic API key (stored as DON secret)"),
  geminiApiKey: z.string().describe("Gemini API key (stored as DON secret)"),
  consumerContract: z.string().describe("Consumer contract address"),
  chainSelectorName: z.string().default("ethereum-testnet-sepolia-base-1").describe("Chain to monitor"),
})

type Config = z.infer<typeof configSchema>

const onEvmLogTrigger = (runtime: Runtime<Config>, payload: EVMLog): string => {
  runtime.log("Market resolution event detected, querying AI models...")
  const confidentialClient = new cre.capabilities.ConfidentialHTTPClient()
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: runtime.config.chainSelectorName, isTestnet: true })
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

  // Query each AI model independently using node mode
  const nodeResult = runtime.runInNodeMode((nodeRuntime) => {
    const question = "Based on current verifiable data, what is the outcome?"

    // Query OpenAI
    const openaiResp = confidentialClient.sendRequest(nodeRuntime, {
      url: "https://api.openai.com/v1/chat/completions",
      method: "POST",
      headers: { "Authorization": `Bearer ${nodeRuntime.config.openaiApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: question }], max_tokens: 100 }),
    }).result()

    // Query Anthropic
    const anthropicResp = confidentialClient.sendRequest(nodeRuntime, {
      url: "https://api.anthropic.com/v1/messages",
      method: "POST",
      headers: { "x-api-key": nodeRuntime.config.anthropicApiKey, "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", messages: [{ role: "user", content: question }], max_tokens: 100 }),
    }).result()

    const openaiAnswer = decodeJson(openaiResp.body).choices[0].message.content
    const anthropicAnswer = decodeJson(anthropicResp.body).content[0].text

    return { openaiAnswer, anthropicAnswer }
  })

  // Write settlement report
  const reportData = encodeAbiParameters(
    parseAbiParameters("bool settled, uint256 timestamp"),
    [true, BigInt(Math.floor(runtime.now().getTime() / 1000))]
  )

  const report = runtime.report({
    encodedPayload: reportData,
    encoderName: "evm",
    signingAlgo: "evm",
    hashingAlgo: "keccak256",
  }).result()

  evmClient.writeReport(runtime, {
    receiver: runtime.config.consumerContract,
    report,
    gasConfig: { gasLimit: 500000 },
  }).result()

  runtime.log("Settlement report written onchain")
  return JSON.stringify({ settled: true, timestamp: runtime.now().getTime() })
}

const initWorkflow = (config: Config) => {
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: config.chainSelectorName, isTestnet: true })
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)
  const logTrigger = evmClient.logTrigger({
    contractAddress: hexToBase64(config.marketContract),
    eventSignature: config.eventSignature,
  })
  return [cre.handler(logTrigger, onEvmLogTrigger)]
}

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema })
  await runner.run(initWorkflow)
}
main()
