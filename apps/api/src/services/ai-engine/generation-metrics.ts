// ─────────────────────────────────────────────
// Generation Metrics — DB-driven aggregation for AI pipeline observability
// ─────────────────────────────────────────────
// All queries against `generation_traces` table via raw SQL.
// No in-memory state — restart-safe.

import { sqlite } from "../../db"
import type { GenerationTrace } from "./trace"

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface GenerationMetricsSummary {
  window: { hours: number, from: string, to: string }
  overall: {
    totalGenerations: number
    successCount: number
    fallbackCount: number
    timeoutCount: number
    errorCount: number
    successRate: number
  }
  latency: {
    avgTotalDurationMs: number
    p50DurationMs: number
    p95DurationMs: number
  }
  tokens: {
    totalInputTokens: number
    totalOutputTokens: number
    totalReasoningTokens: number
    totalCachedTokens: number
    avgTokensPerGeneration: number
    cacheHitRate: number
  }
  cost: {
    totalEstimatedCostUsd: number
    avgCostPerGeneration: number
  }
  retries: {
    avgAttemptsPerGeneration: number
    firstAttemptSuccessRate: number
  }
  stageLatency: Record<string, number>
}

export interface TemplateMetricsSummary {
  templateId: number
  templateName: string
  totalGenerations: number
  successCount: number
  fallbackCount: number
  avgDurationMs: number
  avgAttempts: number
  firstAttemptSuccessRate: number
  avgCostUsd: number
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function windowCutoff(hours: number): string {
  const d = new Date(Date.now() - hours * 3600_000)
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "")
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)]
}

// ─────────────────────────────────────────────
// Overall Metrics
// ─────────────────────────────────────────────

export function getGenerationMetrics(windowHours = 24): GenerationMetricsSummary {
  const clamped = Math.max(1, Math.min(720, windowHours))
  const cutoff = windowCutoff(clamped)
  const now = new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "")

  // Aggregate query
  const row = sqlite.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN final_outcome = 'success' THEN 1 ELSE 0 END) as success_count,
      SUM(CASE WHEN final_outcome = 'fallback' THEN 1 ELSE 0 END) as fallback_count,
      SUM(CASE WHEN final_outcome = 'timeout' THEN 1 ELSE 0 END) as timeout_count,
      SUM(CASE WHEN final_outcome = 'error' THEN 1 ELSE 0 END) as error_count,
      AVG(total_duration_ms) as avg_duration,
      SUM(total_input_tokens) as total_input,
      SUM(total_output_tokens) as total_output,
      SUM(total_reasoning_tokens) as total_reasoning,
      SUM(total_cached_tokens) as total_cached,
      SUM(estimated_cost_usd) as total_cost,
      AVG(total_attempts) as avg_attempts,
      SUM(CASE WHEN successful_attempt = 1 THEN 1 ELSE 0 END) as first_attempt_success
    FROM generation_traces
    WHERE created_at >= ?
  `).get(cutoff) as any ?? {}

  const total = row.total ?? 0
  const successCount = row.success_count ?? 0
  const totalInput = row.total_input ?? 0
  const totalOutput = row.total_output ?? 0
  const totalCached = row.total_cached ?? 0
  const totalAllTokens = totalInput + totalOutput

  // Latency percentiles (pull sorted durations)
  const durations = sqlite.prepare(`
    SELECT total_duration_ms FROM generation_traces
    WHERE created_at >= ?
    ORDER BY total_duration_ms ASC
  `).all(cutoff).map((r: any) => r.total_duration_ms as number)

  // Per-stage avg latency from trace_json (last 100 rows for performance)
  const stageLatency: Record<string, number> = {}
  const stageCounts: Record<string, number> = {}
  const recentTraces = sqlite.prepare(`
    SELECT trace_json FROM generation_traces
    WHERE created_at >= ?
    ORDER BY created_at DESC
    LIMIT 100
  `).all(cutoff) as { trace_json: string }[]

  for (const { trace_json } of recentTraces) {
    try {
      const t = JSON.parse(trace_json) as GenerationTrace
      for (const s of t.stages) {
        stageLatency[s.stage] = (stageLatency[s.stage] ?? 0) + s.durationMs
        stageCounts[s.stage] = (stageCounts[s.stage] ?? 0) + 1
      }
    } catch { /* skip malformed */ }
  }
  for (const stage of Object.keys(stageLatency)) {
    stageLatency[stage] = Math.round(stageLatency[stage] / (stageCounts[stage] || 1))
  }

  return {
    window: { hours: clamped, from: cutoff, to: now },
    overall: {
      totalGenerations: total,
      successCount,
      fallbackCount: row.fallback_count ?? 0,
      timeoutCount: row.timeout_count ?? 0,
      errorCount: row.error_count ?? 0,
      successRate: total > 0 ? Math.round((successCount / total) * 10000) / 100 : 0,
    },
    latency: {
      avgTotalDurationMs: Math.round(row.avg_duration ?? 0),
      p50DurationMs: percentile(durations, 50),
      p95DurationMs: percentile(durations, 95),
    },
    tokens: {
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalReasoningTokens: row.total_reasoning ?? 0,
      totalCachedTokens: totalCached,
      avgTokensPerGeneration: total > 0 ? Math.round(totalAllTokens / total) : 0,
      cacheHitRate: totalInput > 0 ? Math.round((totalCached / totalInput) * 10000) / 100 : 0,
    },
    cost: {
      totalEstimatedCostUsd: Math.round((row.total_cost ?? 0) * 1_000_000) / 1_000_000,
      avgCostPerGeneration: total > 0 ? Math.round(((row.total_cost ?? 0) / total) * 1_000_000) / 1_000_000 : 0,
    },
    retries: {
      avgAttemptsPerGeneration: Math.round((row.avg_attempts ?? 0) * 100) / 100,
      firstAttemptSuccessRate: total > 0
        ? Math.round(((row.first_attempt_success ?? 0) / total) * 10000) / 100
        : 0,
    },
    stageLatency,
  }
}

// ─────────────────────────────────────────────
// Per-Template Metrics
// ─────────────────────────────────────────────

export function getTemplateMetrics(windowHours = 24): TemplateMetricsSummary[] {
  const clamped = Math.max(1, Math.min(720, windowHours))
  const cutoff = windowCutoff(clamped)

  const rows = sqlite.prepare(`
    SELECT
      template_id,
      template_name,
      COUNT(*) as total,
      SUM(CASE WHEN final_outcome = 'success' THEN 1 ELSE 0 END) as success_count,
      SUM(CASE WHEN final_outcome = 'fallback' THEN 1 ELSE 0 END) as fallback_count,
      AVG(total_duration_ms) as avg_duration,
      AVG(total_attempts) as avg_attempts,
      SUM(CASE WHEN successful_attempt = 1 THEN 1 ELSE 0 END) as first_attempt_success,
      AVG(estimated_cost_usd) as avg_cost
    FROM generation_traces
    WHERE created_at >= ?
    GROUP BY template_id
    ORDER BY total DESC
  `).all(cutoff) as any[]

  return rows.map((r) => ({
    templateId: r.template_id,
    templateName: r.template_name,
    totalGenerations: r.total,
    successCount: r.success_count,
    fallbackCount: r.fallback_count,
    avgDurationMs: Math.round(r.avg_duration ?? 0),
    avgAttempts: Math.round((r.avg_attempts ?? 0) * 100) / 100,
    firstAttemptSuccessRate: r.total > 0
      ? Math.round((r.first_attempt_success / r.total) * 10000) / 100
      : 0,
    avgCostUsd: Math.round((r.avg_cost ?? 0) * 1_000_000) / 1_000_000,
  }))
}
