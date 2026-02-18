import { Router } from "express"
import { SimulateRequestSchema } from "../types/api"
import { AppError, ErrorCodes } from "../types/errors"

const router = Router()

router.post("/simulate", async (req, res, next) => {
  try {
    SimulateRequestSchema.parse(req.body)

    // Stub — will be implemented in doc 06 (simulation engine)
    throw new AppError(
      ErrorCodes.SIMULATION_FAILED,
      501,
      "Simulation not yet implemented",
    )
  } catch (err) {
    next(err)
  }
})

export default router
