import { Router } from "express"
import { z } from "zod"
import { db } from "../db"
import { userSettings } from "../db/schema"
import { eq } from "drizzle-orm"
import { AppError, ErrorCodes } from "../types/errors"
import { defaultLimiter } from "../middleware/rate-limiter"

const router = Router()

const UpdateSettingsSchema = z.object({
  displayName: z.string().max(50).nullable().optional(),
  defaultChain: z.string().max(50).optional(),
  webhookUrl: z.string().url().max(500).or(z.literal("")).nullable().optional(),
  notifyDeployFail: z.boolean().optional(),
  notifyExecFail: z.boolean().optional(),
  notifyExecSuccess: z.boolean().optional(),
})

// GET /settings — fetch user settings
router.get("/settings", async (req, res, next) => {
  try {
    const ownerAddress = req.headers["x-owner-address"] as string | undefined
    if (!ownerAddress) {
      throw new AppError(
        ErrorCodes.UNAUTHORIZED,
        403,
        "X-Owner-Address header required",
      )
    }

    const settings = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.ownerAddress, ownerAddress))
      .get()

    if (!settings) {
      // Return defaults for users who haven't saved settings yet
      res.json({
        ownerAddress,
        displayName: null,
        defaultChain: "base-sepolia",
        webhookUrl: null,
        notifyDeployFail: true,
        notifyExecFail: true,
        notifyExecSuccess: false,
      })
      return
    }

    res.json(settings)
  } catch (err) {
    next(err)
  }
})

// PUT /settings — upsert user settings
router.put("/settings", defaultLimiter, async (req, res, next) => {
  try {
    const ownerAddress = req.headers["x-owner-address"] as string | undefined
    if (!ownerAddress) {
      throw new AppError(
        ErrorCodes.UNAUTHORIZED,
        403,
        "X-Owner-Address header required",
      )
    }

    const body = UpdateSettingsSchema.parse(req.body)

    // Check if settings exist
    const existing = await db
      .select({ ownerAddress: userSettings.ownerAddress })
      .from(userSettings)
      .where(eq(userSettings.ownerAddress, ownerAddress))
      .get()

    const now = new Date().toISOString()

    if (existing) {
      await db
        .update(userSettings)
        .set({
          ...(body.displayName !== undefined && { displayName: body.displayName || null }),
          ...(body.defaultChain !== undefined && { defaultChain: body.defaultChain }),
          ...(body.webhookUrl !== undefined && { webhookUrl: body.webhookUrl || null }),
          ...(body.notifyDeployFail !== undefined && { notifyDeployFail: body.notifyDeployFail }),
          ...(body.notifyExecFail !== undefined && { notifyExecFail: body.notifyExecFail }),
          ...(body.notifyExecSuccess !== undefined && { notifyExecSuccess: body.notifyExecSuccess }),
          updatedAt: now,
        })
        .where(eq(userSettings.ownerAddress, ownerAddress))
    } else {
      await db.insert(userSettings).values({
        ownerAddress,
        displayName: body.displayName ?? null,
        defaultChain: body.defaultChain ?? "base-sepolia",
        webhookUrl: body.webhookUrl ?? null,
        notifyDeployFail: body.notifyDeployFail ?? true,
        notifyExecFail: body.notifyExecFail ?? true,
        notifyExecSuccess: body.notifyExecSuccess ?? false,
        updatedAt: now,
      })
    }

    // Return updated settings
    const updated = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.ownerAddress, ownerAddress))
      .get()

    res.json(updated)
  } catch (err) {
    next(err)
  }
})

export default router
