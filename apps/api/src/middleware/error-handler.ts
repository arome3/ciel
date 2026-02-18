import type { Request, Response, NextFunction } from "express"
import { ZodError } from "zod"
import { AppError, ErrorCodes } from "../types/errors"
import { config } from "../config"

/**
 * Express error-handling middleware.
 * Must have exactly 4 parameters so Express recognises it (fn.length === 4).
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Known application error
  if (err instanceof AppError) {
    res.status(err.statusCode).json(err.toJSON())
    return
  }

  // Zod validation error → 400
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: ErrorCodes.INVALID_INPUT,
        message: "Validation failed",
        details: {
          issues: err.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
      },
    })
    return
  }

  // Unknown / unexpected error → 500
  const message =
    config.NODE_ENV === "development" && err instanceof Error
      ? err.message
      : "Internal server error"

  console.error("[unhandled]", err)

  res.status(500).json({
    error: {
      code: ErrorCodes.INTERNAL_ERROR,
      message,
    },
  })
}
