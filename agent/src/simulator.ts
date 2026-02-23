// agent/src/simulator.ts — Pre-execution simulation via Ciel API

import type { SimulationResult } from "./types"
import * as log from "./logger"

const TIMEOUT_MS = 30_000

// ─────────────────────────────────────────────
// Simulate a workflow before paying for execution
// ─────────────────────────────────────────────

export async function simulateWorkflow(
  cielApiUrl: string,
  workflowId: string,
): Promise<SimulationResult | null> {
  await log.step("Pre-execution simulation...")
  await log.detail(`Validating workflow ${workflowId} before payment`)

  try {
    const res = await fetch(`${cielApiUrl}/api/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "stored", workflowId }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      log.warn(`Simulation request failed: HTTP ${res.status} — ${body.slice(0, 100)}`)
      return null
    }

    let data: Record<string, unknown>
    try {
      data = await res.json()
    } catch {
      log.warn("Failed to parse simulation response")
      return null
    }

    const result: SimulationResult = {
      workflowId: typeof data.workflowId === "string" ? data.workflowId : workflowId,
      success: data.success === true,
      trace: Array.isArray(data.trace) ? data.trace as SimulationResult["trace"] : [],
      duration: typeof data.duration === "number" ? data.duration : undefined,
    }

    if (result.success) {
      log.done(`Simulation passed (${result.trace.length} steps, ${result.duration ?? "?"}ms)`)
      for (const step of result.trace) {
        await log.detail(`${step.step}: ${step.status} (${step.duration}ms)`, 200)
      }
    } else {
      log.warn("Simulation failed — workflow may not execute correctly")
      for (const step of result.trace) {
        if (step.status === "error") {
          await log.detail(`${step.step}: ${step.output.slice(0, 120)}`, 200)
        }
      }
    }

    return result
  } catch (err) {
    log.warn(`Simulation unavailable: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}
