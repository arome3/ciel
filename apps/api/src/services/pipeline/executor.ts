// apps/api/src/services/pipeline/executor.ts

import { randomUUID } from "crypto"
import { eq, sql } from "drizzle-orm"
import { AppError, ErrorCodes } from "../../types/errors"
import { db } from "../../db"
import { pipelines, pipelineExecutions, workflows } from "../../db/schema"
import { simulateWorkflow } from "../cre/compiler"
import { emitEvent } from "../events/emitter"
import { coerceValue } from "./schema-checker"
import { recordExecution, recordStepResult } from "./metrics"
import { createLogger } from "../../lib/logger"
import type { JSONSchema } from "./schema-checker"

const log = createLogger("PipelineExecutor")

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const STEP_TIMEOUT_MS = 60_000        // 60s per step
const PIPELINE_TIMEOUT_MS = 300_000   // 5 min total
const STEP_RETRY_DELAY_MS = 2_000     // 2s before retry
const MIN_RETRY_BUDGET_MS = 5_000     // minimum time left to justify a retry

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface PipelineStepConfig {
  id: string
  workflowId: string
  position: number
  inputMapping?: Record<string, { source: string; field: string }>
}

export interface StepResult {
  stepId: string
  workflowId: string
  workflowName: string
  position: number
  success: boolean
  output: Record<string, unknown> | null
  error: string | null
  duration: number
}

export interface PipelineExecutionResult {
  executionId: string
  pipelineId: string
  status: "completed" | "failed" | "partial"
  stepResults: StepResult[]
  finalOutput: Record<string, unknown> | null
  duration: number
}

// ─────────────────────────────────────────────
// Input Mapping (with type coercion)
// ─────────────────────────────────────────────

export function mapStepInput(
  inputMapping: Record<string, { source: string; field: string }> | undefined,
  triggerInput: Record<string, unknown>,
  stepOutputs: Map<string, Record<string, unknown>>,
  sourceSchemas?: Map<string, JSONSchema | null>,
  targetSchema?: JSONSchema | null,
): Record<string, unknown> {
  if (!inputMapping) return { ...triggerInput }

  const result: Record<string, unknown> = {}
  const targetProps = targetSchema?.properties ?? {}

  for (const [targetField, mapping] of Object.entries(inputMapping)) {
    let value: unknown
    if (mapping.source === "trigger") {
      value = triggerInput[mapping.field]
    } else {
      const sourceOutput = stepOutputs.get(mapping.source)
      value = sourceOutput?.[mapping.field]
    }

    // Apply type coercion when schemas are available and types mismatch
    const targetType = targetProps[targetField]?.type
    if (targetType && value !== undefined && value !== null) {
      const sourceType = typeof value === "number" ? "number"
        : typeof value === "boolean" ? "boolean"
        : "string"
      if (sourceType !== targetType) {
        value = coerceValue(value, sourceType, targetType)
      }
    }

    result[targetField] = value
  }

  return result
}

// ─────────────────────────────────────────────
// Synthetic Output Generation
// ─────────────────────────────────────────────

export function generateSyntheticOutput(
  outputSchema: JSONSchema | null | undefined,
  simSuccess: boolean,
): Record<string, unknown> {
  if (!outputSchema?.properties) return { success: simSuccess }

  const output: Record<string, unknown> = {}

  for (const [key, prop] of Object.entries(outputSchema.properties)) {
    switch (prop.type) {
      case "string":
        output[key] = `${prop.description ?? key}_value`
        break
      case "number":
        output[key] = simSuccess ? 42 : 0
        break
      case "boolean":
        output[key] = simSuccess
        break
      default:
        output[key] = null
    }
  }

  return output
}

// ─────────────────────────────────────────────
// Step Execution with Retry + Deadline Budget
// ─────────────────────────────────────────────

async function executeStep(
  workflow: { id: string; name: string; code: string; config: string; outputSchema: unknown },
  stepConfig: PipelineStepConfig,
  input: Record<string, unknown>,
  pipelineId: string,
  executionId: string,
  pipelineDeadline: number,
): Promise<StepResult> {
  const start = Date.now()

  // Emit step started
  emitEvent({
    type: "pipeline_step_started",
    data: {
      pipelineId,
      executionId,
      stepId: stepConfig.id,
      workflowId: workflow.id,
      position: stepConfig.position,
      timestamp: Date.now(),
    },
  })

  let lastError: string | null = null

  // Try up to 2 times (initial + 1 retry)
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      // Skip retry if insufficient remaining time
      const remaining = pipelineDeadline - Date.now()
      if (remaining < STEP_RETRY_DELAY_MS + MIN_RETRY_BUDGET_MS) {
        break
      }
      log.info(`Retrying step ${stepConfig.id} (attempt ${attempt + 1})`)
      await new Promise((r) => setTimeout(r, STEP_RETRY_DELAY_MS))
    }

    try {
      let configObj: Record<string, unknown> = {}
      try {
        configObj = JSON.parse(workflow.config)
      } catch {
        // use empty config
      }

      // Merge step input into config
      configObj = { ...configObj, ...input }

      // Use the lesser of step timeout and remaining pipeline budget
      const remainingMs = pipelineDeadline - Date.now()
      const stepTimeout = Math.min(STEP_TIMEOUT_MS, Math.max(remainingMs, 0))

      if (stepTimeout <= 0) {
        lastError = "Pipeline deadline exceeded"
        break
      }

      // Execute with timeout
      const simResult = await Promise.race([
        simulateWorkflow(workflow.code, configObj),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Step execution timed out")), stepTimeout),
        ),
      ])

      const duration = Date.now() - start
      const outputSchema = workflow.outputSchema as JSONSchema | null
      const syntheticOutput = generateSyntheticOutput(outputSchema, simResult.success)

      // Emit step completed
      emitEvent({
        type: "pipeline_step_completed",
        data: {
          pipelineId,
          executionId,
          stepId: stepConfig.id,
          workflowName: workflow.name,
          output: syntheticOutput,
          duration,
          timestamp: Date.now(),
        },
      })

      return {
        stepId: stepConfig.id,
        workflowId: workflow.id,
        workflowName: workflow.name,
        position: stepConfig.position,
        success: simResult.success,
        output: syntheticOutput,
        error: simResult.success ? null : simResult.errors.join("; "),
        duration,
      }
    } catch (err) {
      lastError = (err as Error).message
    }
  }

  // Both attempts failed
  const duration = Date.now() - start

  emitEvent({
    type: "pipeline_step_failed",
    data: {
      pipelineId,
      executionId,
      stepId: stepConfig.id,
      error: lastError ?? "Unknown error",
      duration,
      timestamp: Date.now(),
    },
  })

  return {
    stepId: stepConfig.id,
    workflowId: workflow.id,
    workflowName: workflow.name,
    position: stepConfig.position,
    success: false,
    output: null,
    error: lastError,
    duration,
  }
}

// ─────────────────────────────────────────────
// Pipeline Executor
// ─────────────────────────────────────────────

export async function executePipeline(
  pipelineId: string,
  triggerInput: Record<string, unknown> = {},
  agentAddress?: string,
): Promise<PipelineExecutionResult> {
  const pipelineStart = Date.now()

  // Load pipeline
  const pipeline = await db
    .select()
    .from(pipelines)
    .where(eq(pipelines.id, pipelineId))
    .get()

  if (!pipeline) {
    throw new AppError(ErrorCodes.PIPELINE_NOT_FOUND, 404, "Pipeline not found")
  }

  if (!pipeline.isActive) {
    throw new AppError(ErrorCodes.PIPELINE_DEACTIVATED, 400, "Pipeline is deactivated")
  }

  // Parse steps
  let steps: PipelineStepConfig[]
  try {
    steps = JSON.parse(pipeline.steps) as PipelineStepConfig[]
  } catch {
    throw new AppError(ErrorCodes.PIPELINE_EXECUTION_FAILED, 500, "Invalid pipeline steps configuration")
  }

  // Create execution record
  const executionId = randomUUID()
  await db.insert(pipelineExecutions).values({
    id: executionId,
    pipelineId,
    agentAddress: agentAddress ?? null,
    status: "running",
    triggerInput: JSON.stringify(triggerInput),
  })

  // Safety net: ensure execution record gets marked failed on any unhandled error
  try {
    return await _runPipeline(pipeline, steps, executionId, triggerInput, pipelineStart)
  } catch (err) {
    // Mark execution as failed — catch DB errors so they don't mask the original
    db.update(pipelineExecutions)
      .set({ status: "failed", duration: Date.now() - pipelineStart })
      .where(eq(pipelineExecutions.id, executionId))
      .catch((dbErr) => log.error("Failed to mark execution as failed", dbErr))

    throw err
  }
}

// Extracted to keep executePipeline focused on setup + safety net
async function _runPipeline(
  pipeline: {
    id: string
    name: string
    steps: string
    totalPrice: string
    isActive: boolean
  },
  steps: PipelineStepConfig[],
  executionId: string,
  triggerInput: Record<string, unknown>,
  pipelineStart: number,
): Promise<PipelineExecutionResult> {
  const pipelineId = pipeline.id

  // Emit pipeline started
  emitEvent({
    type: "pipeline_started",
    data: {
      pipelineId,
      executionId,
      pipelineName: pipeline.name,
      stepCount: steps.length,
      totalPrice: pipeline.totalPrice,
      timestamp: Date.now(),
    },
  })

  // Load all referenced workflows
  const workflowIds = [...new Set(steps.map((s) => s.workflowId))]
  const wfRows = await Promise.all(
    workflowIds.map((id) =>
      db
        .select({
          id: workflows.id,
          name: workflows.name,
          code: workflows.code,
          config: workflows.config,
          outputSchema: workflows.outputSchema,
          inputSchema: workflows.inputSchema,
        })
        .from(workflows)
        .where(eq(workflows.id, id))
        .get(),
    ),
  )

  const wfMap = new Map(wfRows.filter(Boolean).map((w) => [w!.id, w!]))

  // Build schema maps for coercion
  const outputSchemas = new Map<string, JSONSchema | null>()
  for (const [id, wf] of wfMap) {
    outputSchemas.set(id, (wf.outputSchema as JSONSchema) ?? null)
  }

  // Group steps by position, sort ascending
  const positionGroups = new Map<number, PipelineStepConfig[]>()
  for (const step of steps) {
    const group = positionGroups.get(step.position) ?? []
    group.push(step)
    positionGroups.set(step.position, group)
  }
  const sortedPositions = [...positionGroups.keys()].sort((a, b) => a - b)

  // Execute position groups sequentially
  const allResults: StepResult[] = []
  const stepOutputs = new Map<string, Record<string, unknown>>()
  let failed = false

  // Pipeline-level timeout
  const pipelineDeadline = pipelineStart + PIPELINE_TIMEOUT_MS

  for (const position of sortedPositions) {
    if (failed) break

    // Check pipeline timeout
    if (Date.now() >= pipelineDeadline) {
      log.warn(`Pipeline ${pipelineId} timed out at position ${position}`)
      failed = true
      break
    }

    const group = positionGroups.get(position)!

    // Execute all steps at this position in parallel
    const groupResults = await Promise.all(
      group.map((stepConfig) => {
        const workflow = wfMap.get(stepConfig.workflowId)
        if (!workflow) {
          return Promise.resolve<StepResult>({
            stepId: stepConfig.id,
            workflowId: stepConfig.workflowId,
            workflowName: "Unknown",
            position: stepConfig.position,
            success: false,
            output: null,
            error: "Workflow not found",
            duration: 0,
          })
        }

        // Build target input schema for coercion
        const targetInputSchema = (workflow.inputSchema as JSONSchema) ?? null

        const input = mapStepInput(
          stepConfig.inputMapping,
          triggerInput,
          stepOutputs,
          outputSchemas,
          targetInputSchema,
        )
        return executeStep(workflow, stepConfig, input, pipelineId, executionId, pipelineDeadline)
      }),
    )

    allResults.push(...groupResults)

    // Store outputs and check for failures
    for (const result of groupResults) {
      if (result.success && result.output) {
        stepOutputs.set(result.stepId, result.output)
      }
      if (!result.success) {
        failed = true
      }
    }
  }

  const totalDuration = Date.now() - pipelineStart
  const stepsCompleted = allResults.filter((r) => r.success).length
  const stepsTotal = steps.length

  // Determine status
  let status: "completed" | "failed" | "partial"
  if (stepsCompleted === stepsTotal) {
    status = "completed"
  } else if (stepsCompleted === 0) {
    status = "failed"
  } else {
    status = "partial"
  }

  // Get final output from last successful step
  const lastSuccessful = [...allResults].reverse().find((r) => r.success)
  const finalOutput = lastSuccessful?.output ?? null

  // Record metrics
  recordExecution(status, totalDuration)
  for (const result of allResults) {
    recordStepResult(result.success)
  }

  // CRITICAL: await this — user reads execution history via GET /pipelines/:id/history
  await db.update(pipelineExecutions)
    .set({
      status,
      stepResults: JSON.stringify(allResults),
      finalOutput: finalOutput ? JSON.stringify(finalOutput) : null,
      duration: totalDuration,
    })
    .where(eq(pipelineExecutions.id, executionId))

  // NON-CRITICAL: fire-and-forget is acceptable for advisory count
  db.update(pipelines)
    .set({
      executionCount: sql`${pipelines.executionCount} + 1`,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(pipelines.id, pipelineId))
    .catch((err) => log.error("Failed to update pipeline execution count", err))

  // Emit completion event — separate branches for type safety
  if (status === "failed") {
    emitEvent({
      type: "pipeline_failed",
      data: {
        pipelineId,
        executionId,
        status: "failed" as const,
        finalOutput,
        totalDuration,
        totalPaid: pipeline.totalPrice,
        stepsCompleted,
        stepsTotal,
        timestamp: Date.now(),
      },
    })
  } else {
    emitEvent({
      type: "pipeline_completed",
      data: {
        pipelineId,
        executionId,
        status: status as "completed" | "partial",
        finalOutput,
        totalDuration,
        totalPaid: pipeline.totalPrice,
        stepsCompleted,
        stepsTotal,
        timestamp: Date.now(),
      },
    })
  }

  return {
    executionId,
    pipelineId,
    status,
    stepResults: allResults,
    finalOutput,
    duration: totalDuration,
  }
}
