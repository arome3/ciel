// ─────────────────────────────────────────────
// Code Generator — Stage 3 of the AI Engine Pipeline
// ─────────────────────────────────────────────
// Receives a matched template + parsed intent from stages 1-2,
// calls GPT-5.3-Codex with Structured Outputs, and returns complete
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
import { detectStateKeyword } from "./file-manager"

// ─────────────────────────────────────────────
// Response Schema (Structured Outputs)
// ─────────────────────────────────────────────

/** Structured self-review — boolean checklist replaces free-text regex parsing */
const SelfReviewSchema = z.object({
  no_async_in_handlers: z.boolean().describe("True if handler callbacks contain NO async/await"),
  imports_valid: z.boolean().describe("True if ONLY @chainlink/cre-sdk, zod, viem, @noble/hashes are imported"),
  uses_runner_pattern: z.boolean().describe("True if code uses await Runner.newRunner<Config>({ configSchema })"),
  uses_cre_handler: z.boolean().describe("True if code uses cre.handler() to wire triggers"),
  config_via_runtime: z.boolean().describe("True if config is accessed via runtime.config (NOT getConfig())"),
  no_nondeterminism: z.boolean().describe("True if no Date.now(), new Date(), Math.random(), setTimeout used"),
  implements_user_request: z.boolean().describe("True if the code implements what the user asked for"),
  issues_found: z.string().describe("Description of any issues found, or empty string if none"),
})

const CREWorkflowResponseSchema = z.object({
  // Chain-of-thought: forces GPT-5.3-Codex to reason before coding
  thinking: z.string().describe(
    "Step-by-step reasoning: which CRE SDK patterns apply, which trigger to use, " +
    "what capabilities are needed, how config maps to the user request",
  ),
  workflow_ts: z.string().describe("Complete CRE TypeScript workflow code"),
  config_json: z.string().describe("Stringified JSON config matching the Zod schema"),
  consumer_sol: z.string().nullable().describe("Solidity consumer contract, or null"),
  // Structured self-review: boolean checklist replaces free-text for reliable red flag detection
  self_review: SelfReviewSchema.describe(
    "After generating code, verify each constraint. Set boolean to true ONLY if the constraint is satisfied. " +
    "Describe any issues in issues_found.",
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
      timeout: 30_000,   // 30s per-request timeout — prevents hanging on GPT-5.3-Codex stalls
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

const MODEL = "gpt-5.3-codex"
const MAX_COMPLETION_TOKENS = 16_384
const MAX_RETRIES = 3  // 1 initial + 2 retries (self-review or error-driven)

/** Self-review type for structured boolean checks */
type SelfReview = z.infer<typeof SelfReviewSchema>

// ─────────────────────────────────────────────
// Core Generator
// ─────────────────────────────────────────────

/**
 * Generates CRE workflow code using GPT-5.3-Codex with Structured Outputs.
 *
 * Pipeline:
 * 1. Load template definition
 * 2. Assemble context: few-shot examples + SDK docs + Context7
 * 3. Build system prompt (static constraints + dynamic context)
 * 4. Build user prompt (intent + template + retry context)
 * 5. Call GPT-5.3-Codex with zodResponseFormat + CoT + self-review
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

  // ── Compute state detection for conditional prompt/docs ──
  const needsState = detectStateKeyword(input.intent.keywords) !== null

  // ── Assemble context (parallel where possible) ──
  const [context7Docs, fewShotContext, relevantDocs] = await Promise.all([
    getContext7CREDocs(),
    Promise.resolve(buildFewShotContext(input.templateId)),
    Promise.resolve(retrieveRelevantDocs(template, input.intent)),
  ])

  // ── Build system prompt ──
  const systemPrompt = buildSystemPrompt(fewShotContext, relevantDocs, context7Docs, needsState, template.requiredCapabilities)

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

      // ── Check self-review for red flags (structured boolean checks) ──
      if (attempt < maxRetries && hasRedFlags(result.self_review)) {
        lastSelfReview = formatSelfReview(result.self_review)
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
// GPT-5.3-Codex API Call
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

  // GPT-5.3-Codex: reasoning_effort replaces temperature
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
// Self-Review Analysis (Structured)
// ─────────────────────────────────────────────

/**
 * Checks structured self-review for red flags.
 * Any boolean field set to false indicates a constraint violation.
 * No regex parsing — direct boolean checks eliminate false positives.
 */
function hasRedFlags(selfReview: SelfReview): boolean {
  return (
    !selfReview.no_async_in_handlers ||
    !selfReview.imports_valid ||
    !selfReview.uses_runner_pattern ||
    !selfReview.uses_cre_handler ||
    !selfReview.config_via_runtime ||
    !selfReview.no_nondeterminism ||
    !selfReview.implements_user_request
  )
}

/**
 * Formats structured self-review into a string for retry context.
 */
function formatSelfReview(selfReview: SelfReview): string {
  const failures: string[] = []
  if (!selfReview.no_async_in_handlers) failures.push("async/await found in handler callbacks")
  if (!selfReview.imports_valid) failures.push("invalid imports detected")
  if (!selfReview.uses_runner_pattern) failures.push("missing Runner.newRunner pattern")
  if (!selfReview.uses_cre_handler) failures.push("missing cre.handler() wiring")
  if (!selfReview.config_via_runtime) failures.push("config not accessed via runtime.config")
  if (!selfReview.no_nondeterminism) failures.push("non-deterministic patterns detected")
  if (!selfReview.implements_user_request) failures.push("does not implement user request")
  if (selfReview.issues_found) failures.push(selfReview.issues_found)
  return failures.join("; ")
}
