import { Router } from "express"
import { desc, eq, and, like, sql } from "drizzle-orm"
import { verifyMessage } from "viem"
import { db } from "../db"
import { workflows } from "../db/schema"
import { WorkflowsListQuerySchema } from "../types/api"
import { AppError, ErrorCodes } from "../types/errors"
import { defaultLimiter } from "../middleware/rate-limiter"

const router = Router()

// GET /workflows — list published workflows with pagination + filtering
router.get("/workflows", async (req, res, next) => {
  try {
    const query = WorkflowsListQuerySchema.parse(req.query)
    const { page, limit, category, search, owner } = query
    const offset = (page - 1) * limit

    // Build conditions
    const conditions = [eq(workflows.published, true)]
    if (category) {
      conditions.push(eq(workflows.category, category))
    }
    if (search) {
      conditions.push(like(workflows.name, `%${search}%`))
    }
    if (owner) {
      conditions.push(eq(workflows.ownerAddress, owner))
    }

    const whereClause = and(...conditions)

    // Fetch rows + total count
    const [rows, countResult] = await Promise.all([
      db
        .select()
        .from(workflows)
        .where(whereClause)
        .orderBy(desc(workflows.totalExecutions))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)` })
        .from(workflows)
        .where(whereClause),
    ])

    const total = countResult[0]?.count ?? 0

    res.json({
      workflows: rows.map((w) => ({
        id: w.id,
        name: w.name,
        description: w.description,
        category: w.category,
        priceUsdc: w.priceUsdc,
        capabilities: JSON.parse(w.capabilities),
        chains: JSON.parse(w.chains),
        totalExecutions: w.totalExecutions,
        successfulExecutions: w.successfulExecutions,
        ownerAddress: w.ownerAddress,
      })),
      total,
      page,
      limit,
    })
  } catch (err) {
    next(err)
  }
})

// GET /workflows/:id — get a single workflow by ID
router.get("/workflows/:id", async (req, res, next) => {
  try {
    const workflow = await db
      .select()
      .from(workflows)
      .where(eq(workflows.id, req.params.id))
      .get()

    if (!workflow) {
      throw new AppError(
        ErrorCodes.WORKFLOW_NOT_FOUND,
        404,
        `Workflow ${req.params.id} not found`,
      )
    }

    res.json({
      ...workflow,
      capabilities: JSON.parse(workflow.capabilities),
      chains: JSON.parse(workflow.chains),
      config: JSON.parse(workflow.config),
      simulationTrace: workflow.simulationTrace
        ? JSON.parse(workflow.simulationTrace)
        : null,
      inputSchema: workflow.inputSchema ?? null,
      outputSchema: workflow.outputSchema ?? null,
    })
  } catch (err) {
    next(err)
  }
})

// PATCH /workflows/:id/config — owner updates persistent config defaults
router.patch("/workflows/:id/config", defaultLimiter, async (req, res, next) => {
  try {
    const workflowId = req.params.id
    const { config: newConfig } = req.body ?? {}

    // ── Validate config body ──
    if (
      !newConfig ||
      typeof newConfig !== "object" ||
      Array.isArray(newConfig)
    ) {
      throw new AppError(
        ErrorCodes.INVALID_INPUT,
        400,
        "Body must include a non-null config object",
      )
    }

    // ── Fetch workflow ──
    const workflow = await db
      .select({
        ownerAddress: workflows.ownerAddress,
      })
      .from(workflows)
      .where(eq(workflows.id, workflowId))
      .get()

    if (!workflow) {
      throw new AppError(
        ErrorCodes.WORKFLOW_NOT_FOUND,
        404,
        `Workflow ${workflowId} not found`,
      )
    }

    // ── Verify EIP-191 signature ──
    const address = req.headers["x-owner-address"] as string | undefined
    const signature = req.headers["x-owner-signature"] as string | undefined

    if (!address || !signature) {
      throw new AppError(
        ErrorCodes.UNAUTHORIZED,
        403,
        "Missing authentication headers",
      )
    }

    let valid = false
    try {
      valid = await verifyMessage({
        address: address as `0x${string}`,
        message: workflowId,
        signature: signature as `0x${string}`,
      })
    } catch {
      // invalid signature format
    }

    if (!valid) {
      throw new AppError(
        ErrorCodes.UNAUTHORIZED,
        403,
        "Invalid signature",
      )
    }

    if (workflow.ownerAddress.toLowerCase() !== address.toLowerCase()) {
      throw new AppError(
        ErrorCodes.UNAUTHORIZED,
        403,
        "Not authorized to update this workflow",
      )
    }

    // ── Persist config ──
    await db
      .update(workflows)
      .set({
        config: JSON.stringify(newConfig),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(workflows.id, workflowId))

    res.json({ config: newConfig })
  } catch (err) {
    next(err)
  }
})

export default router
