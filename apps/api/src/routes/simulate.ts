// apps/api/src/routes/simulate.ts
// NOTE: Mounted as app.use("/api", simulateRouter) — path is "/simulate", NOT "/api/simulate"

import { Router } from "express"
import { eq } from "drizzle-orm"
import { SimulateRequestSchema, type SimulateResponse } from "../types/api"
import { AppError, ErrorCodes } from "../types/errors"
import { simulateWorkflow } from "../services/cre/compiler"
import { toApiTrace } from "../services/cre/parser"
import { db } from "../db"
import { workflows } from "../db/schema"
import { createLogger } from "../lib/logger"
import { LRUCache } from "../lib/lru-cache"
import { simulateLimiter } from "../middleware/rate-limiter"

const log = createLogger("simulate")
const simCache = new LRUCache<SimulateResponse>(50, 5 * 60 * 1000)

const router = Router()

router.post("/simulate", simulateLimiter, async (req, res, next) => {
  try {
    const parsed = SimulateRequestSchema.parse(req.body)

    let code: string
    let configObj: Record<string, unknown>
    let workflowId: string

    if (parsed.mode === "stored") {
      // Fetch code and config from database
      const [workflow] = await db
        .select({ id: workflows.id, code: workflows.code, config: workflows.config })
        .from(workflows)
        .where(eq(workflows.id, parsed.workflowId))
        .limit(1)

      if (!workflow) {
        throw new AppError(
          ErrorCodes.WORKFLOW_NOT_FOUND,
          404,
          `Workflow ${parsed.workflowId} not found`,
        )
      }

      workflowId = workflow.id
      code = workflow.code

      // Safe JSON.parse — corrupt config column → 400 instead of generic 500
      let storedConfig: Record<string, unknown>
      try {
        storedConfig = JSON.parse(workflow.config)
      } catch {
        throw new AppError(
          ErrorCodes.INVALID_INPUT,
          400,
          `Workflow ${workflowId} has corrupt config JSON`,
        )
      }

      configObj = {
        ...storedConfig,
        ...(parsed.config ?? {}),
      }

      // Check result cache (stored mode only)
      const cacheKey = workflowId + ":" + JSON.stringify(configObj)
      const cached = simCache.get(cacheKey)
      if (cached) {
        log.info(`Cache hit for workflow ${workflowId}`)
        res.json(cached)
        return
      }
    } else {
      // Direct code submission (for Workflow Builder preview)
      workflowId = "direct-" + crypto.randomUUID().slice(0, 8)
      code = parsed.code
      configObj = parsed.config
    }

    log.info(
      `Starting — mode: ${parsed.mode}, ` +
      `code: ${code.length} chars, config keys: ${Object.keys(configObj).length}`,
    )

    // Run simulation (configJson is Record<string, unknown> — compiler stringifies internally)
    const result = await simulateWorkflow(code, configObj)

    // Update database with simulation results (only for stored workflows)
    if (parsed.mode === "stored") {
      try {
        await db
          .update(workflows)
          .set({
            simulationSuccess: result.success,
            simulationTrace: JSON.stringify(result.executionTrace),
            simulationDuration: result.duration,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(workflows.id, parsed.workflowId))
      } catch (dbErr) {
        // Log but don't fail the response — simulation result is more important
        log.error("DB update failed:", (dbErr as Error).message)
      }
    }

    // Map internal SimulationStep[] -> SimulateResponse.trace shape
    const response: SimulateResponse = {
      workflowId,
      success: result.success,
      trace: toApiTrace(result.executionTrace),
      duration: result.duration,
    }

    // Cache successful stored-mode results only
    if (parsed.mode === "stored" && result.success) {
      const cacheKey = workflowId + ":" + JSON.stringify(configObj)
      simCache.set(cacheKey, response)
    }

    res.json(response)
  } catch (err) {
    next(err)
  }
})

export default router
