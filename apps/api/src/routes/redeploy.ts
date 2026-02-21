// apps/api/src/routes/redeploy.ts

import { Router } from "express"
import { eq } from "drizzle-orm"
import { verifyMessage } from "viem"
import { AppError, ErrorCodes } from "../types/errors"
import { publishLimiter } from "../middleware/rate-limiter"
import { db } from "../db"
import { workflows } from "../db/schema"
import { deployWorkflow, handleDeployResult } from "../services/cre/deployer"
import { config } from "../config"
import { createLogger } from "../lib/logger"

const log = createLogger("Redeploy")
const router = Router()

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

router.post(
  "/workflows/:id/redeploy",
  publishLimiter,
  async (req, res, next) => {
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

      // ── Fetch workflow ──
      const workflow = await db
        .select({
          id: workflows.id,
          published: workflows.published,
          deployStatus: workflows.deployStatus,
          ownerAddress: workflows.ownerAddress,
          code: workflows.code,
          config: workflows.config,
        })
        .from(workflows)
        .where(eq(workflows.id, workflowId))
        .get()

      if (!workflow) {
        throw new AppError(
          ErrorCodes.WORKFLOW_NOT_FOUND,
          404,
          "Workflow not found",
        )
      }

      // ── Ownership verification (EIP-191) ──
      const ownerAddress = req.headers["x-owner-address"] as string | undefined
      const ownerSignature = req.headers["x-owner-signature"] as string | undefined

      if (!ownerAddress || !ownerSignature) {
        throw new AppError(
          ErrorCodes.PUBLISH_FAILED,
          403,
          "Missing ownership headers: x-owner-address and x-owner-signature required",
        )
      }

      let verified = false
      try {
        verified = await verifyMessage({
          address: ownerAddress as `0x${string}`,
          message: workflowId,
          signature: ownerSignature as `0x${string}`,
        })
      } catch {
        throw new AppError(ErrorCodes.PUBLISH_FAILED, 403, "Invalid signature format")
      }

      if (!verified) {
        throw new AppError(ErrorCodes.PUBLISH_FAILED, 403, "Signature verification failed")
      }

      if (workflow.ownerAddress.toLowerCase() !== ownerAddress.toLowerCase()) {
        throw new AppError(ErrorCodes.PUBLISH_FAILED, 403, "Not authorized to redeploy this workflow")
      }

      if (!workflow.published) {
        throw new AppError(
          ErrorCodes.WORKFLOW_NOT_PUBLISHED,
          400,
          "Workflow must be published before deploying to DON",
        )
      }

      // ── Guard against redeploying active/pending workflows ──
      if (workflow.deployStatus === "pending") {
        throw new AppError(
          ErrorCodes.DEPLOY_CONFLICT,
          409,
          "Deploy is already in progress",
        )
      }

      if (workflow.deployStatus === "deployed") {
        throw new AppError(
          ErrorCodes.DEPLOY_CONFLICT,
          409,
          "Workflow is already deployed — undeploy first",
        )
      }

      // ── Set status to pending ──
      await db
        .update(workflows)
        .set({
          deployStatus: "pending",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(workflows.id, workflowId))

      res.json({
        workflowId,
        deployStatus: "pending",
        message: "Redeploy initiated",
      })

      // ── Fire-and-forget: Deploy to CRE DON ──
      let configObj: Record<string, unknown> = {}
      try { configObj = JSON.parse(workflow.config) } catch {
        log.warn(`Invalid config JSON for workflow ${workflowId}, using empty config`)
      }

      handleDeployResult(
        workflowId,
        deployWorkflow({
          code: workflow.code,
          configJson: configObj,
          consumerAddress: config.CONSUMER_CONTRACT_ADDRESS,
        }),
        log,
      )
    } catch (err) {
      next(err)
    }
  },
)

export default router
