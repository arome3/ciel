// agent/src/pipelines.ts — Auto-compose and execute multi-workflow pipelines

import { signMessage } from "viem/accounts"
import {
  autoCompose,
  parseGoalCapabilities,
  type DiscoveredWorkflow as ComposerWorkflow,
  type ProposedPipeline,
} from "./composer"
import type {
  DiscoveredWorkflow,
  AgentConfig,
  PipelineResult,
} from "./types"
import * as log from "./logger"

const TIMEOUT_MS = 30_000

// ─────────────────────────────────────────────
// Adapt agent workflows → composer format
// ─────────────────────────────────────────────

function toComposerFormat(workflows: DiscoveredWorkflow[]): ComposerWorkflow[] {
  return workflows.map((wf) => ({
    id: wf.workflowId,
    name: wf.name,
    description: wf.description,
    category: wf.category,
    priceUsdc: wf.priceUsdc,
    totalExecutions: wf.totalExecutions,
    inputSchema: wf.inputSchema ?? {},
    outputSchema: wf.outputSchema ?? {},
  }))
}

// ─────────────────────────────────────────────
// Check if a goal requires multiple workflows
// ─────────────────────────────────────────────

export function goalNeedsPipeline(goal: string): boolean {
  const capabilities = parseGoalCapabilities(goal)
  return capabilities.length >= 2
}

// ─────────────────────────────────────────────
// Compose: discover → match capabilities → build pipeline
// ─────────────────────────────────────────────

export async function composePipeline(
  goal: string,
  workflows: DiscoveredWorkflow[],
): Promise<ProposedPipeline | null> {
  await log.step("Auto-composing pipeline...")
  await log.detail(`Goal: "${goal}"`)

  const capabilities = parseGoalCapabilities(goal)
  await log.detail(`Detected capabilities: ${capabilities.join(", ")}`)

  const composerWorkflows = toComposerFormat(workflows)
  const proposal = await autoCompose(goal, composerWorkflows)

  if (!proposal) {
    log.warn("Could not compose a pipeline — not enough matching workflows")
    return null
  }

  log.done(`Composed "${proposal.name}" (${proposal.steps.length} steps, score: ${proposal.score})`)
  for (const step of proposal.steps) {
    await log.detail(`Step ${step.position + 1}: ${step.workflowName}`, 300)
  }
  await log.detail(`Total price: $${(proposal.totalPrice / 1_000_000).toFixed(4)} USDC`)

  return proposal
}

// ─────────────────────────────────────────────
// Create pipeline on Ciel API
// ─────────────────────────────────────────────

export async function createPipeline(
  config: AgentConfig,
  proposal: ProposedPipeline,
  ownerAddress: string,
): Promise<string | null> {
  await log.step("Creating pipeline on Ciel API...")

  try {
    const res = await fetch(`${config.cielApiUrl}/api/pipelines`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: proposal.name,
        description: proposal.description,
        ownerAddress,
        steps: proposal.steps.map((s) => ({
          id: s.id,
          workflowId: s.workflowId,
          position: s.position,
          ...(s.inputMapping ? { inputMapping: s.inputMapping } : {}),
        })),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      log.error(`Pipeline creation failed: HTTP ${res.status} — ${body.slice(0, 120)}`)
      return null
    }

    let data: Record<string, unknown>
    try {
      data = await res.json()
    } catch {
      log.error("Failed to parse pipeline creation response")
      return null
    }

    const pipelineId = typeof data.id === "string" ? data.id : null
    if (pipelineId) {
      log.done(`Pipeline created: ${pipelineId}`)
    }
    return pipelineId
  } catch (err) {
    log.error(`Pipeline creation failed: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

// ─────────────────────────────────────────────
// Execute pipeline with EIP-191 owner auth
// ─────────────────────────────────────────────

export async function executePipeline(
  config: AgentConfig,
  pipelineId: string,
  privateKey: `0x${string}`,
  triggerInput?: Record<string, unknown>,
): Promise<PipelineResult | null> {
  await log.step(`Executing pipeline ${pipelineId.slice(0, 8)}...`)

  try {
    // Sign EIP-191 message for owner auth: "{pipelineId}:{timestamp}"
    const timestamp = Date.now().toString()
    const message = `${pipelineId}:${timestamp}`
    const signature = await signMessage({ message, privateKey })

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-owner-address": "", // Filled below from account
      "x-owner-signature": signature,
      "x-owner-timestamp": timestamp,
    }

    // Derive address from private key for the header
    const { privateKeyToAccount } = await import("viem/accounts")
    const account = privateKeyToAccount(privateKey)
    headers["x-owner-address"] = account.address

    const res = await fetch(`${config.cielApiUrl}/api/pipelines/${pipelineId}/execute`, {
      method: "POST",
      headers,
      body: JSON.stringify({ triggerInput: triggerInput ?? {} }),
      signal: AbortSignal.timeout(60_000), // Pipelines can take longer
    })

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      log.error(`Pipeline execution failed: HTTP ${res.status} — ${body.slice(0, 120)}`)
      return null
    }

    let data: Record<string, unknown>
    try {
      data = await res.json()
    } catch {
      log.error("Failed to parse pipeline execution response")
      return null
    }

    const result: PipelineResult = {
      executionId: typeof data.executionId === "string" ? data.executionId : "unknown",
      status: (data.status as PipelineResult["status"]) ?? "failed",
      stepResults: Array.isArray(data.stepResults) ? data.stepResults : [],
      finalOutput: data.finalOutput as Record<string, unknown> | undefined,
      duration: typeof data.duration === "number" ? data.duration : 0,
    }

    if (result.status === "completed") {
      log.done(`Pipeline completed in ${result.duration}ms`)
    } else if (result.status === "partial") {
      log.warn(`Pipeline partially completed (${result.stepResults.filter((s) => s.success).length}/${result.stepResults.length} steps)`)
    } else {
      log.error("Pipeline execution failed")
    }

    return result
  } catch (err) {
    log.error(`Pipeline execution failed: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}
