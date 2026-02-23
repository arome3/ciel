// agent/src/evaluator.ts — Fitness scoring for discovered workflows

import type { DiscoveredWorkflow, FitnessScore, RankedWorkflow } from "./types"
import * as log from "./logger"

// ─────────────────────────────────────────────
// Scoring dimensions (total: 100)
// ─────────────────────────────────────────────

function scoreSchemaMatch(workflow: DiscoveredWorkflow): number {
  const schema = workflow.inputSchema
  if (!schema || typeof schema !== "object") return 10

  const keys = Object.keys(schema)
  const hasPrompt = keys.some((k) =>
    ["prompt", "query", "input", "question"].includes(k.toLowerCase()),
  )
  return hasPrompt ? 40 : 15
}

function scoreOutputUsefulness(workflow: DiscoveredWorkflow): number {
  const schema = workflow.outputSchema
  if (!schema || typeof schema !== "object") return 10

  const keys = Object.keys(schema)
  const lower = keys.map((k) => k.toLowerCase())

  let score = 10
  if (lower.includes("answer") || lower.includes("result")) score += 10
  if (lower.includes("confidence") || lower.includes("score")) score += 10
  return Math.min(score, 30)
}

function scorePricing(workflow: DiscoveredWorkflow): number {
  const priceUsd = workflow.priceUsdc / 1_000_000
  if (priceUsd <= 0.10) return 20
  if (priceUsd <= 0.50) return 10
  if (priceUsd <= 1.00) return 5
  return 0
}

function scoreReliability(workflow: DiscoveredWorkflow): number {
  const { totalExecutions, successfulExecutions } = workflow
  if (totalExecutions === 0) return 3

  const rate = successfulExecutions / totalExecutions
  const volumeBonus = Math.min(totalExecutions / 100, 1) * 3
  return Math.min(Math.round(rate * 7 + volumeBonus), 10)
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

export function evaluateWorkflow(workflow: DiscoveredWorkflow): FitnessScore {
  const schemaMatch = scoreSchemaMatch(workflow)
  const outputUsefulness = scoreOutputUsefulness(workflow)
  const priceScore = scorePricing(workflow)
  const reliabilityScore = scoreReliability(workflow)
  const total = schemaMatch + outputUsefulness + priceScore + reliabilityScore

  let recommendation: FitnessScore["recommendation"]
  if (total >= 70) recommendation = "execute"
  else if (total >= 40) recommendation = "review"
  else recommendation = "skip"

  return {
    total,
    breakdown: { schemaMatch, outputUsefulness, priceScore, reliabilityScore },
    recommendation,
  }
}

export async function rankWorkflows(
  workflows: DiscoveredWorkflow[],
): Promise<RankedWorkflow[]> {
  await log.step("Evaluating workflow fitness...")

  const ranked = workflows
    .map((workflow) => ({
      workflow,
      fitness: evaluateWorkflow(workflow),
    }))
    .sort((a, b) => b.fitness.total - a.fitness.total)

  for (const { workflow, fitness } of ranked) {
    await log.detail(
      `${workflow.name}: ${fitness.total}/100 → ${fitness.recommendation}`,
    )
  }

  if (ranked.length > 0) {
    const best = ranked[0]
    log.done(
      `Best: "${best.workflow.name}" (${best.fitness.total}/100, ${best.fitness.recommendation})`,
    )
  }

  return ranked
}
