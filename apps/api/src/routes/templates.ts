import { Router } from "express"
import { z } from "zod"
import { db } from "../db"
import { templateRequests, templateRequestVotes } from "../db/schema"
import { eq, desc, sql, and } from "drizzle-orm"
import { AppError, ErrorCodes } from "../types/errors"
import { defaultLimiter } from "../middleware/rate-limiter"
import { TEMPLATES, WILDCARD_TEMPLATE } from "../services/ai-engine/template-matcher"

const router = Router()

// ─────────────────────────────────────────────
// Template catalog
// ─────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  "core-defi": "DeFi",
  institutional: "Finance",
  "risk-compliance": "Security",
  "ai-powered": "AI",
}

const TRIGGER_LABELS: Record<string, string> = {
  cron: "Scheduled",
  http: "On-demand",
  evm_log: "Event-driven",
}

// GET /templates — list all 22 templates
router.get("/templates", (_req, res) => {
  const catalog = TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    categoryLabel: CATEGORY_LABELS[t.category] ?? t.category,
    triggerType: t.triggerType,
    triggerLabel: TRIGGER_LABELS[t.triggerType] ?? t.triggerType,
    capabilities: t.requiredCapabilities,
    description: t.defaultPromptFill,
  }))

  res.json({ templates: catalog, total: catalog.length })
})

// ─────────────────────────────────────────────
// Template requests (community)
// ─────────────────────────────────────────────

const CreateRequestSchema = z.object({
  description: z.string().min(10).max(500),
  category: z.string().max(50).optional(),
  triggerType: z.enum(["cron", "http", "evm_log"]).optional(),
})

const ListRequestsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  sort: z.enum(["votes", "newest"]).default("votes"),
  status: z.enum(["open", "planned", "completed", "all"]).default("open"),
})

// GET /template-requests — list with vote counts
router.get("/template-requests", async (req, res, next) => {
  try {
    const query = ListRequestsSchema.parse(req.query)
    const { page, limit, sort, status } = query
    const offset = (page - 1) * limit

    const conditions = []
    if (status !== "all") {
      conditions.push(eq(templateRequests.status, status))
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    const orderBy = sort === "newest"
      ? desc(templateRequests.createdAt)
      : desc(sql`vote_count`)

    // Join with vote counts using subquery
    const rows = await db.all(sql`
      SELECT
        r.id,
        r.description,
        r.category,
        r.trigger_type as "triggerType",
        r.owner_address as "ownerAddress",
        r.status,
        r.created_at as "createdAt",
        COALESCE(v.cnt, 0) as "voteCount"
      FROM template_requests r
      LEFT JOIN (
        SELECT request_id, COUNT(*) as cnt
        FROM template_request_votes
        GROUP BY request_id
      ) v ON v.request_id = r.id
      ${status !== "all" ? sql`WHERE r.status = ${status}` : sql``}
      ORDER BY ${sort === "newest" ? sql`r.created_at DESC` : sql`vote_count DESC, r.created_at DESC`}
      LIMIT ${limit} OFFSET ${offset}
    `)

    const countResult = await db.all(sql`
      SELECT COUNT(*) as count FROM template_requests
      ${status !== "all" ? sql`WHERE status = ${status}` : sql``}
    `)

    const total = (countResult[0] as { count: number })?.count ?? 0

    res.json({ requests: rows, total, page, limit })
  } catch (err) {
    next(err)
  }
})

// POST /template-requests — create a new request
router.post("/template-requests", defaultLimiter, async (req, res, next) => {
  try {
    const ownerAddress = req.headers["x-owner-address"] as string | undefined
    if (!ownerAddress) {
      throw new AppError(
        ErrorCodes.UNAUTHORIZED,
        403,
        "X-Owner-Address header required to submit a template request",
      )
    }

    const body = CreateRequestSchema.parse(req.body)
    const id = crypto.randomUUID()

    await db.insert(templateRequests).values({
      id,
      description: body.description,
      category: body.category ?? null,
      triggerType: body.triggerType ?? null,
      ownerAddress,
    })

    res.status(201).json({
      id,
      description: body.description,
      category: body.category ?? null,
      triggerType: body.triggerType ?? null,
      ownerAddress,
      status: "open",
      voteCount: 0,
    })
  } catch (err) {
    next(err)
  }
})

// POST /template-requests/:id/vote — toggle upvote
router.post("/template-requests/:id/vote", defaultLimiter, async (req, res, next) => {
  try {
    const requestId = req.params.id
    const voterAddress = req.headers["x-owner-address"] as string | undefined
    if (!voterAddress) {
      throw new AppError(
        ErrorCodes.UNAUTHORIZED,
        403,
        "X-Owner-Address header required to vote",
      )
    }

    // Check request exists
    const request = await db
      .select({ id: templateRequests.id })
      .from(templateRequests)
      .where(eq(templateRequests.id, requestId))
      .get()

    if (!request) {
      throw new AppError(
        ErrorCodes.TEMPLATE_REQUEST_NOT_FOUND,
        404,
        `Template request ${requestId} not found`,
      )
    }

    // Check if already voted
    const existingVote = await db
      .select()
      .from(templateRequestVotes)
      .where(
        and(
          eq(templateRequestVotes.requestId, requestId),
          eq(templateRequestVotes.voterAddress, voterAddress),
        ),
      )
      .get()

    if (existingVote) {
      // Remove vote (toggle off)
      await db
        .delete(templateRequestVotes)
        .where(
          and(
            eq(templateRequestVotes.requestId, requestId),
            eq(templateRequestVotes.voterAddress, voterAddress),
          ),
        )
      res.json({ voted: false })
    } else {
      // Add vote
      await db.insert(templateRequestVotes).values({
        requestId,
        voterAddress,
      })
      res.json({ voted: true })
    }
  } catch (err) {
    next(err)
  }
})

export default router
