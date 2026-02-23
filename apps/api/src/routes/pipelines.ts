// apps/api/src/routes/pipelines.ts

import { Router } from "express"
import { z } from "zod"
import { eq, desc, and, sql } from "drizzle-orm"
import { verifyMessage } from "viem"
import type { Request, Response, NextFunction } from "express"
import { AppError, ErrorCodes } from "../types/errors"
import { db } from "../db"
import { pipelines, pipelineExecutions, workflows } from "../db/schema"
import { pipelineLimiter, discoverLimiter } from "../middleware/rate-limiter"
import { checkSchemaCompatibility, suggestFieldMappings } from "../services/pipeline/schema-checker"
import { calculatePipelinePrice, getPriceBreakdown } from "../services/pipeline/pricing"
import { executePipeline } from "../services/pipeline/executor"
import { getMetrics } from "../services/pipeline/metrics"
import { LRUCache } from "../lib/lru-cache"
import { createLogger } from "../lib/logger"
import type { JSONSchema } from "../services/pipeline/schema-checker"

const log = createLogger("Pipelines")
const router = Router()

// ─────────────────────────────────────────────
// Suggest cache (single entry, 5min TTL)
// ─────────────────────────────────────────────

const suggestCache = new LRUCache<unknown>(1, 5 * 60 * 1000)
const SUGGEST_CACHE_KEY = "pipeline_suggestions"

// ─────────────────────────────────────────────
// Zod Schemas
// ─────────────────────────────────────────────

const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

const PipelineStepSchema = z.object({
  id: z.string(),
  workflowId: z.string().uuid(),
  position: z.number().int().min(0),
  inputMapping: z.record(z.object({
    source: z.string(),
    field: z.string(),
  })).optional(),
})

const CreatePipelineSchema = z.object({
  name: z.string().min(3).max(100),
  description: z.string().min(10).max(500),
  ownerAddress: z.string().regex(ETH_ADDRESS_RE, "Invalid Ethereum address"),
  steps: z.array(PipelineStepSchema).min(1).max(20),
})

const UpdatePipelineSchema = z.object({
  name: z.string().min(3).max(100).optional(),
  description: z.string().min(10).max(500).optional(),
  steps: z.array(PipelineStepSchema).min(1).max(20).optional(),
})

const ExecutePipelineSchema = z.object({
  triggerInput: z.record(z.unknown()).optional(),
})

const CompatibilityCheckSchema = z.object({
  sourceWorkflowId: z.string().uuid(),
  targetWorkflowId: z.string().uuid(),
})

const PipelinesListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  owner: z.string().optional(),
  active: z.coerce.boolean().optional(),
})

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000  // 5 minutes

// ─────────────────────────────────────────────
// Pipeline Owner Verify Middleware (optional)
// ─────────────────────────────────────────────

async function pipelineOwnerVerify(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const address = req.headers["x-owner-address"] as string | undefined
    const signature = req.headers["x-owner-signature"] as string | undefined
    const timestamp = req.headers["x-owner-timestamp"] as string | undefined

    if (!address || !signature) {
      next()
      return
    }

    const pipelineId = req.params.id
    if (!pipelineId) {
      next()
      return
    }

    // Validate timestamp freshness (optional for verify — skip payment silently fails)
    if (timestamp) {
      const ts = Number(timestamp)
      if (Number.isNaN(ts) || Math.abs(Date.now() - ts) > SIGNATURE_MAX_AGE_MS) {
        next()
        return
      }
    }

    // Signed message format: "{pipelineId}:{timestamp}" or just "{pipelineId}" for legacy
    const message = timestamp ? `${pipelineId}:${timestamp}` : pipelineId

    const valid = await verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    })

    if (!valid) {
      next()
      return
    }

    const pipeline = await db
      .select({ ownerAddress: pipelines.ownerAddress })
      .from(pipelines)
      .where(eq(pipelines.id, pipelineId))
      .get()

    if (!pipeline) {
      next()
      return
    }

    if (pipeline.ownerAddress.toLowerCase() === address.toLowerCase()) {
      req.skipPayment = true
      req.ownerAddress = address
    }
  } catch {
    // Silently fall through
  }

  next()
}

// ─────────────────────────────────────────────
// Pipeline Owner Auth Middleware (required)
// ─────────────────────────────────────────────

async function requirePipelineOwner(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const address = req.headers["x-owner-address"] as string | undefined
    const signature = req.headers["x-owner-signature"] as string | undefined
    const timestamp = req.headers["x-owner-timestamp"] as string | undefined

    if (!address || !signature) {
      throw new AppError(ErrorCodes.UNAUTHORIZED, 401, "Owner authentication required")
    }

    if (!timestamp) {
      throw new AppError(ErrorCodes.UNAUTHORIZED, 401, "Timestamp required")
    }

    const ts = Number(timestamp)
    if (Number.isNaN(ts) || Math.abs(Date.now() - ts) > SIGNATURE_MAX_AGE_MS) {
      throw new AppError(ErrorCodes.UNAUTHORIZED, 401, "Signature expired or invalid timestamp")
    }

    const pipelineId = req.params.id
    if (!pipelineId) {
      throw new AppError(ErrorCodes.INVALID_INPUT, 400, "Pipeline ID required")
    }

    // Signed message format: "{pipelineId}:{timestamp}"
    const message = `${pipelineId}:${timestamp}`

    const valid = await verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    })

    if (!valid) {
      throw new AppError(ErrorCodes.UNAUTHORIZED, 401, "Invalid signature")
    }

    const pipeline = await db
      .select({ ownerAddress: pipelines.ownerAddress })
      .from(pipelines)
      .where(eq(pipelines.id, pipelineId))
      .get()

    if (!pipeline) {
      throw new AppError(ErrorCodes.PIPELINE_NOT_FOUND, 404, "Pipeline not found")
    }

    if (pipeline.ownerAddress.toLowerCase() !== address.toLowerCase()) {
      throw new AppError(ErrorCodes.UNAUTHORIZED, 403, "Not the pipeline owner")
    }

    req.ownerAddress = address
    next()
  } catch (err) {
    next(err)
  }
}

// ─────────────────────────────────────────────
// POST /pipelines — Create pipeline
// ─────────────────────────────────────────────

router.post("/pipelines", pipelineLimiter, async (req, res, next) => {
  try {
    const body = CreatePipelineSchema.parse(req.body)

    const totalPrice = await calculatePipelinePrice(body.steps)

    const [pipeline] = await db
      .insert(pipelines)
      .values({
        name: body.name,
        description: body.description,
        ownerAddress: body.ownerAddress,
        steps: JSON.stringify(body.steps),
        totalPrice,
      })
      .returning()

    res.status(201).json(pipeline)
  } catch (err) {
    next(err)
  }
})

// ─────────────────────────────────────────────
// GET /pipelines — List pipelines
// ─────────────────────────────────────────────

router.get("/pipelines", async (req, res, next) => {
  try {
    const query = PipelinesListQuerySchema.parse(req.query)
    const offset = (query.page - 1) * query.limit

    const conditions = []
    if (query.owner) {
      conditions.push(eq(pipelines.ownerAddress, query.owner))
    }
    if (query.active !== undefined) {
      conditions.push(eq(pipelines.isActive, query.active))
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined

    const rows = await db
      .select()
      .from(pipelines)
      .where(where)
      .orderBy(desc(pipelines.createdAt))
      .limit(query.limit)
      .offset(offset)

    // Count total
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(pipelines)
      .where(where)
      .get()

    res.json({
      pipelines: rows,
      total: countResult?.count ?? 0,
      page: query.page,
      limit: query.limit,
    })
  } catch (err) {
    next(err)
  }
})

// ─────────────────────────────────────────────
// GET /pipelines/suggest — AI-suggested pairs
// (MUST be before /:id)
// ─────────────────────────────────────────────

router.get("/pipelines/suggest", discoverLimiter, async (_req, res, next) => {
  try {
    const cached = suggestCache.get(SUGGEST_CACHE_KEY)
    if (cached) {
      res.json(cached)
      return
    }

    // Query published workflows that have both schemas
    const wfs = await db
      .select({
        id: workflows.id,
        name: workflows.name,
        description: workflows.description,
        category: workflows.category,
        priceUsdc: workflows.priceUsdc,
        inputSchema: workflows.inputSchema,
        outputSchema: workflows.outputSchema,
        totalExecutions: workflows.totalExecutions,
      })
      .from(workflows)
      .where(eq(workflows.published, true))

    // Filter to workflows with both schemas
    const withSchemas = wfs.filter(
      (w) => w.inputSchema && w.outputSchema,
    )

    // Check pairwise compatibility
    const suggestions: Array<{
      source: typeof withSchemas[0]
      target: typeof withSchemas[0]
      score: number
      matchedFields: number
    }> = []

    for (const source of withSchemas) {
      for (const target of withSchemas) {
        if (source.id === target.id) continue

        const result = checkSchemaCompatibility(
          source.outputSchema as JSONSchema,
          target.inputSchema as JSONSchema,
        )

        if (result.score >= 0.5) {
          suggestions.push({
            source,
            target,
            score: result.score,
            matchedFields: result.matchedFields.length,
          })
        }
      }
    }

    // Sort by score descending, take top 20
    suggestions.sort((a, b) => b.score - a.score)
    const top = suggestions.slice(0, 20)

    const response = { suggestions: top }
    suggestCache.set(SUGGEST_CACHE_KEY, response)
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// ─────────────────────────────────────────────
// POST /pipelines/check-compatibility
// ─────────────────────────────────────────────

router.post("/pipelines/check-compatibility", async (req, res, next) => {
  try {
    const body = CompatibilityCheckSchema.parse(req.body)

    const [source, target] = await Promise.all([
      db
        .select({ outputSchema: workflows.outputSchema })
        .from(workflows)
        .where(eq(workflows.id, body.sourceWorkflowId))
        .get(),
      db
        .select({ inputSchema: workflows.inputSchema })
        .from(workflows)
        .where(eq(workflows.id, body.targetWorkflowId))
        .get(),
    ])

    if (!source || !target) {
      throw new AppError(ErrorCodes.WORKFLOW_NOT_FOUND, 404, "Source or target workflow not found")
    }

    const result = checkSchemaCompatibility(
      source.outputSchema as JSONSchema,
      target.inputSchema as JSONSchema,
    )

    res.json(result)
  } catch (err) {
    next(err)
  }
})

// ─────────────────────────────────────────────
// GET /pipelines/metrics — Pipeline execution metrics
// (MUST be before /:id)
// ─────────────────────────────────────────────

router.get("/pipelines/metrics", discoverLimiter, (_req, res) => {
  res.json(getMetrics())
})

// ─────────────────────────────────────────────
// GET /pipelines/:id — Get pipeline details
// ─────────────────────────────────────────────

router.get("/pipelines/:id", async (req, res, next) => {
  try {
    const { id } = req.params
    if (!UUID_RE.test(id)) {
      throw new AppError(ErrorCodes.INVALID_INPUT, 400, "Invalid pipeline ID format")
    }

    const pipeline = await db
      .select()
      .from(pipelines)
      .where(eq(pipelines.id, id))
      .get()

    if (!pipeline) {
      throw new AppError(ErrorCodes.PIPELINE_NOT_FOUND, 404, "Pipeline not found")
    }

    // Parse steps once for both price breakdown and response
    let steps: Array<{ id: string; workflowId: string; position: number }> = []
    try {
      steps = JSON.parse(pipeline.steps)
    } catch {
      // use empty
    }

    const priceBreakdown = await getPriceBreakdown(steps)

    res.json({
      ...pipeline,
      steps,
      priceBreakdown,
    })
  } catch (err) {
    next(err)
  }
})

// ─────────────────────────────────────────────
// PUT /pipelines/:id — Update pipeline
// ─────────────────────────────────────────────

router.put("/pipelines/:id", requirePipelineOwner, async (req, res, next) => {
  try {
    const { id } = req.params
    if (!UUID_RE.test(id)) {
      throw new AppError(ErrorCodes.INVALID_INPUT, 400, "Invalid pipeline ID format")
    }

    const body = UpdatePipelineSchema.parse(req.body)

    const existing = await db
      .select()
      .from(pipelines)
      .where(eq(pipelines.id, id))
      .get()

    if (!existing) {
      throw new AppError(ErrorCodes.PIPELINE_NOT_FOUND, 404, "Pipeline not found")
    }

    const updates: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    }

    if (body.name) updates.name = body.name
    if (body.description) updates.description = body.description
    if (body.steps) {
      updates.steps = JSON.stringify(body.steps)
      updates.totalPrice = await calculatePipelinePrice(body.steps)
    }

    await db
      .update(pipelines)
      .set(updates)
      .where(eq(pipelines.id, id))

    const updated = await db
      .select()
      .from(pipelines)
      .where(eq(pipelines.id, id))
      .get()

    res.json(updated)
  } catch (err) {
    next(err)
  }
})

// ─────────────────────────────────────────────
// DELETE /pipelines/:id — Soft delete
// ─────────────────────────────────────────────

router.delete("/pipelines/:id", requirePipelineOwner, async (req, res, next) => {
  try {
    const { id } = req.params
    if (!UUID_RE.test(id)) {
      throw new AppError(ErrorCodes.INVALID_INPUT, 400, "Invalid pipeline ID format")
    }

    const existing = await db
      .select({ id: pipelines.id })
      .from(pipelines)
      .where(eq(pipelines.id, id))
      .get()

    if (!existing) {
      throw new AppError(ErrorCodes.PIPELINE_NOT_FOUND, 404, "Pipeline not found")
    }

    await db
      .update(pipelines)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(pipelines.id, id))

    res.json({ message: "Pipeline deactivated" })
  } catch (err) {
    next(err)
  }
})

// ─────────────────────────────────────────────
// POST /pipelines/:id/execute — Execute pipeline
// ─────────────────────────────────────────────

router.post(
  "/pipelines/:id/execute",
  pipelineLimiter,
  pipelineOwnerVerify,
  async (req, res, next) => {
    try {
      const { id } = req.params
      if (!UUID_RE.test(id)) {
        throw new AppError(ErrorCodes.INVALID_INPUT, 400, "Invalid pipeline ID format")
      }

      const body = ExecutePipelineSchema.parse(req.body)

      const result = await executePipeline(
        id,
        body.triggerInput ?? {},
        req.ownerAddress,
      )

      res.json(result)
    } catch (err) {
      next(err)
    }
  },
)

// ─────────────────────────────────────────────
// GET /pipelines/:id/history — Execution history
// ─────────────────────────────────────────────

router.get("/pipelines/:id/history", async (req, res, next) => {
  try {
    const { id } = req.params
    if (!UUID_RE.test(id)) {
      throw new AppError(ErrorCodes.INVALID_INPUT, 400, "Invalid pipeline ID format")
    }

    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
    const offset = (page - 1) * limit

    const rows = await db
      .select()
      .from(pipelineExecutions)
      .where(eq(pipelineExecutions.pipelineId, id))
      .orderBy(desc(pipelineExecutions.createdAt))
      .limit(limit)
      .offset(offset)

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(pipelineExecutions)
      .where(eq(pipelineExecutions.pipelineId, id))
      .get()

    // Parse JSON fields
    const executions = rows.map((row) => ({
      ...row,
      stepResults: row.stepResults ? JSON.parse(row.stepResults) : null,
      triggerInput: row.triggerInput ? JSON.parse(row.triggerInput) : null,
      finalOutput: row.finalOutput ? JSON.parse(row.finalOutput) : null,
    }))

    res.json({
      executions,
      total: countResult?.count ?? 0,
      page,
      limit,
    })
  } catch (err) {
    next(err)
  }
})

export default router
