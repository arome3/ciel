import { describe, test, expect } from "bun:test"
import {
  createTrace,
  addStage,
  addTokenUsage,
  addAttempt,
  finalizeTrace,
  calculateCost,
  hashPrompt,
  type GenerationTrace,
  type StageTimingEntry,
  type TokenUsageEntry,
  type AttemptRecord,
} from "../services/ai-engine/trace"

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function makeTrace(): GenerationTrace {
  return createTrace("req-123", "Monitor ETH price every 5 minutes and alert when below $2000", "0xabc")
}

// ─────────────────────────────────────────────
// Suite 1: createTrace
// ─────────────────────────────────────────────

describe("trace — createTrace", () => {
  test("initializes with correct defaults", () => {
    const trace = makeTrace()
    expect(trace.requestId).toBe("req-123")
    expect(trace.prompt).toBe("Monitor ETH price every 5 minutes and alert when below $2000")
    expect(trace.ownerAddress).toBe("0xabc")
    expect(trace.stages).toEqual([])
    expect(trace.tokenUsage).toEqual([])
    expect(trace.attempts).toEqual([])
    expect(trace.totalDurationMs).toBe(0)
    expect(trace.finalOutcome).toBe("error")
    expect(trace.startedAt).toBeTruthy()
  })

  test("truncates prompt to 200 chars", () => {
    const longPrompt = "x".repeat(300)
    const trace = createTrace("req-1", longPrompt, "0x1")
    expect(trace.prompt.length).toBe(200)
  })
})

// ─────────────────────────────────────────────
// Suite 2: addStage
// ─────────────────────────────────────────────

describe("trace — addStage", () => {
  test("appends stage entry", () => {
    const trace = makeTrace()
    const entry: StageTimingEntry = {
      stage: "intent_parse",
      durationMs: 5,
      success: true,
    }
    addStage(trace, entry)
    expect(trace.stages).toHaveLength(1)
    expect(trace.stages[0].stage).toBe("intent_parse")
  })

  test("truncates error to 200 chars", () => {
    const trace = makeTrace()
    addStage(trace, {
      stage: "code_gen",
      durationMs: 100,
      success: false,
      error: "e".repeat(500),
    })
    expect(trace.stages[0].error!.length).toBe(200)
  })
})

// ─────────────────────────────────────────────
// Suite 3: addTokenUsage + addAttempt
// ─────────────────────────────────────────────

describe("trace — addTokenUsage & addAttempt", () => {
  test("appends token usage entry", () => {
    const trace = makeTrace()
    const usage: TokenUsageEntry = {
      attempt: 1,
      inputTokens: 5000,
      outputTokens: 2000,
      reasoningTokens: 1000,
      cachedTokens: 3000,
      totalTokens: 8000,
      model: "gpt-5.3-codex",
      reasoningEffort: "medium",
    }
    addTokenUsage(trace, usage)
    expect(trace.tokenUsage).toHaveLength(1)
    expect(trace.tokenUsage[0].inputTokens).toBe(5000)
  })

  test("appends attempt record", () => {
    const trace = makeTrace()
    const record: AttemptRecord = {
      attempt: 1,
      durationMs: 5000,
      outcome: "success",
    }
    addAttempt(trace, record)
    expect(trace.attempts).toHaveLength(1)
    expect(trace.attempts[0].outcome).toBe("success")
  })
})

// ─────────────────────────────────────────────
// Suite 4: calculateCost
// ─────────────────────────────────────────────

describe("trace — calculateCost", () => {
  test("calculates cost from token usage with known model", () => {
    const trace = makeTrace()
    addTokenUsage(trace, {
      attempt: 1,
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      reasoningTokens: 0,
      cachedTokens: 500_000,
      totalTokens: 2_000_000,
      model: "gpt-5.3-codex",
      reasoningEffort: "medium",
    })
    // Non-cached input: 500K × $2/1M = $1.00
    // Cached input: 500K × $0.50/1M = $0.25
    // Output: 1M × $8/1M = $8.00
    // Total: $9.25
    const cost = calculateCost(trace)
    expect(cost).toBe(9.25)
  })

  test("uses default pricing for unknown model", () => {
    const trace = makeTrace()
    addTokenUsage(trace, {
      attempt: 1,
      inputTokens: 100_000,
      outputTokens: 50_000,
      reasoningTokens: 0,
      cachedTokens: 0,
      totalTokens: 150_000,
      model: "unknown-model",
      reasoningEffort: "medium",
    })
    // Input: 100K × $2/1M = $0.20
    // Output: 50K × $8/1M = $0.40
    const cost = calculateCost(trace)
    expect(cost).toBe(0.6)
  })

  test("returns 0 for empty token usage", () => {
    const trace = makeTrace()
    expect(calculateCost(trace)).toBe(0)
  })
})

// ─────────────────────────────────────────────
// Suite 5: finalizeTrace
// ─────────────────────────────────────────────

describe("trace — finalizeTrace", () => {
  test("sets outcome, completedAt, and totalAttempts", () => {
    const trace = makeTrace()
    addAttempt(trace, { attempt: 1, durationMs: 1000, outcome: "validation_failed" })
    addAttempt(trace, { attempt: 2, durationMs: 2000, outcome: "success" })

    finalizeTrace(trace, "success")

    expect(trace.finalOutcome).toBe("success")
    expect(trace.completedAt).toBeTruthy()
    expect(trace.totalAttempts).toBe(2)
    expect(trace.successfulAttempt).toBe(2)
    expect(trace.usedFallback).toBe(false)
  })

  test("sets usedFallback for fallback outcome", () => {
    const trace = makeTrace()
    addAttempt(trace, { attempt: 1, durationMs: 1000, outcome: "error" })

    finalizeTrace(trace, "fallback")

    expect(trace.usedFallback).toBe(true)
    expect(trace.finalOutcome).toBe("fallback")
    expect(trace.successfulAttempt).toBeNull()
  })

  test("calculates cost on finalize", () => {
    const trace = makeTrace()
    addTokenUsage(trace, {
      attempt: 1,
      inputTokens: 100_000,
      outputTokens: 50_000,
      reasoningTokens: 0,
      cachedTokens: 0,
      totalTokens: 150_000,
      model: "gpt-5.3-codex",
      reasoningEffort: "medium",
    })
    addAttempt(trace, { attempt: 1, durationMs: 1000, outcome: "success" })
    finalizeTrace(trace, "success")
    expect(trace.estimatedCostUsd).toBeGreaterThan(0)
  })
})

// ─────────────────────────────────────────────
// Suite 6: hashPrompt
// ─────────────────────────────────────────────

describe("trace — hashPrompt", () => {
  test("returns 8-char hex string", () => {
    const hash = hashPrompt("test prompt")
    expect(hash).toMatch(/^[0-9a-f]{8}$/)
  })

  test("same input produces same hash", () => {
    const a = hashPrompt("consistent input")
    const b = hashPrompt("consistent input")
    expect(a).toBe(b)
  })

  test("different inputs produce different hashes", () => {
    const a = hashPrompt("input A")
    const b = hashPrompt("input B")
    expect(a).not.toBe(b)
  })
})
