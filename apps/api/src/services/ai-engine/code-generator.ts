// ─────────────────────────────────────────────
// Code Generator — Stage 3 of the AI Engine Pipeline
// ─────────────────────────────────────────────
// Receives a matched template + parsed intent from stages 1-2,
// calls GPT-5.2 with Structured Outputs, and returns complete
// CRE TypeScript workflow code.

import OpenAI from "openai"
import { z } from "zod"
import { zodResponseFormat } from "openai/helpers/zod"
import { config } from "../../config"
import { AppError, ErrorCodes } from "../../types/errors"
import type { ParsedIntent } from "./types"
import { getTemplateById, type TemplateDefinition } from "./template-matcher"
import { getContext7CREDocs } from "./context7-client"
import { retrieveRelevantDocs } from "./doc-retriever"
import { buildFewShotContext } from "./context-builder"
import { buildSystemPrompt } from "./prompts/system"
import { buildGenerationPrompt, type GenerationPromptInput } from "./prompts/generation"

// ─────────────────────────────────────────────
// Response Schema (Structured Outputs)
// ─────────────────────────────────────────────

const CREWorkflowResponseSchema = z.object({
  // Chain-of-thought: forces GPT-5.2 to reason before coding
  thinking: z.string().describe(
    "Step-by-step reasoning: which CRE SDK patterns apply, which trigger to use, " +
    "what capabilities are needed, how config maps to the user request",
  ),
  workflow_ts: z.string().describe("Complete CRE TypeScript workflow code"),
  config_json: z.string().describe("Stringified JSON config matching the Zod schema"),
  consumer_sol: z.string().nullable().describe("Solidity consumer contract, or null"),
  // Self-review: model checks its own output against constraints
  self_review: z.string().describe(
    "Verify: no async/await in callbacks, only @chainlink/cre-sdk + zod + viem imports, " +
    "uses Runner.newRunner pattern, handler() wiring, config accessed via runtime.config",
  ),
  explanation: z.string().describe("Human-readable explanation of what the workflow does"),
})

// ─────────────────────────────────────────────
// Public Interfaces
// ─────────────────────────────────────────────

export interface GenerateCodeInput {
  /** Original user prompt */
  userPrompt: string
  /** Parsed intent from stage 1 */
  intent: ParsedIntent
  /** Template match from stage 2 */
  templateId: number
  /** Template confidence from stage 2 */
  templateConfidence: number
  /** Validation errors from orchestrator retry (structured [CATEGORY] format) */
  previousError?: string
  /** Override internal self-review retry count (default: MAX_RETRIES).
   *  When the orchestrator already handles retries, this should be 1 to avoid
   *  multiplication: 3 orchestrator × 3 code-gen = 9 LLM calls worst case. */
  maxInternalRetries?: number
}

export interface GeneratedCode {
  /** Complete CRE TypeScript workflow code */
  workflowTs: string
  /** Config JSON matching the Zod schema */
  configJson: Record<string, unknown>
  /** Solidity consumer contract, or null */
  consumerSol: string | null
  /** Human-readable explanation */
  explanation: string
}

// ─────────────────────────────────────────────
// OpenAI Client (lazy singleton)
// ─────────────────────────────────────────────

let openaiClient: OpenAI | null = null

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: config.OPENAI_API_KEY,
      timeout: 30_000,   // 30s per-request timeout — prevents hanging on GPT-5.2 stalls
      maxRetries: 2,     // OpenAI SDK auto-retries on 429/500/503
    })
  }
  return openaiClient
}

/** @internal Test-only: reset lazy singleton so mock.module changes take effect */
export function _resetOpenAIClient(): void {
  openaiClient = null
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const MODEL = "gpt-5.2"
const MAX_COMPLETION_TOKENS = 16_384
const MAX_RETRIES = 3  // 1 initial + 2 retries (self-review or error-driven)

// Self-review red flag patterns that trigger auto-retry.
// Each pattern requires BOTH a violation keyword AND a negative-sentiment context word
// to avoid false-positives like "no async issues found" matching "async".
const SELF_REVIEW_RED_FLAG_PATTERNS: Array<{ keyword: RegExp; sentiment: RegExp }> = [
  { keyword: /async\/await/i, sentiment: /found|detected|uses|contains|has|violation|issue|bug/i },
  { keyword: /getConfig/i, sentiment: /uses|found|calls|invokes|still/i },
  { keyword: /missing\s+(Runner|handler|export|main)/i, sentiment: /./i },  // "missing X" is always negative
  { keyword: /wrong\s+import/i, sentiment: /./i },
  { keyword: /does\s+not\s+compile/i, sentiment: /./i },
  { keyword: /invalid\s+import/i, sentiment: /./i },
  { keyword: /import\s+from\s+["'][^"']*["']/i, sentiment: /unauthorized|invalid|wrong|disallowed/i },
]

// ─────────────────────────────────────────────
// Core Generator
// ─────────────────────────────────────────────

/**
 * Generates CRE workflow code using GPT-5.2 with Structured Outputs.
 *
 * Pipeline:
 * 1. Load template definition
 * 2. Assemble context: few-shot examples + SDK docs + Context7
 * 3. Build system prompt (static constraints + dynamic context)
 * 4. Build user prompt (intent + template + retry context)
 * 5. Call GPT-5.2 with zodResponseFormat + CoT + self-review
 * 6. Validate response, auto-retry on self-review red flags
 * 7. Parse config JSON, return GeneratedCode
 *
 * @param input - The generation input from stages 1-2
 * @returns Generated CRE workflow code, config, and explanation
 * @throws AppError with AI_SERVICE_ERROR on failure
 */
export async function generateCode(input: GenerateCodeInput): Promise<GeneratedCode> {
  // ── Load template ──
  const template = getTemplateById(input.templateId)
  if (!template) {
    throw new AppError(
      ErrorCodes.AI_SERVICE_ERROR,
      502,
      `Template ${input.templateId} not found during code generation`,
    )
  }

  // ── Assemble context (parallel where possible) ──
  const [context7Docs, fewShotContext, relevantDocs] = await Promise.all([
    getContext7CREDocs(),
    Promise.resolve(buildFewShotContext(input.templateId)),
    Promise.resolve(retrieveRelevantDocs(template)),
  ])

  // ── Build system prompt ──
  const systemPrompt = buildSystemPrompt(fewShotContext, relevantDocs, context7Docs)

  // ── Retry loop ──
  const maxRetries = input.maxInternalRetries ?? MAX_RETRIES
  let lastError: string | undefined = input.previousError
  let lastSelfReview: string | undefined

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await callGPT52(
        systemPrompt,
        input,
        template,
        attempt,
        lastError,
        lastSelfReview,
      )

      // ── Check self-review for red flags ──
      if (attempt < maxRetries && hasRedFlags(result.self_review)) {
        lastSelfReview = result.self_review
        lastError = "Self-review identified constraint violations. See previous self-review."
        continue
      }

      // ── Parse config JSON ──
      let configJson: Record<string, unknown>
      try {
        configJson = JSON.parse(result.config_json) as Record<string, unknown>
      } catch {
        // If config JSON is invalid, use empty object rather than failing
        configJson = {}
      }

      return {
        workflowTs: result.workflow_ts,
        configJson,
        consumerSol: result.consumer_sol,
        explanation: result.explanation,
      }
    } catch (err) {
      if (err instanceof AppError) throw err

      // Capture error for retry context
      lastError = err instanceof Error ? err.message : String(err)

      if (attempt === maxRetries) {
        throw new AppError(
          ErrorCodes.AI_SERVICE_ERROR,
          502,
          `Code generation failed after ${maxRetries} attempts: ${lastError}`,
        )
      }
    }
  }

  // Unreachable, but TypeScript needs it
  throw new AppError(
    ErrorCodes.AI_SERVICE_ERROR,
    502,
    "Code generation failed: exhausted all retry attempts",
  )
}

// ─────────────────────────────────────────────
// GPT-5.2 API Call
// ─────────────────────────────────────────────

async function callGPT52(
  systemPrompt: string,
  input: GenerateCodeInput,
  template: TemplateDefinition,
  attempt: number,
  previousError?: string,
  previousSelfReview?: string,
): Promise<z.infer<typeof CREWorkflowResponseSchema>> {
  const openai = getOpenAIClient()

  // Build user prompt
  const promptInput: GenerationPromptInput = {
    userPrompt: input.userPrompt,
    intent: input.intent,
    template,
    previousError,
    previousSelfReview,
  }
  const userPrompt = buildGenerationPrompt(promptInput)

  // GPT-5.2: reasoning_effort replaces temperature
  // "medium" for first attempt (balanced), "high" for retries (deeper reasoning)
  const reasoningEffort = attempt === 1 ? "medium" : "high"

  const completion = await openai.chat.completions.parse({
    model: MODEL,
    reasoning_effort: reasoningEffort as "medium" | "high",
    max_completion_tokens: MAX_COMPLETION_TOKENS,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: zodResponseFormat(CREWorkflowResponseSchema, "cre_workflow"),
  })

  const message = completion.choices[0]?.message

  // ── Handle refusal ──
  if (message?.refusal) {
    throw new AppError(
      ErrorCodes.AI_SERVICE_ERROR,
      502,
      `Model refused to generate code: ${message.refusal}`,
    )
  }

  // ── Extract parsed response ──
  const parsed = message?.parsed
  if (!parsed) {
    throw new AppError(
      ErrorCodes.AI_SERVICE_ERROR,
      502,
      "Empty response from code generation model",
    )
  }

  // ── Validate non-empty workflow ──
  if (!parsed.workflow_ts || parsed.workflow_ts.trim().length === 0) {
    throw new AppError(
      ErrorCodes.AI_SERVICE_ERROR,
      502,
      "Model returned empty workflow code",
    )
  }

  return parsed
}

// ─────────────────────────────────────────────
// Self-Review Analysis
// ─────────────────────────────────────────────

/**
 * Checks self-review text for red flags indicating constraint violations.
 * Uses keyword + sentiment matching to avoid false-positives like
 * "no async issues found" triggering on the word "async".
 */
function hasRedFlags(selfReview: string): boolean {
  return SELF_REVIEW_RED_FLAG_PATTERNS.some(
    ({ keyword, sentiment }) => keyword.test(selfReview) && sentiment.test(selfReview),
  )
}
