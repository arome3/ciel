// apps/api/src/services/pipeline/pricing.ts

import { db } from "../../db"
import { workflows } from "../../db/schema"
import { inArray } from "drizzle-orm"

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface PipelineStepDef {
  id: string
  workflowId: string
  position: number
}

export interface PriceBreakdownItem {
  stepId: string
  workflowId: string
  workflowName: string
  priceUsdc: number
  creatorAddress: string
  position: number
}

// ─────────────────────────────────────────────
// Pipeline Pricing
// ─────────────────────────────────────────────

export async function calculatePipelinePrice(
  steps: PipelineStepDef[],
): Promise<string> {
  if (steps.length === 0) return "0"

  const workflowIds = [...new Set(steps.map((s) => s.workflowId))]

  const wfs = await db
    .select({
      id: workflows.id,
      priceUsdc: workflows.priceUsdc,
    })
    .from(workflows)
    .where(inArray(workflows.id, workflowIds))

  const priceMap = new Map(wfs.map((w) => [w.id, w.priceUsdc ?? 0]))

  let total = 0
  for (const step of steps) {
    total += priceMap.get(step.workflowId) ?? 0
  }

  return String(total)
}

export async function getPriceBreakdown(
  steps: PipelineStepDef[],
): Promise<PriceBreakdownItem[]> {
  if (steps.length === 0) return []

  const workflowIds = [...new Set(steps.map((s) => s.workflowId))]

  const wfs = await db
    .select({
      id: workflows.id,
      name: workflows.name,
      priceUsdc: workflows.priceUsdc,
      ownerAddress: workflows.ownerAddress,
    })
    .from(workflows)
    .where(inArray(workflows.id, workflowIds))

  const wfMap = new Map(wfs.map((w) => [w.id, w]))

  return steps.map((step) => {
    const wf = wfMap.get(step.workflowId)
    return {
      stepId: step.id,
      workflowId: step.workflowId,
      workflowName: wf?.name ?? "Unknown",
      priceUsdc: wf?.priceUsdc ?? 0,
      creatorAddress: wf?.ownerAddress ?? "",
      position: step.position,
    }
  })
}
