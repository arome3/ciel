import { Router } from "express"
import { AppError, ErrorCodes } from "../types/errors"
import { executeLimiter } from "../middleware/rate-limiter"
import { ownerVerify } from "../middleware/owner-verify"

const router = Router()

// x402 payment middleware will be inserted before handler in doc 09
router.get(
  "/workflows/:id/execute",
  executeLimiter,
  ownerVerify,
  async (req, res, next) => {
    try {
      // Stub — will be implemented in doc 08 (CRE execution)
      throw new AppError(
        ErrorCodes.EXECUTION_FAILED,
        501,
        "Execution not yet implemented",
      )
    } catch (err) {
      next(err)
    }
  },
)

export default router
