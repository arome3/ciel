import { Router } from "express"
import { eq } from "drizzle-orm"
import { verifyMessage } from "viem"
import { PublishRequestSchema } from "../types/api"
import { AppError, ErrorCodes } from "../types/errors"
import { db } from "../db"
import { workflows, events } from "../db/schema"
import { publishToRegistry } from "../services/blockchain/registry"
import { publishLimiter } from "../middleware/rate-limiter"
import { config } from "../config"
import { createLogger } from "../lib/logger"

const log = createLogger("Publish")
const router = Router()

router.post("/publish", publishLimiter, async (req, res, next) => {
  try {
    const { workflowId, name, description, priceUsdc } =
      PublishRequestSchema.parse(req.body)

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
      throw new AppError(ErrorCodes.PUBLISH_FAILED, 403, "Not authorized to publish this workflow")
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

    // ── Parse capabilities and chains from JSON strings ──
    let capabilities: string[] = []
    let chains: string[] = []
    try {
      capabilities = JSON.parse(workflow.capabilities)
    } catch {
      log.warn(`Invalid capabilities JSON for ${workflowId}`)
    }
    try {
      chains = JSON.parse(workflow.chains)
    } catch {
      log.warn(`Invalid chains JSON for ${workflowId}`)
    }

    // ── Publish to on-chain registry ──
    const { workflowId: onchainWorkflowId, txHash: publishTxHash } =
      await publishToRegistry({
        name,
        description,
        category: workflow.category,
        supportedChains: [10344971235874465080n],
        capabilities,
        x402Endpoint,
        pricePerExecution: BigInt(priceUsdc),
      })

    // ── Update DB ──
    await db
      .update(workflows)
      .set({
        published: true,
        onchainWorkflowId,
        publishTxHash,
        x402Endpoint,
        priceUsdc,
        name,
        description,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(workflows.id, workflowId))

    // ── Fire-and-forget: SSE event ──
    db.insert(events)
      .values({
        type: "publish",
        data: JSON.stringify({
          workflowId,
          onchainWorkflowId,
          name,
        }),
      })
      .catch((err) => log.error("Failed to insert publish event", err))

    log.info(
      `Published ${workflowId} — onchain: ${onchainWorkflowId}, tx: ${publishTxHash}`,
    )

    res.json({
      workflowId,
      onchainWorkflowId,
      publishTxHash,
      x402Endpoint,
    })
  } catch (err) {
    next(err)
  }
})

export default router
