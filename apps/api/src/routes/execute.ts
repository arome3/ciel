import { Router } from "express"
import { randomUUID } from "crypto"
import { eq, sql } from "drizzle-orm"
import { AppError, ErrorCodes } from "../types/errors"
import { executeLimiter } from "../middleware/rate-limiter"
import { ownerVerify } from "../middleware/owner-verify"
import { conditionalPayment } from "../services/x402/middleware"
import { db } from "../db"
import { workflows, executions } from "../db/schema"
import { recordExecution } from "../services/blockchain/registry"
import { simulateWorkflow } from "../services/cre/compiler"
import { emitEvent } from "../services/events/emitter"
import { createLogger } from "../lib/logger"
import type { Hex } from "viem"

const log = createLogger("Execute")
const router = Router()

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

router.get(
  "/workflows/:id/execute",
  executeLimiter,
  ownerVerify,
  conditionalPayment,
  async (req, res, next) => {
    const start = Date.now()
    try {
      const workflowId = req.params.id

      // ── Validate workflow ID format ──
      if (!UUID_RE.test(workflowId)) {
        throw new AppError(
          ErrorCodes.INVALID_INPUT,
          400,
          "Invalid workflow ID format",
        )
      }

      // ── Fetch workflow (include code/config for simulation + DON status) ──
      const workflow = await db
        .select({
          id: workflows.id,
          name: workflows.name,
          published: workflows.published,
          priceUsdc: workflows.priceUsdc,
          templateId: workflows.templateId,
          onchainWorkflowId: workflows.onchainWorkflowId,
          donWorkflowId: workflows.donWorkflowId,
          deployStatus: workflows.deployStatus,
          code: workflows.code,
          config: workflows.config,
        })
        .from(workflows)
        .where(eq(workflows.id, workflowId))
        .get()

      if (!workflow || !workflow.published) {
        throw new AppError(
          ErrorCodes.WORKFLOW_NOT_FOUND,
          404,
          "Workflow not found or not published",
        )
      }

      // ── Execute via simulation ──
      let execSuccess = true
      let result: Record<string, unknown>

      try {
        let configObj: Record<string, unknown> = {}
        try { configObj = JSON.parse(workflow.config) } catch {
          log.warn(`Invalid config JSON for workflow ${workflowId}, using empty config`)
        }

        const simResult = await simulateWorkflow(workflow.code, configObj)
        execSuccess = simResult.success
        result = {
          output: simResult.success ? simResult.executionTrace : simResult.errors,
          templateId: workflow.templateId,
          success: simResult.success,
          duration: simResult.duration,
          warnings: simResult.warnings,
        }
      } catch (err) {
        execSuccess = false
        result = {
          output: `Execution error: ${(err as Error).message}`,
          templateId: workflow.templateId,
          success: false,
        }
      }

      const duration = Date.now() - start

      // ── Determine payment info ──
      const isPaid = !req.skipPayment
      const amountUsdc = isPaid ? workflow.priceUsdc : null
      const executionId = randomUUID()

      const executionRecord = {
        id: executionId,
        workflowId,
        agentAddress: req.ownerAddress ?? null,
        paymentTxHash: null,
        amountUsdc: amountUsdc ?? null,
        success: execSuccess,
        result: JSON.stringify(result),
        duration,
      }

      // ── Paid: await insert so record exists before x402 settlement ──
      // ── Owner-bypassed: respond first, insert is non-critical ──
      if (isPaid) {
        await db.insert(executions).values(executionRecord)
      }

      // Beta: always simulates — DON execution requires CRE runtime (not yet available)
      res.json({
        executionId,
        workflowId,
        success: execSuccess,
        result,
        duration,
        donWorkflowId: workflow.donWorkflowId ?? null,
        deployStatus: workflow.deployStatus ?? "none",
        payment: {
          paid: isPaid,
          amountUsdc,
          ownerBypassed: !isPaid,
        },
      })

      // ── Fire-and-forget: SSE broadcast ──
      emitEvent({
        type: "execution",
        data: {
          workflowId,
          workflowName: workflow.name,
          agentAddress: req.ownerAddress ?? "anonymous",
          result,
          timestamp: Date.now(),
        },
      })

      if (!isPaid) {
        db.insert(executions)
          .values(executionRecord)
          .catch((err) => log.error("Failed to insert execution record", err))
      }

      // ── Fire-and-forget: Update workflow stats ──
      db.update(workflows)
        .set({
          totalExecutions: sql`${workflows.totalExecutions} + 1`,
          ...(execSuccess === true ? { successfulExecutions: sql`${workflows.successfulExecutions} + 1` } : {}),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(workflows.id, workflowId))
        .catch((err) => log.error("Failed to update workflow stats", err))

      // ── Fire-and-forget: On-chain recording ──
      if (workflow.onchainWorkflowId) {
        recordExecution(workflow.onchainWorkflowId as Hex, execSuccess)
          .catch((err) => log.error("Failed to record execution on-chain", err))
      }
    } catch (err) {
      next(err)
    }
  },
)

export default router
