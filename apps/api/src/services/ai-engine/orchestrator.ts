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
import { warmEmbeddingCache } from "./embedding-matcher"
import { generateCode } from "./code-generator"
import { validateWorkflow, quickFix, normalizeConfigKeys, extractSecretNames, buildSecretsYaml, type ValidationResult } from "./validator"
import { loadTemplateFile, loadTemplateConfig, loadTemplateSchemas, buildFallbackConfig } from "./file-manager"
import { buildFewShotContext } from "./context-builder"
import { retrieveRelevantDocs } from "./doc-retriever"
import { getContext7CREDocs } from "./context7-client"
import { compileCheck } from "./compile-feedback"
import { resolveErrors, getFixPatternsForCategories, getPreSeedCategories } from "./error-resolver"
import { AppError, ErrorCodes } from "../../types/errors"
import { createLogger } from "../../lib/logger"
import { db } from "../../db"
import { workflows, workflowRevisions, generationTraces } from "../../db/schema"
import { eq, desc } from "drizzle-orm"
import {
  createTrace, addStage, addTokenUsage, addAttempt, finalizeTrace, hashPrompt,
  type GenerationTrace,
} from "./trace"
import { buildStaticBase } from "./prompts/system"

const log = createLogger("Orchestrator")

// ─────────────────────────────────────────────
// Public Interfaces
// ─────────────────────────────────────────────

export interface GenerateResult {
  workflowId: string
  code: string
  configJson: string
  explanation: string
  consumerSol: string | null
  secretsYaml: string | null
  intent: ParsedIntent
  template: TemplateMatch
  validation: ValidationResult
  fallback: boolean
  trace?: GenerationTrace
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

// ── Warm embedding cache at module load (fire-and-forget) ──
warmEmbeddingCache().catch(() => { /* graceful degradation — keyword-only mode */ })

const MAX_RETRIES = 2 // Up to 3 total attempts (1 initial + 2 retries)
const PIPELINE_TIMEOUT_MS = 600_000 // 10min aggregate — GPT-5.3-Codex reasoning can take 60-120s per call
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
  inputSchema?: Record<string, unknown> | null
  outputSchema?: Record<string, unknown> | null
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
      inputSchema: params.inputSchema ?? null,
      outputSchema: params.outputSchema ?? null,
      currentRevision: 1,
    })

    // Bootstrap revision #1
    db.insert(workflowRevisions).values({
      id: crypto.randomUUID(),
      workflowId: params.id,
      revisionNumber: 1,
      prompt: params.prompt,
      code: params.code,
      config: params.config,
      explanation: params.description,
      consumerSol: params.consumerSol ?? null,
      parentRevisionId: null,
    }).catch(() => { /* non-blocking */ })
  } catch (err) {
    // Log but don't throw — returning the result is more important than persistence
    log.info("DB save failed:", err instanceof Error ? err.message : err)
  }
}

// ─────────────────────────────────────────────
// Trace Persistence (fire-and-forget — never block response)
// ─────────────────────────────────────────────

const CODEGEN_MODEL = "gpt-5.3-codex"

function persistTrace(trace: GenerationTrace, workflowId?: string): void {
  try {
    // Sum token usage for denormalized columns
    let totalInput = 0, totalOutput = 0, totalReasoning = 0, totalCached = 0
    for (const u of trace.tokenUsage) {
      totalInput += u.inputTokens
      totalOutput += u.outputTokens
      totalReasoning += u.reasoningTokens
      totalCached += u.cachedTokens
    }

    db.insert(generationTraces).values({
      id: trace.requestId,
      workflowId: workflowId ?? null,
      prompt: trace.prompt,
      promptHash: trace.promptHash,
      templateId: trace.templateId,
      templateName: trace.templateName,
      templateConfidence: trace.templateConfidence,
      ownerAddress: trace.ownerAddress,
      model: trace.model || CODEGEN_MODEL,
      totalDurationMs: trace.totalDurationMs,
      totalAttempts: trace.totalAttempts,
      successfulAttempt: trace.successfulAttempt,
      usedFallback: trace.usedFallback,
      finalOutcome: trace.finalOutcome,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalReasoningTokens: totalReasoning,
      totalCachedTokens: totalCached,
      estimatedCostUsd: trace.estimatedCostUsd,
      traceJson: JSON.stringify(trace),
    }).catch((err: unknown) => {
      log.info("Trace persist failed:", err instanceof Error ? err.message : err)
    })
  } catch (err) {
    log.info("Trace persist failed:", err instanceof Error ? err.message : err)
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

  // Merge intent-driven fields into pre-built config.
  // Pre-built configs have empty-string placeholders for kvStoreUrl/kvApiKey/stateKey;
  // buildFallbackConfig fills them from intent keywords. Merge non-empty generated
  // values into loaded config without overwriting existing non-empty fields.
  if (configJson && templateDef) {
    const intentConfig = buildFallbackConfig(intent, templateDef)
    try {
      const loaded = JSON.parse(configJson) as Record<string, unknown>
      const generated = JSON.parse(intentConfig) as Record<string, unknown>
      for (const [key, value] of Object.entries(generated)) {
        if (value !== "" && value !== undefined && (!(key in loaded) || loaded[key] === "")) {
          loaded[key] = value
        }
      }
      configJson = JSON.stringify(loaded, null, 2)
    } catch {
      // JSON parse failed — keep config as-is
    }
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
  const schemas = loadTemplateSchemas(template.templateId)

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
    inputSchema: schemas?.inputSchema ?? null,
    outputSchema: schemas?.outputSchema ?? null,
  })

  const secretNames = extractSecretNames(code)
  const secretsYaml = buildSecretsYaml(secretNames)

  return {
    workflowId,
    code,
    configJson,
    explanation,
    consumerSol: null,
    secretsYaml,
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
  trace: GenerationTrace,
): Promise<GenerateResult> {
  const templateDef = getTemplateById(template.templateId)

  // ── Warm caches + capture doc context for LLM prompt injection ──
  buildFewShotContext(template.templateId)
  const relevantDocs = templateDef
    ? retrieveRelevantDocs(templateDef, intent)
    : ""
  await getContext7CREDocs()  // kept for cache-warming only (not injected — unpredictable content)

  // ── Pre-seed fix patterns based on template characteristics ──
  // Give the LLM relevant guidance on the FIRST attempt, not just retries.
  // HTTP triggers, evmWrite, and multi-AI patterns are the most common first-attempt failures.
  const accumulatedFixPatterns = new Set<string>()
  if (templateDef) {
    const isWildcard = template.templateId === 0
    const preSeedCats = getPreSeedCategories(templateDef.triggerType, templateDef.requiredCapabilities, isWildcard)
    if (preSeedCats.length > 0) {
      const preSeedPatterns = getFixPatternsForCategories(preSeedCats)
      if (preSeedPatterns) {
        accumulatedFixPatterns.add(preSeedPatterns)
        log.info(`Pre-seeded fix patterns for T${template.templateId}: [${preSeedCats.join(", ")}]`)
      }
    }
  }

  // ── Load schemas once (templateId is stable across retries) ──
  const schemas = loadTemplateSchemas(template.templateId)

  // ── Retry loop ──
  let lastError: string | undefined
  let lastEnrichedContext: string | undefined = accumulatedFixPatterns.size > 0
    ? [...accumulatedFixPatterns].join("\n\n")
    : undefined

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const attemptStart = Date.now()
    const parentStage = `attempt_${attempt + 1}`

    // Check abort signal before expensive LLM call
    if (signal.aborted) {
      throw new AppError(ErrorCodes.AI_SERVICE_ERROR, 504, "Pipeline timed out")
    }

    try {
      // Stage 3: Code Generation
      // On retries, cap internal self-review retries to 1 to prevent
      // retry multiplication: 3 orchestrator × 3 code-gen = 9 LLM calls.
      // First attempt: full self-review (3 internal). Retries: 1 internal.
      const codeGenStart = Date.now()
      const generated = await generateCode({
        userPrompt: prompt,
        intent,
        templateId: template.templateId,
        templateConfidence: template.confidence,
        previousError: lastError,
        maxInternalRetries: attempt === 0 ? undefined : 1,
        enrichedContext: lastEnrichedContext,
        relevantDocs,
      })
      addStage(trace, {
        stage: "code_gen", durationMs: Date.now() - codeGenStart,
        attempt: attempt + 1, success: true, parentStage,
      })

      // Capture token usage from code generator
      if (generated.tokenUsage) {
        addTokenUsage(trace, {
          attempt: attempt + 1,
          inputTokens: generated.tokenUsage.inputTokens,
          outputTokens: generated.tokenUsage.outputTokens,
          reasoningTokens: generated.tokenUsage.reasoningTokens,
          cachedTokens: generated.tokenUsage.cachedTokens,
          totalTokens: generated.tokenUsage.totalTokens,
          model: CODEGEN_MODEL,
          reasoningEffort: generated.reasoningEffort ?? "medium",
        })
      }

      // Check abort signal before validation
      if (signal.aborted) {
        throw new AppError(ErrorCodes.AI_SERVICE_ERROR, 504, "Pipeline timed out")
      }

      // quickFix — v0-inspired deterministic auto-repair
      const qfStart = Date.now()
      const { code: fixedCode, fixes } = quickFix(generated.workflowTs)
      addStage(trace, {
        stage: "quick_fix", durationMs: Date.now() - qfStart,
        attempt: attempt + 1, success: true, parentStage,
      })
      if (fixes.length > 0) {
        log.info(`quickFix applied (attempt ${attempt + 1}):`, fixes)
      }

      let configJsonStr = JSON.stringify(generated.configJson)

      // Config normalization — rename mismatched field names to canonical ones
      const normalized = normalizeConfigKeys(configJsonStr, template.templateId)
      if (normalized.fixes.length > 0) {
        log.info(`Config normalization (attempt ${attempt + 1}):`, normalized.fixes)
        configJsonStr = normalized.configJson
      }

      // Stage 4: Validation (cheap-first: fast regex then tsc)
      const valStart = Date.now()
      const validation = await validateWorkflow(fixedCode, configJsonStr, intent, templateDef ?? undefined)
      addStage(trace, {
        stage: "validation", durationMs: Date.now() - valStart,
        attempt: attempt + 1, success: validation.valid, parentStage,
        error: validation.valid ? undefined : validation.errors.slice(0, 3).join("; "),
      })

      if (validation.valid) {
        // Check abort signal before compilation check
        if (signal.aborted) {
          throw new AppError(ErrorCodes.AI_SERVICE_ERROR, 504, "Pipeline timed out")
        }

        // Compilation check — real tsc errors catch type mismatches
        // that regex-based validation misses
        const compStart = Date.now()
        const compileResult = await compileCheck(fixedCode, generated.configJson)
        addStage(trace, {
          stage: "compile_check", durationMs: Date.now() - compStart,
          attempt: attempt + 1, success: compileResult.compiled, parentStage,
          error: compileResult.compiled ? undefined : compileResult.errors.slice(0, 3).join("; "),
        })

        if (compileResult.compiled) {
          // Full success — save to DB and return
          const workflowId = crypto.randomUUID()

          addAttempt(trace, {
            attempt: attempt + 1, durationMs: Date.now() - attemptStart,
            outcome: "success", quickFixesApplied: fixes.length > 0 ? fixes : undefined,
          })

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
            inputSchema: schemas?.inputSchema ?? null,
            outputSchema: schemas?.outputSchema ?? null,
          })

          const secretNames = extractSecretNames(fixedCode)
          const secretsYaml = buildSecretsYaml(secretNames)

          finalizeTrace(trace, "success")
          persistTrace(trace, workflowId)

          return {
            workflowId,
            code: fixedCode,
            configJson: configJsonStr,
            explanation: generated.explanation,
            consumerSol: generated.consumerSol ?? null,
            secretsYaml,
            intent,
            template,
            validation,
            fallback: false,
            trace,
          }
        }

        // Validation passed but compilation failed — retry with compile errors
        if (attempt < MAX_RETRIES) {
          const erStart = Date.now()
          const resolution = resolveErrors(compileResult.errors, compileResult)
          addStage(trace, {
            stage: "error_resolve", durationMs: Date.now() - erStart,
            attempt: attempt + 1, success: true, parentStage,
          })
          lastError = resolution.compileContext || `Compilation failed: ${compileResult.errors.join(" | ")}`
          if (resolution.fixPatterns) accumulatedFixPatterns.add(resolution.fixPatterns)
          lastEnrichedContext = [...accumulatedFixPatterns].join("\n\n") || undefined

          addAttempt(trace, {
            attempt: attempt + 1, durationMs: Date.now() - attemptStart,
            outcome: "compile_failed", compileErrors: compileResult.errors.slice(0, 5),
            quickFixesApplied: fixes.length > 0 ? fixes : undefined,
          })

          log.info(
            `Compilation failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${compileResult.errors.join(" | ")}`,
          )
          continue
        }

        // Last attempt — compilation failed but validation passed,
        // return the code anyway (better than fallback)
        const workflowId = crypto.randomUUID()

        addAttempt(trace, {
          attempt: attempt + 1, durationMs: Date.now() - attemptStart,
          outcome: "compile_failed", compileErrors: compileResult.errors.slice(0, 5),
          quickFixesApplied: fixes.length > 0 ? fixes : undefined,
        })

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
          inputSchema: schemas?.inputSchema ?? null,
          outputSchema: schemas?.outputSchema ?? null,
        })

        const secretNames = extractSecretNames(fixedCode)
        const secretsYaml = buildSecretsYaml(secretNames)

        finalizeTrace(trace, "success")
        persistTrace(trace, workflowId)

        return {
          workflowId,
          code: fixedCode,
          configJson: configJsonStr,
          explanation: generated.explanation,
          consumerSol: generated.consumerSol ?? null,
          secretsYaml,
          intent,
          template,
          validation,
          fallback: false,
          trace,
        }
      }

      // Validation failed — enrich with fix patterns (accumulated across retries)
      const resolution = resolveErrors(validation.errors)
      const structuredErrors = validation.errors
        .map((err, i) => `${i + 1}. ${err}`)
        .join("\n")

      lastError =
        `## Validation Failures (Fix ALL before responding)\n${structuredErrors}`
      if (resolution.fixPatterns) accumulatedFixPatterns.add(resolution.fixPatterns)
      lastEnrichedContext = [...accumulatedFixPatterns].join("\n\n") || undefined

      addAttempt(trace, {
        attempt: attempt + 1, durationMs: Date.now() - attemptStart,
        outcome: "validation_failed", validationErrors: validation.errors.slice(0, 5),
        quickFixesApplied: fixes.length > 0 ? fixes : undefined,
      })

      log.info(
        `Validation failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${validation.errors.join(" | ")}`,
      )
    } catch (err) {
      // Generation itself threw — capture for retry context
      if (err instanceof AppError && err.code === ErrorCodes.TEMPLATE_NOT_FOUND) {
        throw err // Don't retry template-not-found
      }
      if (err instanceof AppError && err.statusCode === 504) {
        throw err // Don't retry timeout
      }

      addStage(trace, {
        stage: "code_gen", durationMs: Date.now() - attemptStart,
        attempt: attempt + 1, success: false, parentStage,
        error: err instanceof Error ? err.message : String(err),
      })
      addAttempt(trace, {
        attempt: attempt + 1, durationMs: Date.now() - attemptStart,
        outcome: "error",
      })

      lastError = err instanceof Error ? err.message : String(err)
      lastEnrichedContext = undefined
      log.info(
        `Generation error (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`,
        lastError,
      )
    }
  }

  // ── All attempts exhausted — fallback to pre-built template ──
  log.info("All attempts failed. Using fallback template.")
  finalizeTrace(trace, "fallback")
  const fallbackResult = await buildFallback(intent, template, ownerAddress, prompt)
  trace.usedFallback = true
  persistTrace(trace, fallbackResult.workflowId)
  return { ...fallbackResult, trace }
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
  requestId?: string,
): Promise<GenerateResult> {
  const trace = createTrace(requestId ?? crypto.randomUUID(), prompt, ownerAddress)

  // ── Stage 1: Intent parsing ──
  const s1Start = Date.now()
  const intent = parseIntent(prompt)
  addStage(trace, { stage: "intent_parse", durationMs: Date.now() - s1Start, success: true })

  // ── Stage 2: Template matching ──
  const s2Start = Date.now()
  const template = await matchTemplate(intent, forceTemplateId, prompt)
  addStage(trace, {
    stage: "template_match", durationMs: Date.now() - s2Start,
    success: !!template,
    error: template ? undefined : "No template match",
  })

  // matchTemplate now always returns a result (wildcard fallback for unmatched prompts).
  // Only null for invalid forceTemplateId or negated intent — both are correct rejections.
  if (!template) {
    finalizeTrace(trace, "error")
    persistTrace(trace)
    throw new AppError(
      ErrorCodes.TEMPLATE_NOT_FOUND,
      400,
      "Could not match your prompt to a workflow template. Try being more specific about what you want to automate.",
      { intent },
    )
  }

  // Populate trace with template info
  trace.templateId = template.templateId
  trace.templateName = template.templateName
  trace.templateConfidence = template.confidence
  trace.model = CODEGEN_MODEL
  trace.promptHash = hashPrompt(buildStaticBase())

  const isWildcard = template.templateId === 0
  if (isWildcard) {
    log.info(`Wildcard mode for prompt: "${prompt.slice(0, 80)}..."`)
  }

  await acquireSemaphore()

  // Abort signal: set to true on timeout so runPipeline stops before expensive ops
  const signal = { aborted: false }
  const timeoutId = setTimeout(() => { signal.aborted = true }, PIPELINE_TIMEOUT_MS)

  try {
    // Race the pipeline against an aggregate timeout.
    // On timeout, we fall through to the fallback path.
    const result = await Promise.race([
      runPipeline(prompt, ownerAddress, intent, template, signal, trace),
      new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), PIPELINE_TIMEOUT_MS),
      ),
    ])

    clearTimeout(timeoutId)

    if (result === "timeout") {
      log.info(`Pipeline timed out after ${PIPELINE_TIMEOUT_MS}ms. Using fallback.`)
      finalizeTrace(trace, "timeout")
      const fallbackResult = await buildFallback(intent, template, ownerAddress, prompt)
      persistTrace(trace, fallbackResult.workflowId)
      return { ...fallbackResult, trace }
    }

    return result
  } finally {
    clearTimeout(timeoutId)
    releaseSemaphore()
  }
}

// ─────────────────────────────────────────────
// Refinement Pipeline
// ─────────────────────────────────────────────

const REFINEMENT_TIMEOUT_MS = 300_000 // 5min — refinement has strong context, should be faster
const MAX_REVISIONS = 50

/**
 * Refines an existing workflow with a follow-up prompt.
 *
 * Key differences from generateWorkflow:
 * - Skips intent parsing and template matching (inherited from original)
 * - Passes existing code as context to the LLM
 * - No fallback on exhaustion — throws REFINEMENT_FAILED (never replaces working code with template)
 * - DB update only on success — user's previous working code is untouched if all retries fail
 */
export async function refineWorkflow(
  workflowId: string,
  refinementPrompt: string,
  ownerAddress: string,
  requestId?: string,
): Promise<GenerateResult & { revisionNumber: number }> {
  // ── Fetch existing workflow ──
  const [existing] = await db.select().from(workflows).where(eq(workflows.id, workflowId)).limit(1)
  if (!existing) {
    throw new AppError(ErrorCodes.WORKFLOW_NOT_FOUND, 404, "Workflow not found")
  }

  // ── Guard: published workflows cannot be refined ──
  if (existing.published) {
    throw new AppError(ErrorCodes.WORKFLOW_PUBLISHED, 400, "Published workflows cannot be refined")
  }

  // ── Guard: owner check (allow unclaimed zero-address) ──
  const zeroAddress = "0x0000000000000000000000000000000000000000"
  if (existing.ownerAddress !== zeroAddress && existing.ownerAddress !== ownerAddress) {
    throw new AppError(ErrorCodes.UNAUTHORIZED, 403, "Not the workflow owner")
  }

  // ── Guard: max revisions ──
  const currentRev = existing.currentRevision ?? 1
  if (currentRev >= MAX_REVISIONS) {
    throw new AppError(ErrorCodes.REFINEMENT_FAILED, 400, `Maximum ${MAX_REVISIONS} revisions reached`)
  }

  // ── Reconstruct intent + template from stored workflow ──
  const templateDef = getTemplateById(existing.templateId)
  const intent = parseIntent(existing.prompt)
  const template: TemplateMatch = {
    templateId: existing.templateId,
    templateName: existing.templateName,
    category: existing.category as TemplateMatch["category"],
    confidence: 1.0,
    matchedKeywords: intent.keywords,
  }

  // ── Load refinement history (last 3 prompts) ──
  const priorRevisions = await db
    .select({ prompt: workflowRevisions.prompt })
    .from(workflowRevisions)
    .where(eq(workflowRevisions.workflowId, workflowId))
    .orderBy(desc(workflowRevisions.revisionNumber))
    .limit(3)
  const priorRefinements = priorRevisions
    .map((r) => r.prompt)
    .reverse()

  // ── Create trace ──
  const trace = createTrace(requestId ?? crypto.randomUUID(), refinementPrompt, ownerAddress)
  trace.templateId = existing.templateId
  trace.templateName = existing.templateName
  trace.templateConfidence = 1.0
  trace.model = CODEGEN_MODEL
  trace.promptHash = hashPrompt(buildStaticBase())

  // ── Acquire semaphore ──
  await acquireSemaphore()

  const signal = { aborted: false }
  const timeoutId = setTimeout(() => { signal.aborted = true }, REFINEMENT_TIMEOUT_MS)

  try {
    const result = await runRefinementPipeline(
      existing,
      refinementPrompt,
      intent,
      template,
      templateDef ?? undefined,
      priorRefinements,
      signal,
      trace,
    )

    clearTimeout(timeoutId)

    if (result === "timeout") {
      finalizeTrace(trace, "timeout")
      persistTrace(trace, workflowId)
      throw new AppError(ErrorCodes.REFINEMENT_FAILED, 504, "Refinement timed out")
    }

    // ── On success: update workflow in-place ──
    const newRevision = currentRev + 1
    try {
      await db.update(workflows)
        .set({
          code: result.code,
          config: result.configJson,
          consumerSol: result.consumerSol,
          currentRevision: newRevision,
          simulationSuccess: false,
          simulationTrace: null,
          simulationDuration: null,
          updatedAt: new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, ""),
        })
        .where(eq(workflows.id, workflowId))

      // ── Get parent revision ID ──
      const [parentRev] = await db
        .select({ id: workflowRevisions.id })
        .from(workflowRevisions)
        .where(eq(workflowRevisions.workflowId, workflowId))
        .orderBy(desc(workflowRevisions.revisionNumber))
        .limit(1)

      // ── Save revision snapshot ──
      await db.insert(workflowRevisions).values({
        id: crypto.randomUUID(),
        workflowId,
        revisionNumber: newRevision,
        prompt: refinementPrompt,
        code: result.code,
        config: result.configJson,
        explanation: result.explanation,
        consumerSol: result.consumerSol ?? null,
        parentRevisionId: parentRev?.id ?? null,
      })
    } catch (err) {
      log.info("Refinement DB update failed:", err instanceof Error ? err.message : err)
    }

    return { ...result, workflowId, revisionNumber: newRevision, trace }
  } finally {
    clearTimeout(timeoutId)
    releaseSemaphore()
  }
}

async function runRefinementPipeline(
  existing: typeof workflows.$inferSelect,
  refinementPrompt: string,
  intent: ParsedIntent,
  template: TemplateMatch,
  templateDef: ReturnType<typeof getTemplateById> | undefined,
  priorRefinements: string[],
  signal: { aborted: boolean },
  trace: GenerationTrace,
): Promise<GenerateResult | "timeout"> {
  const resultPromise = (async (): Promise<GenerateResult> => {
    const accumulatedFixPatterns = new Set<string>()

    let lastError: string | undefined
    let lastEnrichedContext: string | undefined

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const attemptStart = Date.now()
      const parentStage = `refinement_attempt_${attempt + 1}`

      if (signal.aborted) {
        throw new AppError(ErrorCodes.REFINEMENT_FAILED, 504, "Refinement timed out")
      }

      try {
        const codeGenStart = Date.now()
        const generated = await generateCode({
          userPrompt: existing.prompt,
          intent,
          templateId: template.templateId,
          templateConfidence: template.confidence,
          previousError: lastError,
          maxInternalRetries: attempt === 0 ? undefined : 1,
          enrichedContext: lastEnrichedContext,
          previousCode: existing.code,
          previousConfig: existing.config,
          refinementPrompt,
          priorRefinements,
        })
        addStage(trace, {
          stage: "code_gen", durationMs: Date.now() - codeGenStart,
          attempt: attempt + 1, success: true, parentStage,
        })

        if (generated.tokenUsage) {
          addTokenUsage(trace, {
            attempt: attempt + 1,
            inputTokens: generated.tokenUsage.inputTokens,
            outputTokens: generated.tokenUsage.outputTokens,
            reasoningTokens: generated.tokenUsage.reasoningTokens,
            cachedTokens: generated.tokenUsage.cachedTokens,
            totalTokens: generated.tokenUsage.totalTokens,
            model: CODEGEN_MODEL,
            reasoningEffort: generated.reasoningEffort ?? "medium",
          })
        }

        if (signal.aborted) {
          throw new AppError(ErrorCodes.REFINEMENT_FAILED, 504, "Refinement timed out")
        }

        const qfStart = Date.now()
        const { code: fixedCode, fixes } = quickFix(generated.workflowTs)
        addStage(trace, {
          stage: "quick_fix", durationMs: Date.now() - qfStart,
          attempt: attempt + 1, success: true, parentStage,
        })
        if (fixes.length > 0) {
          log.info(`Refinement quickFix (attempt ${attempt + 1}):`, fixes)
        }

        let configJsonStr = JSON.stringify(generated.configJson)
        const normalized = normalizeConfigKeys(configJsonStr, template.templateId)
        if (normalized.fixes.length > 0) {
          configJsonStr = normalized.configJson
        }

        const valStart = Date.now()
        const validation = await validateWorkflow(fixedCode, configJsonStr, intent, templateDef ?? undefined)
        addStage(trace, {
          stage: "validation", durationMs: Date.now() - valStart,
          attempt: attempt + 1, success: validation.valid, parentStage,
          error: validation.valid ? undefined : validation.errors.slice(0, 3).join("; "),
        })

        if (validation.valid) {
          if (signal.aborted) {
            throw new AppError(ErrorCodes.REFINEMENT_FAILED, 504, "Refinement timed out")
          }

          const compStart = Date.now()
          const compileResult = await compileCheck(fixedCode, generated.configJson)
          addStage(trace, {
            stage: "compile_check", durationMs: Date.now() - compStart,
            attempt: attempt + 1, success: compileResult.compiled, parentStage,
            error: compileResult.compiled ? undefined : compileResult.errors.slice(0, 3).join("; "),
          })

          if (compileResult.compiled || attempt === MAX_RETRIES) {
            const secretNames = extractSecretNames(fixedCode)
            const secretsYaml = buildSecretsYaml(secretNames)

            addAttempt(trace, {
              attempt: attempt + 1, durationMs: Date.now() - attemptStart,
              outcome: compileResult.compiled ? "success" : "compile_failed",
              quickFixesApplied: fixes.length > 0 ? fixes : undefined,
              compileErrors: compileResult.compiled ? undefined : compileResult.errors.slice(0, 5),
            })
            finalizeTrace(trace, "success")
            persistTrace(trace, existing.id)

            return {
              workflowId: existing.id,
              code: fixedCode,
              configJson: configJsonStr,
              explanation: generated.explanation,
              consumerSol: generated.consumerSol ?? null,
              secretsYaml,
              intent,
              template,
              validation,
              fallback: false,
              trace,
            }
          }

          // Compilation failed — retry with enriched context
          const resolution = resolveErrors(compileResult.errors, compileResult)
          lastError = resolution.compileContext || `Compilation failed: ${compileResult.errors.join(" | ")}`
          if (resolution.fixPatterns) accumulatedFixPatterns.add(resolution.fixPatterns)
          lastEnrichedContext = [...accumulatedFixPatterns].join("\n\n") || undefined

          addAttempt(trace, {
            attempt: attempt + 1, durationMs: Date.now() - attemptStart,
            outcome: "compile_failed", compileErrors: compileResult.errors.slice(0, 5),
            quickFixesApplied: fixes.length > 0 ? fixes : undefined,
          })
          continue
        }

        // Validation failed
        const resolution = resolveErrors(validation.errors)
        lastError = `## Validation Failures (Fix ALL before responding)\n${validation.errors.map((e, i) => `${i + 1}. ${e}`).join("\n")}`
        if (resolution.fixPatterns) accumulatedFixPatterns.add(resolution.fixPatterns)
        lastEnrichedContext = [...accumulatedFixPatterns].join("\n\n") || undefined

        addAttempt(trace, {
          attempt: attempt + 1, durationMs: Date.now() - attemptStart,
          outcome: "validation_failed", validationErrors: validation.errors.slice(0, 5),
          quickFixesApplied: fixes.length > 0 ? fixes : undefined,
        })
      } catch (err) {
        if (err instanceof AppError && (err.statusCode === 504 || err.code === ErrorCodes.REFINEMENT_FAILED)) {
          throw err
        }

        addAttempt(trace, {
          attempt: attempt + 1, durationMs: Date.now() - attemptStart,
          outcome: "error",
        })

        lastError = err instanceof Error ? err.message : String(err)
        lastEnrichedContext = undefined
        log.info(`Refinement error (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`, lastError)
      }
    }

    // No fallback for refinement — throw instead
    finalizeTrace(trace, "error")
    persistTrace(trace, existing.id)
    throw new AppError(
      ErrorCodes.REFINEMENT_FAILED,
      502,
      "Refinement failed after all retry attempts. Your previous code is unchanged.",
    )
  })()

  return Promise.race([
    resultPromise,
    new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), REFINEMENT_TIMEOUT_MS),
    ),
  ])
}
