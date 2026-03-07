import { Router } from "express"
import { discoverLimiter } from "../middleware/rate-limiter"
import { getGenerationMetrics, getTemplateMetrics } from "../services/ai-engine/generation-metrics"
import { AppError, ErrorCodes } from "../types/errors"

const router = Router()

router.get("/generation/metrics", discoverLimiter, (req, res, next) => {
  try {
    const windowParam = req.query.window as string | undefined
    const windowHours = windowParam ? parseInt(windowParam, 10) : 24
    if (isNaN(windowHours)) {
      throw new AppError(ErrorCodes.INVALID_INPUT, 400, "window must be a number (hours)")
    }
    const metrics = getGenerationMetrics(windowHours)
    res.json(metrics)
  } catch (err) {
    next(err)
  }
})

router.get("/generation/metrics/templates", discoverLimiter, (req, res, next) => {
  try {
    const windowParam = req.query.window as string | undefined
    const windowHours = windowParam ? parseInt(windowParam, 10) : 24
    if (isNaN(windowHours)) {
      throw new AppError(ErrorCodes.INVALID_INPUT, 400, "window must be a number (hours)")
    }
    const metrics = getTemplateMetrics(windowHours)
    res.json(metrics)
  } catch (err) {
    next(err)
  }
})

export default router
