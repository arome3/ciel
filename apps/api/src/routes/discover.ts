import { Router } from "express"
import { DiscoverQuerySchema } from "../types/api"
import { AppError, ErrorCodes } from "../types/errors"
import { discoverWorkflows } from "../services/discovery/client"
import { discoverLimiter } from "../middleware/rate-limiter"
import { createLogger } from "../lib/logger"

const log = createLogger("Discover")
const router = Router()

router.get("/discover", discoverLimiter, async (req, res, next) => {
  try {
    const query = DiscoverQuerySchema.parse(req.query)

    log.debug("Discovery request", query)

    const workflows = await discoverWorkflows(query)

    res.json(workflows)
  } catch (err) {
    if (err instanceof AppError) return next(err)
    log.error("Discovery failed", err)
    next(
      new AppError(
        ErrorCodes.DISCOVERY_FAILED,
        500,
        "Discovery request failed",
        { cause: err instanceof Error ? err.message : String(err) },
      ),
    )
  }
})

export default router
