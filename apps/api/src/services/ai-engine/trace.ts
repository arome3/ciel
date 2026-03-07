// ─────────────────────────────────────────────
// Generation Trace — Observability for AI Code Generation Pipeline
// ─────────────────────────────────────────────
// Plain data structures + pure helpers for per-stage timing, token tracking,
// retry analytics, and cost estimation. The orchestrator owns the trace
// lifecycle; stages just append data.

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface StageTimingEntry {
  stage: string        // "intent_parse" | "template_match" | "code_gen" | "quick_fix" | "validation" | "compile_check" | "error_resolve"
  durationMs: number
  attempt?: number     // 1-based, only inside retry loop
  success: boolean
  error?: string       // truncated to 200 chars
  parentStage?: string // optional parent for nesting (e.g. "attempt_1")
}

export interface TokenUsageEntry {
  attempt: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cachedTokens: number
  totalTokens: number
  model: string
  reasoningEffort: string
}

export interface AttemptRecord {
  attempt: number
  durationMs: number
  outcome: "success" | "validation_failed" | "compile_failed" | "error"
  validationErrors?: string[]
  compileErrors?: string[]
  quickFixesApplied?: string[]
  selfReviewRedFlags?: string
}

export interface GenerationTrace {
  requestId: string
  prompt: string               // truncated to 200 chars for storage
  promptHash: string           // short hash of system prompt (detects cache effectiveness)
  templateId: number
  templateName: string
  templateConfidence: number
  ownerAddress: string
  model: string
  stages: StageTimingEntry[]
  tokenUsage: TokenUsageEntry[]
  attempts: AttemptRecord[]
  totalDurationMs: number
  totalAttempts: number
  successfulAttempt: number | null
  usedFallback: boolean
  finalOutcome: "success" | "fallback" | "timeout" | "error"
  estimatedCostUsd: number
  startedAt: string            // ISO 8601
  completedAt: string
}

// ─────────────────────────────────────────────
// Cost Pricing Table (per 1M tokens)
// ─────────────────────────────────────────────

const MODEL_PRICING: Record<string, { input: number, cachedInput: number, output: number }> = {
  "gpt-5.3-codex": { input: 2.00, cachedInput: 0.50, output: 8.00 },
}

const DEFAULT_PRICING = { input: 2.00, cachedInput: 0.50, output: 8.00 }

// ─────────────────────────────────────────────
// Helpers (pure, append-only mutations)
// ─────────────────────────────────────────────

export function createTrace(requestId: string, prompt: string, ownerAddress: string): GenerationTrace {
  return {
    requestId,
    prompt: prompt.slice(0, 200),
    promptHash: "",
    templateId: 0,
    templateName: "",
    templateConfidence: 0,
    ownerAddress,
    model: "",
    stages: [],
    tokenUsage: [],
    attempts: [],
    totalDurationMs: 0,
    totalAttempts: 0,
    successfulAttempt: null,
    usedFallback: false,
    finalOutcome: "error",
    estimatedCostUsd: 0,
    startedAt: new Date().toISOString(),
    completedAt: "",
  }
}

export function addStage(trace: GenerationTrace, entry: StageTimingEntry): void {
  if (entry.error) {
    entry.error = entry.error.slice(0, 200)
  }
  trace.stages.push(entry)
}

export function addTokenUsage(trace: GenerationTrace, entry: TokenUsageEntry): void {
  trace.tokenUsage.push(entry)
}

export function addAttempt(trace: GenerationTrace, record: AttemptRecord): void {
  trace.attempts.push(record)
}

export function calculateCost(trace: GenerationTrace): number {
  let totalCost = 0
  for (const usage of trace.tokenUsage) {
    const pricing = MODEL_PRICING[usage.model] ?? DEFAULT_PRICING
    const nonCachedInput = usage.inputTokens - usage.cachedTokens
    totalCost += (nonCachedInput / 1_000_000) * pricing.input
    totalCost += (usage.cachedTokens / 1_000_000) * pricing.cachedInput
    totalCost += (usage.outputTokens / 1_000_000) * pricing.output
  }
  return Math.round(totalCost * 1_000_000) / 1_000_000 // 6 decimal places
}

export function finalizeTrace(
  trace: GenerationTrace,
  outcome: GenerationTrace["finalOutcome"],
): void {
  trace.finalOutcome = outcome
  trace.completedAt = new Date().toISOString()
  trace.totalDurationMs = Date.now() - new Date(trace.startedAt).getTime()
  trace.totalAttempts = trace.attempts.length
  trace.estimatedCostUsd = calculateCost(trace)

  if (outcome === "success") {
    // Find the successful attempt (last one with "success" outcome)
    for (let i = trace.attempts.length - 1; i >= 0; i--) {
      if (trace.attempts[i].outcome === "success") {
        trace.successfulAttempt = trace.attempts[i].attempt
        break
      }
    }
  }

  trace.usedFallback = outcome === "fallback"
}

/**
 * Simple djb2 hash → 8-char hex string.
 * Used to detect OpenAI's automatic prompt cache effectiveness —
 * not for security, so a non-cryptographic hash is fine.
 */
export function hashPrompt(text: string): string {
  let hash = 5381
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}
