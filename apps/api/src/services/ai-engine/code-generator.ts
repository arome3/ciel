// ─────────────────────────────────────────────
// Code Generator — Stage 3 of the AI Engine Pipeline
// ─────────────────────────────────────────────
// Receives a matched template + parsed intent from stages 1-2,
// calls GPT-5.3-Codex with Structured Outputs, and returns complete
// CRE TypeScript workflow code.

import OpenAI from "openai"
import { z } from "zod"
import { zodTextFormat } from "openai/helpers/zod"
import { config } from "../../config"
import { AppError, ErrorCodes } from "../../types/errors"
import type { ParsedIntent } from "./types"
import { getTemplateById, type TemplateDefinition } from "./template-matcher"
import { buildFewShotContext } from "./context-builder"
import { buildStaticBase, buildTemplateContext } from "./prompts/system"
import { buildGenerationPrompt, type GenerationPromptInput } from "./prompts/generation"
import { detectStateKeyword, loadTemplateConfig } from "./file-manager"
import { createLogger } from "../../lib/logger"

const log = createLogger("CodeGen")

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
  /** Fix patterns + compiler output from error-resolver (enriches retry context) */
  enrichedContext?: string
  /** Supplementary CRE SDK docs from doc-retriever (low-overlap .md files only) */
  relevantDocs?: string
  /** Refinement mode: existing code to modify */
  previousCode?: string
  /** Refinement mode: existing config to modify */
  previousConfig?: string
  /** Refinement mode: the change request */
  refinementPrompt?: string
  /** Refinement mode: brief list of prior refinement prompts */
  priorRefinements?: string[]
}

export interface GeneratedCodeTokenUsage {
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cachedTokens: number
  totalTokens: number
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
  /** Token usage from OpenAI response (if available) */
  tokenUsage?: GeneratedCodeTokenUsage
  /** Duration of the code generation LLM call in ms */
  codeGenDurationMs?: number
  /** Reasoning effort used for this call */
  reasoningEffort?: string
}

// ─────────────────────────────────────────────
// OpenAI Client (lazy singleton)
// ─────────────────────────────────────────────

let openaiClient: OpenAI | null = null

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: config.OPENAI_API_KEY,
      timeout: 300_000,  // 5min per-request — reasoning models need 60-120s for complex prompts
      maxRetries: 1,     // 1 retry on transient failures (429/500/503), not more
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
 * Layered prompt architecture for optimal latency and cost:
 * 1. Load template definition
 * 2. Build Layer 1 (static base) — identical every request, maximizes prompt caching
 * 3. Build Layer 2 (template context) — only relevant patterns + few-shot examples
 * 4. Build user prompt (intent + template + retry context)
 * 5. Call GPT-5.3-Codex with zodTextFormat + CoT + self-review
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

  // ── For wildcard: override trigger type from intent (more accurate than default "cron") ──
  const effectiveTemplate = template.id === 0 && input.intent.triggerType !== "unknown"
    ? { ...template, triggerType: input.intent.triggerType as "cron" | "http" | "evm_log" }
    : template

  // ── Build layered prompt ──
  // Merge template capabilities with intent-detected capabilities so that
  // pattern guidance fires for user-requested features even when the matched
  // template doesn't declare them (e.g. "rebalance via CCIP" → T2 + CCIP pattern)
  const intentCaps = [...input.intent.dataSources, ...input.intent.actions]
  const mergedCaps = [...new Set([...effectiveTemplate.requiredCapabilities, ...intentCaps])]
  const needsState = detectStateKeyword(input.intent.keywords) !== null
  const fewShotContext = buildFewShotContext(input.templateId)
  const staticBase = buildStaticBase()
  const templateContext = buildTemplateContext(
    mergedCaps,
    needsState,
    fewShotContext,
    input.relevantDocs,
    effectiveTemplate.id,
  )

  // ── Retry loop ──
  const maxRetries = input.maxInternalRetries ?? MAX_RETRIES
  let lastError: string | undefined = input.previousError
  let lastSelfReview: string | undefined

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { parsed: result, tokenUsage, durationMs, reasoningEffort } = await callGPT52(
        staticBase,
        templateContext,
        input,
        effectiveTemplate,
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
        tokenUsage,
        codeGenDurationMs: durationMs,
        reasoningEffort,
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
// GPT-5.3-Codex API Call (Responses API)
// ─────────────────────────────────────────────

async function callGPT52(
  staticBase: string,
  templateContext: string,
  input: GenerateCodeInput,
  template: TemplateDefinition,
  attempt: number,
  previousError?: string,
  previousSelfReview?: string,
): Promise<{
  parsed: z.infer<typeof CREWorkflowResponseSchema>
  tokenUsage?: GeneratedCodeTokenUsage
  durationMs: number
  reasoningEffort: string
}> {
  const openai = getOpenAIClient()

  // Build user prompt
  const canonicalConfig = loadTemplateConfig(input.templateId)
  const promptInput: GenerationPromptInput = {
    userPrompt: input.userPrompt,
    intent: input.intent,
    template,
    previousError,
    previousSelfReview,
    enrichedContext: input.enrichedContext,
    canonicalConfig,
    previousCode: input.previousCode,
    previousConfig: input.previousConfig,
    refinementPrompt: input.refinementPrompt,
    priorRefinements: input.priorRefinements,
  }
  const userPrompt = buildGenerationPrompt(promptInput)

  // Refinement: "medium" on first attempt (strong context), "high" on retries
  // Generation: "medium" for first attempt (balanced), "high" for retries or wildcard
  const isWildcard = input.templateId === 0
  const isRefinement = !!input.previousCode
  const reasoningEffort = isRefinement
    ? (attempt > 1 ? "high" : "medium")
    : ((isWildcard || attempt > 1) ? "high" : "medium")

  // Layered instructions: static base (cached by OpenAI) + template-specific context
  const instructions = templateContext
    ? `${staticBase}\n\n${templateContext}`
    : staticBase

  const instrLen = Math.round(instructions.length / 1024)
  const baseLen = Math.round(staticBase.length / 1024)
  const ctxLen = Math.round(templateContext.length / 1024)
  const inputLen = Math.round(userPrompt.length / 1024)
  log.info(`Attempt ${attempt}: base=${baseLen}KB ctx=${ctxLen}KB total=${instrLen}KB input=${inputLen}KB effort=${reasoningEffort}`)

  const t0 = Date.now()

  // web_search: lets the LLM search for CRE SDK docs, Chainlink documentation,
  // and code examples during generation. Falls back to no-tools on unsupported models.
  let response
  try {
    response = await openai.responses.parse({
      model: MODEL,
      reasoning: { effort: reasoningEffort as "medium" | "high" },
      max_output_tokens: MAX_COMPLETION_TOKENS,
      instructions,
      input: userPrompt,
      text: {
        format: zodTextFormat(CREWorkflowResponseSchema, "cre_workflow"),
      },
      tools: [{ type: "web_search_preview" as const }],
    })
  } catch (toolErr) {
    // web_search not supported for this model — retry without tools
    log.info(`web_search not supported, falling back: ${(toolErr as Error).message?.slice(0, 100)}`)
    response = await openai.responses.parse({
      model: MODEL,
      reasoning: { effort: reasoningEffort as "medium" | "high" },
      max_output_tokens: MAX_COMPLETION_TOKENS,
      instructions,
      input: userPrompt,
      text: {
        format: zodTextFormat(CREWorkflowResponseSchema, "cre_workflow"),
      },
    })
  }

  const durationMs = Date.now() - t0
  log.info(`Response received in ${durationMs}ms`)

  // ── Extract token usage from response ──
  let tokenUsage: GeneratedCodeTokenUsage | undefined
  const usage = (response as any).usage
  if (usage) {
    tokenUsage = {
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? 0,
      cachedTokens: usage.input_tokens_details?.cached_tokens ?? 0,
      totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
    }
  }

  // ── Handle refusal ──
  const outputMessage = response.output.find((o) => o.type === "message")
  if (outputMessage && "content" in outputMessage) {
    const refusal = outputMessage.content.find((c) => c.type === "refusal")
    if (refusal && "refusal" in refusal) {
      throw new AppError(
        ErrorCodes.AI_SERVICE_ERROR,
        502,
        `Model refused to generate code: ${refusal.refusal}`,
      )
    }
  }

  // ── Extract parsed response ──
  const parsed = response.output_parsed
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

  return { parsed, tokenUsage, durationMs, reasoningEffort }
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
