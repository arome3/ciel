// Template 9: Multi-AI Consensus Oracle
// Trigger: HTTP | Capabilities: runInNodeMode, 3x AI, BFT ConsensusAggregationByFields, writeReport

import {
  cre,
  Runner,
  ConsensusAggregationByFields,
  consensusIdenticalAggregation,
  consensusMedianAggregation,
  encodeAbiParameters,
  parseAbiParameters,
  type Runtime,
  type NodeRuntime,
} from "@chainlink/cre-sdk"
import { http } from "@chainlink/cre-sdk/triggers"
import { z } from "zod"

// ─── Configuration Schema ────────────────────────────────────────────────

const configSchema = z.object({
  prompt: z.string(),
  openaiModel: z.string().default("gpt-4o"),
  claudeModel: z.string().default("claude-sonnet-4-20250514"),
  geminiModel: z.string().default("gemini-1.5-pro"),
  openaiApiEndpoint: z.string().default("https://api.openai.com/v1/chat/completions"),
  evms: z.array(
    z.object({
      chainSelectorName: z.string(),
      contractAddress: z.string(),
    })
  ),
})

type Config = z.infer<typeof configSchema>

// ─── Result Types ────────────────────────────────────────────────────────

interface ModelResponse {
  answer: string
  confidence: number
  model: string
  raw?: string
}

interface ConsensusResult {
  answer: string
  agreementRatio: number
  modelsAgreed: number
  consensusReached: boolean
}

// ─── System Prompt ───────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a factual verification oracle. You will be asked a yes/no factual question.

Rules:
1. Answer ONLY "yes" or "no" (lowercase, no punctuation)
2. Base your answer on verifiable facts
3. If uncertain, answer "uncertain"
4. Return ONLY valid JSON

Return format: {"answer": "yes|no|uncertain", "confidence": 0-100}`

// ─── Response Parsers ────────────────────────────────────────────────────

/**
 * Parse GPT-4o response (uses Structured Outputs with json_schema).
 * Response shape: { choices: [{ message: { content: string } }] }
 */
function parseOpenAIResponse(responseBody: string): ModelResponse {
  const parsed = JSON.parse(responseBody)
  const content = parsed.choices?.[0]?.message?.content || "{}"
  const data = JSON.parse(content)

  return {
    answer: normalizeAnswer(data.answer || ""),
    confidence: typeof data.confidence === "number" ? data.confidence : 0,
    model: "gpt-4o",
  }
}

/**
 * Parse Claude Sonnet 4 response.
 * Response shape: { content: [{ type: "text", text: string }] }
 */
function parseClaudeResponse(responseBody: string): ModelResponse {
  const parsed = JSON.parse(responseBody)
  const textBlock = parsed.content?.find((b: any) => b.type === "text")
  const content = textBlock?.text || "{}"

  // Claude may wrap JSON in markdown code blocks
  const jsonMatch = content.match(/\{[\s\S]*\}/)
  const data = jsonMatch ? JSON.parse(jsonMatch[0]) : {}

  return {
    answer: normalizeAnswer(data.answer || ""),
    confidence: typeof data.confidence === "number" ? data.confidence : 0,
    model: "claude-sonnet-4",
  }
}

/**
 * Parse Gemini response.
 * Response shape: { candidates: [{ content: { parts: [{ text: string }] } }] }
 */
function parseGeminiResponse(responseBody: string): ModelResponse {
  const parsed = JSON.parse(responseBody)
  const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || "{}"

  // Gemini may also wrap JSON in markdown
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  const data = jsonMatch ? JSON.parse(jsonMatch[0]) : {}

  return {
    answer: normalizeAnswer(data.answer || ""),
    confidence: typeof data.confidence === "number" ? data.confidence : 0,
    model: "gemini-1.5-pro",
  }
}

/**
 * Normalize answer strings to canonical form.
 * Handles variations like "Yes", "YES", "yes.", "No", etc.
 */
function normalizeAnswer(raw: string): string {
  const cleaned = raw.toLowerCase().trim().replace(/[.,!?;:]/g, "")

  if (cleaned === "yes" || cleaned === "true" || cleaned === "affirmative") {
    return "yes"
  }
  if (cleaned === "no" || cleaned === "false" || cleaned === "negative") {
    return "no"
  }
  if (cleaned === "uncertain" || cleaned === "unknown" || cleaned === "unsure") {
    return "uncertain"
  }

  // If no match, return the cleaned string for majority comparison
  return cleaned
}

// ─── Majority Vote ───────────────────────────────────────────────────────

/**
 * Compute majority vote from model responses.
 * Requires 2/3 or 3/3 agreement to reach consensus.
 *
 * @param responses - Array of parsed model responses
 * @returns ConsensusResult with the majority answer and agreement metrics
 */
function computeMajority(responses: ModelResponse[]): ConsensusResult {
  if (responses.length === 0) {
    return { answer: "no_consensus", agreementRatio: 0, modelsAgreed: 0, consensusReached: false }
  }

  // Count occurrences of each answer
  const answerCounts = new Map<string, number>()
  for (const r of responses) {
    const count = answerCounts.get(r.answer) || 0
    answerCounts.set(r.answer, count + 1)
  }

  // Find the answer with the most votes
  let majorityAnswer = ""
  let majorityCount = 0

  for (const [answer, count] of answerCounts) {
    if (count > majorityCount) {
      majorityAnswer = answer
      majorityCount = count
    }
  }

  const totalModels = responses.length
  const agreementRatio = majorityCount / totalModels

  // Consensus requires at least 2/3 agreement
  const consensusReached = majorityCount >= 2

  return {
    answer: consensusReached ? majorityAnswer : "no_consensus",
    agreementRatio,
    modelsAgreed: majorityCount,
    consensusReached,
  }
}

// ─── Per-Node Execution (Layer 1) ────────────────────────────────────────

/**
 * Runs on EACH DON node independently.
 *
 * This function:
 * 1. Queries GPT-4o via OpenAI API
 * 2. Queries Claude Sonnet 4 via Anthropic API
 * 3. Queries Gemini via Google AI API
 * 4. Parses each response into structured format
 * 5. Computes local majority vote
 *
 * CRITICAL: No async/await — all .result() calls are synchronous.
 * CRITICAL: Secrets accessed via nodeRuntime.getSecret() only.
 */
const queryMultipleAIs = (nodeRuntime: NodeRuntime<Config>): ConsensusResult => {
  const config = nodeRuntime.getConfig()
  const httpClient = new cre.capabilities.HTTPClient()

  const responses: ModelResponse[] = []

  // ── Query 1: GPT-4o (OpenAI) ──────────────────────────────────

  try {
    const gptResponse = httpClient
      .sendRequest(nodeRuntime, {
        url: config.openaiApiEndpoint,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${nodeRuntime.getSecret("OPENAI_API_KEY")}`,
        },
        body: JSON.stringify({
          model: config.openaiModel,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: config.prompt },
          ],
          temperature: 0,
          max_tokens: 128,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "oracle_response",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  answer: {
                    type: "string",
                    enum: ["yes", "no", "uncertain"],
                  },
                  confidence: {
                    type: "number",
                    minimum: 0,
                    maximum: 100,
                  },
                },
                required: ["answer", "confidence"],
                additionalProperties: false,
              },
            },
          },
        }),
      })
      .result()

    if (gptResponse.statusCode !== 200) {
      throw new Error(`OpenAI returned ${gptResponse.statusCode}`)
    }
    responses.push(parseOpenAIResponse(gptResponse.body))
  } catch {
    responses.push({ answer: "error", confidence: 0, model: "gpt-4o" })
  }

  // ── Query 2: Claude Sonnet 4 (Anthropic) ───────────────────────

  try {
    const claudeResponse = httpClient
      .sendRequest(nodeRuntime, {
        url: "https://api.anthropic.com/v1/messages",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": nodeRuntime.getSecret("ANTHROPIC_API_KEY"),
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: config.claudeModel,
          max_tokens: 256,
          temperature: 0,
          messages: [
            {
              role: "user",
              content: `${SYSTEM_PROMPT}\n\nQuestion: ${config.prompt}`,
            },
          ],
        }),
      })
      .result()

    if (claudeResponse.statusCode !== 200) {
      throw new Error(`Anthropic returned ${claudeResponse.statusCode}`)
    }
    responses.push(parseClaudeResponse(claudeResponse.body))
  } catch {
    responses.push({ answer: "error", confidence: 0, model: "claude-sonnet-4" })
  }

  // ── Query 3: Gemini (Google AI) ────────────────────────────────

  try {
    const geminiResponse = httpClient
      .sendRequest(nodeRuntime, {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": nodeRuntime.getSecret("GEMINI_API_KEY"),
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `${SYSTEM_PROMPT}\n\nQuestion: ${config.prompt}`,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 128,
            responseMimeType: "application/json",
          },
        }),
      })
      .result()

    if (geminiResponse.statusCode !== 200) {
      throw new Error(`Gemini returned ${geminiResponse.statusCode}`)
    }
    responses.push(parseGeminiResponse(geminiResponse.body))
  } catch {
    responses.push({ answer: "error", confidence: 0, model: "gemini-1.5-pro" })
  }

  // ── Compute local majority vote ────────────────────────────────

  const result = computeMajority(responses)
  if (result.answer === "error") {
    return { answer: "no_consensus", agreementRatio: 0, modelsAgreed: 0, consensusReached: false }
  }
  return result
}

// ─── Main Handler (Layer 2 — BFT Consensus) ──────────────────────────────

/**
 * Main HTTP trigger handler.
 *
 * Uses runtime.runInNodeMode to:
 * 1. Execute queryMultipleAIs on each DON node independently
 * 2. Apply ConsensusAggregationByFields to verify cross-node agreement:
 *    - answer: identicalAggregation (all nodes must report the same answer)
 *    - agreementRatio: medianAggregation (take the median ratio)
 *    - modelsAgreed: medianAggregation (take the median count)
 *    - consensusReached: identicalAggregation (all nodes must agree on consensus status)
 */
const onHttpTrigger = (runtime: Runtime<Config>): string => {
  const verifiedResult = runtime
    .runInNodeMode(
      queryMultipleAIs,
      ConsensusAggregationByFields<ConsensusResult>({
        answer: consensusIdenticalAggregation(),
        agreementRatio: consensusMedianAggregation(),
        modelsAgreed: consensusMedianAggregation(),
        consensusReached: consensusIdenticalAggregation(),
      })
    )()
    .result()

  // Check if cross-node consensus was reached
  if (!verifiedResult.consensusReached) {
    return JSON.stringify({
      success: false,
      reason: "consensus_not_reached",
      details:
        "The DON nodes could not reach BFT consensus. Either the AI models disagreed, or nodes produced different results.",
    })
  }

  // Write result onchain via EVM client
  const config = runtime.getConfig()
  if (config.evms && config.evms.length > 0) {
    const evmClient = new cre.capabilities.EVMClient()

    for (const evm of config.evms) {
      evmClient.writeReport(runtime, {
        chainSelectorName: evm.chainSelectorName,
        contractAddress: evm.contractAddress,
        data: encodeAbiParameters(
          parseAbiParameters("string,uint256,uint256"),
          [verifiedResult.answer, Math.round(verifiedResult.agreementRatio * 1000), verifiedResult.modelsAgreed]
        ),
      }).result()
    }
  }

  return JSON.stringify({
    success: true,
    answer: verifiedResult.answer,
    confidence: verifiedResult.agreementRatio,
    modelsAgreed: verifiedResult.modelsAgreed,
    consensusReached: verifiedResult.consensusReached,
  })
}

// ─── Workflow Initialization ─────────────────────────────────────────────

function initWorkflow(config: Config) {
  return [cre.handler(http.trigger(), onHttpTrigger)]
}

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema })
  await runner.run(initWorkflow)
}

main()
