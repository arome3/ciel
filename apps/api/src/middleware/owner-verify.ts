import type { Request, Response, NextFunction } from "express"
import { verifyMessage } from "viem"
import { db } from "../db"
import { workflows } from "../db/schema"
import { eq } from "drizzle-orm"

// Augment Express Request with owner-verification fields
declare global {
  namespace Express {
    interface Request {
      skipPayment?: boolean
      ownerAddress?: string
    }
  }
}

/**
 * Middleware that verifies workflow ownership via EIP-191 signature.
 * Falls through silently on any failure — downstream middleware (x402)
 * will handle payment if skipPayment is not set.
 */
export async function ownerVerify(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const address = req.headers["x-owner-address"] as string | undefined
    const signature = req.headers["x-owner-signature"] as string | undefined

    if (!address || !signature) {
      next()
      return
    }

    const workflowId = req.params.id
    if (!workflowId) {
      next()
      return
    }

    // Verify the signature of the workflow ID
    const valid = await verifyMessage({
      address: address as `0x${string}`,
      message: workflowId,
      signature: signature as `0x${string}`,
    })

    if (!valid) {
      next()
      return
    }

    // Look up workflow owner
    const workflow = await db
      .select({ ownerAddress: workflows.ownerAddress })
      .from(workflows)
      .where(eq(workflows.id, workflowId))
      .get()

    if (!workflow) {
      next()
      return
    }

    // Case-insensitive address comparison
    if (workflow.ownerAddress.toLowerCase() === address.toLowerCase()) {
      req.skipPayment = true
      req.ownerAddress = address
    }
  } catch {
    // Silently fall through on any error
  }

  next()
}
