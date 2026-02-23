// agent/src/composer.ts — Auto-compose workflow pipelines

import { randomUUID } from "crypto"

const AGENT_API_URL = process.env.AGENT_API_URL ?? "http://localhost:3001"

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface DiscoveredWorkflow {
  id: string
  name: string
  description: string
  category: string
  priceUsdc: number
  totalExecutions: number
  inputSchema: unknown
  outputSchema: unknown
}

export interface ProposedFieldMapping {
  sourceField: string
  targetField: string
  confidence: number
}

export interface ProposedStep {
  id: string
  workflowId: string
  workflowName: string
  position: number
  inputMapping?: Record<string, { source: string; field: string }>
}

export interface ProposedPipeline {
  name: string
  description: string
  steps: ProposedStep[]
  totalPrice: number
  score: number
  reasoning: string
}

// ─────────────────────────────────────────────
// Known DeFi Capabilities
// ─────────────────────────────────────────────

const CAPABILITY_KEYWORDS: Record<string, string[]> = {
  "price-feed": ["price", "oracle", "feed", "rate", "quote"],
  "dex-swap": ["swap", "dex", "exchange", "trade", "uniswap"],
  alert: ["alert", "notify", "notification", "webhook", "email"],
  compliance: ["compliance", "kyc", "aml", "sanctions", "screening"],
  transfer: ["transfer", "send", "pay", "payout"],
  "evm-write": ["transaction", "contract", "write", "execute", "mint"],
  aggregate: ["aggregate", "combine", "consensus", "multi-source"],
  monitor: ["monitor", "watch", "track", "activity"],
}

// ─────────────────────────────────────────────
// Goal Parsing
// ─────────────────────────────────────────────

export function parseGoalCapabilities(goal: string): string[] {
  const lower = goal.toLowerCase()
  const matched: string[] = []

  for (const [capability, keywords] of Object.entries(CAPABILITY_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      matched.push(capability)
    }
  }

  return matched.length > 0 ? matched : ["price-feed"]
}

// ─────────────────────────────────────────────
// API Helpers
// ─────────────────────────────────────────────

async function fetchCompatibility(
  sourceId: string,
  targetId: string,
): Promise<{ compatible: boolean; score: number; suggestions: ProposedFieldMapping[] }> {
  const res = await fetch(`${AGENT_API_URL}/api/pipelines/check-compatibility`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceWorkflowId: sourceId, targetWorkflowId: targetId }),
  })

  if (!res.ok) return { compatible: false, score: 0, suggestions: [] }
  return res.json()
}

// ─────────────────────────────────────────────
// Reasoning Builder
// ─────────────────────────────────────────────

export function buildReasoning(
  goal: string,
  selectedWorkflows: DiscoveredWorkflow[],
  compatibilityScore: number,
  totalPrice: number,
): string {
  const names = selectedWorkflows.map((w) => w.name).join(" → ")
  const priceStr = (totalPrice / 1_000_000).toFixed(2)

  return [
    `Goal: "${goal}"`,
    `Pipeline: ${names}`,
    `Schema compatibility: ${(compatibilityScore * 100).toFixed(0)}%`,
    `Total cost: $${priceStr}`,
    `Selected ${selectedWorkflows.length} workflows based on capability matching, ` +
      `reliability (execution count), and schema compatibility.`,
  ].join("\n")
}

// ─────────────────────────────────────────────
// Auto-Composer
// ─────────────────────────────────────────────

export async function autoCompose(
  goal: string,
  availableWorkflows: DiscoveredWorkflow[],
): Promise<ProposedPipeline | null> {
  if (availableWorkflows.length === 0) return null

  // 1. Parse goal → capabilities
  const capabilities = parseGoalCapabilities(goal)

  // 2. Match workflows to capabilities
  const matchedByCapability = new Map<string, DiscoveredWorkflow[]>()

  for (const cap of capabilities) {
    const keywords = CAPABILITY_KEYWORDS[cap] ?? []
    const matches = availableWorkflows.filter((wf) => {
      const text = `${wf.name} ${wf.description} ${wf.category}`.toLowerCase()
      return keywords.some((kw) => text.includes(kw))
    })
    if (matches.length > 0) {
      matchedByCapability.set(cap, matches)
    }
  }

  if (matchedByCapability.size === 0) return null

  // 3. Select best per capability by reliability (execution count)
  const selected: DiscoveredWorkflow[] = []
  const usedIds = new Set<string>()

  for (const [, matches] of matchedByCapability) {
    const sorted = [...matches].sort(
      (a, b) => (b.totalExecutions ?? 0) - (a.totalExecutions ?? 0),
    )
    const best = sorted.find((w) => !usedIds.has(w.id))
    if (best) {
      selected.push(best)
      usedIds.add(best.id)
    }
  }

  if (selected.length === 0) return null

  // 4. Pre-generate step IDs so field mappings reference real UUIDs
  //    (executor looks up stepOutputs by step ID, not positional index)
  const stepIds = selected.map(() => randomUUID())

  // 5. Check pairwise schema compatibility and build field mappings
  let totalCompatibility = 0
  let pairCount = 0
  const stepFieldMappings: Map<number, Record<string, { source: string; field: string }>> = new Map()

  for (let i = 0; i < selected.length - 1; i++) {
    const result = await fetchCompatibility(selected[i].id, selected[i + 1].id)
    totalCompatibility += result.score
    pairCount++

    // Build input mapping from suggestions with confidence ≥ 0.5
    if (result.suggestions.length > 0) {
      const mapping: Record<string, { source: string; field: string }> = {}
      for (const suggestion of result.suggestions) {
        if (suggestion.confidence >= 0.5) {
          mapping[suggestion.targetField] = {
            source: stepIds[i],  // Use pre-generated UUID, not positional index
            field: suggestion.sourceField,
          }
        }
      }
      if (Object.keys(mapping).length > 0) {
        stepFieldMappings.set(i + 1, mapping)
      }
    }
  }

  const avgCompatibility = pairCount > 0 ? totalCompatibility / pairCount : 1

  // 6. Calculate total price
  const totalPrice = selected.reduce((sum, wf) => sum + (wf.priceUsdc ?? 0), 0)

  // 7. Build steps with pre-generated IDs
  const steps: ProposedStep[] = selected.map((wf, idx) => ({
    id: stepIds[idx],
    workflowId: wf.id,
    workflowName: wf.name,
    position: idx,
    ...(stepFieldMappings.has(idx) ? { inputMapping: stepFieldMappings.get(idx) } : {}),
  }))

  // 8. Score: compatibility (0.4) + price efficiency (0.3) + reliability (0.3)
  const maxPrice = 1_000_000 // $1 max reference
  const priceEfficiency = Math.max(0, 1 - totalPrice / maxPrice)
  const maxExecutions = Math.max(...selected.map((w) => w.totalExecutions ?? 0), 1)
  const avgReliability =
    selected.reduce((sum, w) => sum + (w.totalExecutions ?? 0), 0) /
    selected.length /
    maxExecutions

  const score =
    avgCompatibility * 0.4 +
    priceEfficiency * 0.3 +
    avgReliability * 0.3

  const reasoning = buildReasoning(goal, selected, avgCompatibility, totalPrice)

  return {
    name: `Auto: ${goal.slice(0, 50)}`,
    description: `Automatically composed pipeline for: ${goal}`,
    steps,
    totalPrice,
    score: Math.round(score * 100) / 100,
    reasoning,
  }
}
