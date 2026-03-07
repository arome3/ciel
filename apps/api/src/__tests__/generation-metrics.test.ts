import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Database } from "bun:sqlite"
import { resolve } from "path"
import { mock } from "bun:test"

// ─────────────────────────────────────────────
// Setup: In-memory SQLite with generation_traces table
// ─────────────────────────────────────────────

const testDb = new Database(":memory:")
testDb.exec("PRAGMA journal_mode = WAL")
testDb.exec(`
  CREATE TABLE generation_traces (
    id TEXT PRIMARY KEY,
    workflow_id TEXT,
    prompt TEXT NOT NULL,
    prompt_hash TEXT,
    template_id INTEGER NOT NULL,
    template_name TEXT NOT NULL,
    template_confidence REAL,
    owner_address TEXT NOT NULL,
    model TEXT,
    total_duration_ms INTEGER NOT NULL,
    total_attempts INTEGER NOT NULL,
    successful_attempt INTEGER,
    used_fallback INTEGER NOT NULL,
    final_outcome TEXT NOT NULL,
    total_input_tokens INTEGER DEFAULT 0,
    total_output_tokens INTEGER DEFAULT 0,
    total_reasoning_tokens INTEGER DEFAULT 0,
    total_cached_tokens INTEGER DEFAULT 0,
    estimated_cost_usd REAL DEFAULT 0,
    trace_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`)

const SRC = resolve(import.meta.dir, "..")

// Mock the db module to use our in-memory database
mock.module(resolve(SRC, "db/index.ts"), () => ({
  db: {},
  sqlite: testDb,
}))

mock.module(resolve(SRC, "config.ts"), () => ({
  config: {
    DATABASE_PATH: ":memory:",
    NODE_ENV: "test",
  },
}))

// ─────────────────────────────────────────────
// Seed test data
// ─────────────────────────────────────────────

function seedTrace(overrides: Partial<{
  id: string
  templateId: number
  templateName: string
  finalOutcome: string
  totalDurationMs: number
  totalAttempts: number
  successfulAttempt: number | null
  usedFallback: boolean
  totalInputTokens: number
  totalOutputTokens: number
  totalCachedTokens: number
  estimatedCostUsd: number
  createdAt: string
}> = {}) {
  const id = overrides.id ?? crypto.randomUUID()
  const traceJson = JSON.stringify({
    requestId: id,
    stages: [
      { stage: "intent_parse", durationMs: 2, success: true },
      { stage: "template_match", durationMs: 5, success: true },
      { stage: "code_gen", durationMs: overrides.totalDurationMs ?? 5000, success: true, attempt: 1 },
      { stage: "validation", durationMs: 10, success: true, attempt: 1 },
    ],
    tokenUsage: [],
    attempts: [],
  })

  testDb.prepare(`
    INSERT INTO generation_traces
    (id, prompt, template_id, template_name, template_confidence, owner_address, model,
     total_duration_ms, total_attempts, successful_attempt, used_fallback, final_outcome,
     total_input_tokens, total_output_tokens, total_reasoning_tokens, total_cached_tokens,
     estimated_cost_usd, trace_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    "test prompt",
    overrides.templateId ?? 1,
    overrides.templateName ?? "Price Monitor",
    0.95,
    "0xabc",
    "gpt-5.3-codex",
    overrides.totalDurationMs ?? 5000,
    overrides.totalAttempts ?? 1,
    "successfulAttempt" in overrides ? (overrides.successfulAttempt ?? null) : 1,
    overrides.usedFallback ? 1 : 0,
    overrides.finalOutcome ?? "success",
    overrides.totalInputTokens ?? 5000,
    overrides.totalOutputTokens ?? 2000,
    0,
    overrides.totalCachedTokens ?? 1000,
    overrides.estimatedCostUsd ?? 0.025,
    traceJson,
    overrides.createdAt ?? new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, ""),
  )
}

// ─────────────────────────────────────────────
// Dynamic import (after mocks)
// ─────────────────────────────────────────────

let getGenerationMetrics: (windowHours?: number) => any
let getTemplateMetrics: (windowHours?: number) => any

beforeAll(async () => {
  const mod = await import("../services/ai-engine/generation-metrics")
  getGenerationMetrics = mod.getGenerationMetrics
  getTemplateMetrics = mod.getTemplateMetrics

  // Seed test data
  seedTrace({ id: "t1", finalOutcome: "success", totalDurationMs: 3000, totalAttempts: 1, successfulAttempt: 1 })
  seedTrace({ id: "t2", finalOutcome: "success", totalDurationMs: 8000, totalAttempts: 2, successfulAttempt: 2 })
  seedTrace({ id: "t3", finalOutcome: "fallback", totalDurationMs: 15000, totalAttempts: 3, successfulAttempt: null, usedFallback: true })
  seedTrace({ id: "t4", finalOutcome: "success", totalDurationMs: 4000, templateId: 2, templateName: "Weather Alert" })
  seedTrace({ id: "t5", finalOutcome: "timeout", totalDurationMs: 90000, totalAttempts: 1, successfulAttempt: null })
})

afterAll(() => {
  testDb.close()
})

// ─────────────────────────────────────────────
// Suite 1: Overall Metrics
// ─────────────────────────────────────────────

describe("generation-metrics — overall", () => {
  test("returns correct aggregate counts", () => {
    const m = getGenerationMetrics(24)
    expect(m.overall.totalGenerations).toBe(5)
    expect(m.overall.successCount).toBe(3)
    expect(m.overall.fallbackCount).toBe(1)
    expect(m.overall.timeoutCount).toBe(1)
  })

  test("calculates success rate", () => {
    const m = getGenerationMetrics(24)
    expect(m.overall.successRate).toBe(60) // 3/5 = 60%
  })

  test("calculates latency percentiles", () => {
    const m = getGenerationMetrics(24)
    expect(m.latency.p50DurationMs).toBeGreaterThan(0)
    expect(m.latency.p95DurationMs).toBeGreaterThanOrEqual(m.latency.p50DurationMs)
  })

  test("calculates token aggregates", () => {
    const m = getGenerationMetrics(24)
    expect(m.tokens.totalInputTokens).toBe(25000) // 5 * 5000
    expect(m.tokens.totalOutputTokens).toBe(10000) // 5 * 2000
    expect(m.tokens.totalCachedTokens).toBe(5000) // 5 * 1000
    expect(m.tokens.cacheHitRate).toBe(20) // 5000/25000 = 20%
  })

  test("calculates cost aggregates", () => {
    const m = getGenerationMetrics(24)
    expect(m.cost.totalEstimatedCostUsd).toBe(0.125) // 5 * 0.025
    expect(m.cost.avgCostPerGeneration).toBe(0.025)
  })

  test("calculates retry metrics", () => {
    const m = getGenerationMetrics(24)
    expect(m.retries.avgAttemptsPerGeneration).toBeGreaterThan(1) // avg of 1,2,3,1,1 = 1.6
    // first attempt success = t1, t4 = 2 out of 5 = 40%
    expect(m.retries.firstAttemptSuccessRate).toBe(40)
  })

  test("calculates per-stage latency", () => {
    const m = getGenerationMetrics(24)
    expect(m.stageLatency).toBeDefined()
    expect(m.stageLatency.intent_parse).toBeDefined()
    expect(m.stageLatency.code_gen).toBeDefined()
  })

  test("window clamping works", () => {
    const m = getGenerationMetrics(9999)
    expect(m.window.hours).toBe(720)
  })
})

// ─────────────────────────────────────────────
// Suite 2: Template Metrics
// ─────────────────────────────────────────────

describe("generation-metrics — templates", () => {
  test("returns per-template breakdown", () => {
    const templates = getTemplateMetrics(24)
    expect(templates.length).toBeGreaterThanOrEqual(2) // T1 and T2
  })

  test("template 1 has correct counts", () => {
    const templates = getTemplateMetrics(24)
    const t1 = templates.find((t: any) => t.templateId === 1)
    expect(t1).toBeDefined()
    expect(t1!.totalGenerations).toBe(4) // t1, t2, t3, t5
    expect(t1!.successCount).toBe(2) // t1, t2
    expect(t1!.fallbackCount).toBe(1) // t3
  })

  test("template 2 has correct counts", () => {
    const templates = getTemplateMetrics(24)
    const t2 = templates.find((t: any) => t.templateId === 2)
    expect(t2).toBeDefined()
    expect(t2!.totalGenerations).toBe(1) // t4
    expect(t2!.templateName).toBe("Weather Alert")
  })
})
