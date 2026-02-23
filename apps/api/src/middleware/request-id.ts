// apps/api/src/middleware/request-id.ts
// Assigns a unique request ID to every incoming request for log correlation.
// Accepts an upstream X-Request-Id (from load balancers/API gateways) or generates a fresh UUID.

import { randomUUID } from "crypto"
import type { Request, Response, NextFunction } from "express"

// Augment Express Request with requestId
declare global {
  namespace Express {
    interface Request {
      requestId?: string
    }
  }
}

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const id = (req.headers["x-request-id"] as string) || randomUUID()
  req.requestId = id
  res.setHeader("X-Request-Id", id)
  next()
}
