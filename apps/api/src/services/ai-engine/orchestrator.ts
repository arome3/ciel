// ─────────────────────────────────────────────
// Orchestrator — Master AI Engine Pipeline
// ─────────────────────────────────────────────
// Wires together all 4 stages with retry, quickFix, and fallback:
//   1. parseIntent → 2. matchTemplate → 3. generateCode → 4. validate
//
// Key patterns:
//   - quickFix (v0-inspired): deterministic auto-repair before validation
//   - Cheap-first validation: fast regex checks before expensive tsc
//   - Structured error feedback: [CATEGORY] prefixed errors for LLM retries
//   - Fallback: pre-built template if all generation attempts fail
//   - Never-throw on generation path: user always receives working code
//   - Concurrency semaphore: prevents resource exhaustion from parallel requests
//   - Aggregate timeout: caps total pipeline time at 90s

import { parseIntent, type ParsedIntent } from "./intent-parser"
import { matchTemplate, getTemplateById, type TemplateMatch } from "./template-matcher"
import { generateCode } from "./code-generator"
import { validateWorkflow, quickFix, type ValidationResult } from "./validator"
import { loadTemplateFile, loadTemplateConfig, buildFallbackConfig } from "./file-manager"
import { buildFewShotContext } from "./context-builder"
import { retrieveRelevantDocs } from "./doc-retriever"
import { getContext7CREDocs } from "./context7-client"
import { AppError, ErrorCodes } from "../../types/errors"
import { db } from "../../db"
import { workflows } from "../../db/schema"

// ─────────────────────────────────────────────
// Public Interfaces
// ─────────────────────────────────────────────

export interface GenerateResult {
  workflowId: string
  code: string
  configJson: string
  explanation: string
  consumerSol: string | null
  intent: ParsedIntent
  template: TemplateMatch
  validation: ValidationResult
  fallback: boolean
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const MAX_RETRIES = 2 // Up to 3 total attempts (1 initial + 2 retries)
const PIPELINE_TIMEOUT_MS = 90_000 // 90s aggregate timeout for entire pipeline
const MAX_CONCURRENT = 3 // Max simultaneous generation pipelines

// ─────────────────────────────────────────────
// Concurrency Semaphore
// ─────────────────────────────────────────────
// Simple counting semaphore. Limits concurrent generation pipelines
// to prevent resource exhaustion (parallel LLM calls + tsc processes).

let activeCount = 0
const waitQueue: Array<() => void> = []

async function acquireSemaphore(): Promise<void> {
  if (activeCount < MAX_CONCURRENT) {
    activeCount++
    return
  }
  return new Promise<void>((resolve) => {
    waitQueue.push(() => {
      activeCount++
      resolve()
    })
  })
}

function releaseSemaphore(): void {
  if (activeCount <= 0) return // Guard against double-release
  activeCount--
  const next = waitQueue.shift()
  if (next) next()
}

// ─────────────────────────────────────────────
// DB Save Helper
// ─────────────────────────────────────────────

async function saveWorkflow(params: {
  id: string
  name: string
  description: string
  prompt: string
  templateId: number
  templateName: string
  code: string
  config: string
  consumerSol: string | null
  ownerAddress: string
  category: string
  capabilities: string
  chains: string
}): Promise<void> {
  try {
    await db.insert(workflows).values({
      id: params.id,
      name: params.name,
      description: params.description,
      prompt: params.prompt,
      templateId: params.templateId,
      templateName: params.templateName,
      code: params.code,
      config: params.config,
      consumerSol: params.consumerSol,
      ownerAddress: params.ownerAddress,
      category: params.category,
      capabilities: params.capabilities,
      chains: params.chains,
    })
  } catch (err) {
    // Log but don't throw — returning the result is more important than persistence
    console.error("[orchestrator] DB save failed:", err instanceof Error ? err.message : err)
  }
}

// ─────────────────────────────────────────────
// Fallback Builder
// ─────────────────────────────────────────────

async function buildFallback(
  intent: ParsedIntent,
  template: TemplateMatch,
  ownerAddress: string,
  prompt: string,
): Promise<GenerateResult> {
  const templateDef = getTemplateById(template.templateId)

  // Try to load pre-built template file
  let code = loadTemplateFile(template.templateId)
  let configJson = loadTemplateConfig(template.templateId)

  // If no pre-built template, fall back to template 1 (always available)
  if (!code) {
    code = loadTemplateFile(1)
    configJson = loadTemplateConfig(1)
  }

  // Build config from intent if no pre-built config
  if (!configJson && templateDef) {
    configJson = buildFallbackConfig(intent, templateDef)
  }
  if (!configJson) {
    configJson = "{}"
  }

  // Apply quickFix to the fallback code
  if (code) {
    const fixed = quickFix(code)
    code = fixed.code
  } else {
    code = "// Fallback: no pre-built template available"
  }

  // Validate the fallback
  const validation = await validateWorkflow(code, configJson)

  const workflowId = crypto.randomUUID()
  const explanation = templateDef?.defaultPromptFill?.slice(0, 500) ?? "Fallback template"

  // Save to DB
  await saveWorkflow({
    id: workflowId,
    name: `${template.templateName} — ${prompt.slice(0, 30)}`,
    description: explanation,
    prompt,
    templateId: template.templateId,
    templateName: template.templateName,
    code,
    config: configJson,
    consumerSol: null,
    ownerAddress,
    category: template.category,
    capabilities: JSON.stringify(templateDef?.requiredCapabilities ?? []),
    chains: JSON.stringify(intent.chains.length > 0 ? intent.chains : ["base-sepolia"]),
  })

  return {
    workflowId,
    code,
    configJson,
    explanation,
    consumerSol: null,
    intent,
    template,
    validation,
    fallback: true,
  }
}

// ─────────────────────────────────────────────
// Core Pipeline (inner function, no semaphore)
// ─────────────────────────────────────────────

async function runPipeline(
  prompt: string,
  ownerAddress: string,
  intent: ParsedIntent,
  template: TemplateMatch,
  signal: { aborted: boolean },
): Promise<GenerateResult> {
  const templateDef = getTemplateById(template.templateId)

  // ── Warm caches (these are module-level caches, subsequent calls are free) ──
  buildFewShotContext(template.templateId)
  if (templateDef) {
    retrieveRelevantDocs(templateDef)
  }
  await getContext7CREDocs()

  // ── Retry loop ──
  let lastError: string | undefined

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Check abort signal before expensive LLM call
    if (signal.aborted) {
      throw new AppError(ErrorCodes.AI_SERVICE_ERROR, 504, "Pipeline timed out")
    }

    try {
      // Stage 3: Code Generation
      // On retries, cap internal self-review retries to 1 to prevent
      // retry multiplication: 3 orchestrator × 3 code-gen = 9 LLM calls.
      // First attempt: full self-review (3 internal). Retries: 1 internal.
      const generated = await generateCode({
        userPrompt: prompt,
        intent,
        templateId: template.templateId,
        templateConfidence: template.confidence,
        previousError: lastError,
        maxInternalRetries: attempt === 0 ? undefined : 1,
      })

      // Check abort signal before validation
      if (signal.aborted) {
        throw new AppError(ErrorCodes.AI_SERVICE_ERROR, 504, "Pipeline timed out")
      }

      // quickFix — v0-inspired deterministic auto-repair
      const { code: fixedCode, fixes } = quickFix(generated.workflowTs)
      if (fixes.length > 0) {
        console.log(`[orchestrator] quickFix applied (attempt ${attempt + 1}):`, fixes)
      }

      const configJsonStr = JSON.stringify(generated.configJson)

      // Stage 4: Validation (cheap-first: fast regex then tsc)
      const validation = await validateWorkflow(fixedCode, configJsonStr)

      if (validation.valid) {
        // Check abort signal before DB save
        if (signal.aborted) {
          throw new AppError(ErrorCodes.AI_SERVICE_ERROR, 504, "Pipeline timed out")
        }

        // Success — save to DB and return
        const workflowId = crypto.randomUUID()

        await saveWorkflow({
          id: workflowId,
          name: `${template.templateName} — ${prompt.slice(0, 30)}`,
          description: generated.explanation.slice(0, 500),
          prompt,
          templateId: template.templateId,
          templateName: template.templateName,
          code: fixedCode,
          config: configJsonStr,
          consumerSol: generated.consumerSol ?? null,
          ownerAddress,
          category: template.category,
          capabilities: JSON.stringify(templateDef?.requiredCapabilities ?? []),
          chains: JSON.stringify(intent.chains.length > 0 ? intent.chains : ["base-sepolia"]),
        })

        return {
          workflowId,
          code: fixedCode,
          configJson: configJsonStr,
          explanation: generated.explanation,
          consumerSol: generated.consumerSol ?? null,
          intent,
          template,
          validation,
          fallback: false,
        }
      }

      // Validation failed — build structured error feedback for retry
      const structuredErrors = validation.errors
        .map((err, i) => `${i + 1}. ${err}`)
        .join("\n")

      lastError =
        `## Validation Failures (Fix ALL before responding)\n${structuredErrors}`

      console.log(
        `[orchestrator] Validation failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`,
        validation.errors.length,
        "errors",
      )
    } catch (err) {
      // Generation itself threw — capture for retry context
      if (err instanceof AppError && err.code === ErrorCodes.TEMPLATE_NOT_FOUND) {
        throw err // Don't retry template-not-found
      }
      if (err instanceof AppError && err.statusCode === 504) {
        throw err // Don't retry timeout
      }

      lastError = err instanceof Error ? err.message : String(err)
      console.error(
        `[orchestrator] Generation error (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`,
        lastError,
      )
    }
  }

  // ── All attempts exhausted — fallback to pre-built template ──
  console.log("[orchestrator] All attempts failed. Using fallback template.")
  return buildFallback(intent, template, ownerAddress, prompt)
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * Master pipeline: generates, validates, retries, and falls back.
 * Guarantees a result on the generation path — never a 500 from code generation failures.
 *
 * Guards:
 * - Concurrency semaphore (max 3 parallel pipelines)
 * - Aggregate timeout (90s — races pipeline against timer, falls back on timeout)
 * - Retry cap on code-generator (1 internal retry on orchestrator retries, prevents 9x multiplication)
 *
 * Pipeline:
 * 1. parseIntent → matchTemplate (may throw TEMPLATE_NOT_FOUND — correct, not retried)
 * 2. Warm caches: few-shot, docs, Context7
 * 3. Retry loop: generateCode → quickFix → validate → structured feedback
 * 4. Fallback to pre-built template if all attempts fail or timeout fires
 */
export async function generateWorkflow(
  prompt: string,
  ownerAddress: string,
  forceTemplateId?: number,
): Promise<GenerateResult> {
  // ── Stage 1 & 2: Intent + Template (before semaphore — fast, no I/O) ──
  const intent = parseIntent(prompt)
  const template = matchTemplate(intent, forceTemplateId)

  if (!template) {
    throw new AppError(
      ErrorCodes.TEMPLATE_NOT_FOUND,
      400,
      "Could not match your prompt to a workflow template. Try being more specific about what you want to automate.",
      {
        intent,
        suggestion:
          "Include keywords like 'price monitor', 'rebalance portfolio', 'prediction market', " +
          "'stablecoin mint', 'proof of reserve', 'fund NAV', 'parametric insurance', " +
          "'KYC compliance', 'AI consensus oracle', or 'custom data feed'.",
      },
    )
  }

  await acquireSemaphore()

  // Abort signal: set to true on timeout so runPipeline stops before expensive ops
  const signal = { aborted: false }
  const timeoutId = setTimeout(() => { signal.aborted = true }, PIPELINE_TIMEOUT_MS)

  try {
    // Race the pipeline against an aggregate timeout.
    // On timeout, we fall through to the fallback path.
    const result = await Promise.race([
      runPipeline(prompt, ownerAddress, intent, template, signal),
      new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), PIPELINE_TIMEOUT_MS),
      ),
    ])

    clearTimeout(timeoutId)

    if (result === "timeout") {
      console.warn(`[orchestrator] Pipeline timed out after ${PIPELINE_TIMEOUT_MS}ms. Using fallback.`)
      return buildFallback(intent, template, ownerAddress, prompt)
    }

    return result
  } finally {
    clearTimeout(timeoutId)
    releaseSemaphore()
  }
}
