import { Router } from "express"
import { PublishRequestSchema } from "../types/api"
import { AppError, ErrorCodes } from "../types/errors"

const router = Router()

router.post("/publish", async (req, res, next) => {
  try {
    PublishRequestSchema.parse(req.body)

    // Stub — will be implemented in doc 07 (blockchain publishing)
    throw new AppError(
      ErrorCodes.PUBLISH_FAILED,
      501,
      "Publishing not yet implemented",
    )
  } catch (err) {
    next(err)
  }
})

export default router
