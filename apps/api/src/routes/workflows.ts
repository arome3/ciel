import { Router } from "express"
import { desc, eq, and, like, sql } from "drizzle-orm"
import { db } from "../db"
import { workflows } from "../db/schema"
import { WorkflowsListQuerySchema } from "../types/api"
import { AppError, ErrorCodes } from "../types/errors"

const router = Router()

// GET /workflows — list published workflows with pagination + filtering
router.get("/workflows", async (req, res, next) => {
  try {
    const query = WorkflowsListQuerySchema.parse(req.query)
    const { page, limit, category, search } = query
    const offset = (page - 1) * limit

    // Build conditions
    const conditions = [eq(workflows.published, true)]
    if (category) {
      conditions.push(eq(workflows.category, category))
    }
    if (search) {
      conditions.push(like(workflows.name, `%${search}%`))
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

export default router
