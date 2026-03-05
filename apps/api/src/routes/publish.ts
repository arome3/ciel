import { Router } from "express"
import { eq } from "drizzle-orm"
import { PublishRequestSchema } from "../types/api"
import { AppError, ErrorCodes } from "../types/errors"
import { db } from "../db"
import { workflows } from "../db/schema"
import { deployWorkflow, handleDeployResult } from "../services/cre/deployer"
import { emitEvent } from "../services/events/emitter"
import { publishLimiter } from "../middleware/rate-limiter"
import { config } from "../config"
import { createLogger } from "../lib/logger"

const log = createLogger("Publish")
const router = Router()

router.post("/publish/confirm", publishLimiter, async (req, res, next) => {
  try {
    const { workflowId, txHash, onchainWorkflowId, name, description, priceUsdc } =
      PublishRequestSchema.parse(req.body)

    // ── Ownership check (address must match workflow creator) ──
    const ownerAddress = req.headers["x-owner-address"] as string | undefined

    if (!ownerAddress) {
      throw new AppError(
        ErrorCodes.PUBLISH_FAILED,
        403,
        "Missing X-Owner-Address header",
      )
    }

    // ── Fetch workflow from DB ──
    const workflow = await db
      .select()
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

    const isUnclaimed = workflow.ownerAddress === "0x0000000000000000000000000000000000000000"
    if (!isUnclaimed && workflow.ownerAddress.toLowerCase() !== ownerAddress.toLowerCase()) {
      throw new AppError(
        ErrorCodes.PUBLISH_FAILED,
        403,
        "Not authorized to publish this workflow",
      )
    }

    if (workflow.published) {
      throw new AppError(
        ErrorCodes.PUBLISH_FAILED,
        409,
        "Workflow is already published",
      )
    }

    // ── Build x402 endpoint ──
    const x402Endpoint = `${config.NEXT_PUBLIC_API_URL}/api/workflows/${workflowId}/execute`

    // ── Update DB ──
    await db
      .update(workflows)
      .set({
        published: true,
        onchainWorkflowId,
        publishTxHash: txHash,
        x402Endpoint,
        priceUsdc,
        name,
        description,
        deployStatus: "pending",
        ownerAddress: ownerAddress,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(workflows.id, workflowId))

    log.info(
      `Confirmed publish ${workflowId} — onchain: ${onchainWorkflowId}, tx: ${txHash}`,
    )

    // Response returned immediately — DON deployment is async
    res.json({
      workflowId,
      onchainWorkflowId,
      publishTxHash: txHash,
      x402Endpoint,
      deployStatus: "pending",
      donWorkflowId: null,
    })

    // Fire-and-forget: SSE broadcast (after response to prevent crash propagation)
    emitEvent({
      type: "publish",
      data: {
        workflowId,
        name,
        category: workflow.category,
        txHash,
        timestamp: Date.now(),
      },
    })

    // Fire-and-forget: Deploy to CRE DON (after response)
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
})

export default router
