// apps/api/src/services/cre/deploy-sweep.ts
// Startup sweep: marks stale "pending" deploys as "failed".
// Prevents workflows stuck in "pending" state after process crashes.

import { eq, and, lt, inArray } from "drizzle-orm"
import { db } from "../../db"
import { workflows } from "../../db/schema"
import { createLogger } from "../../lib/logger"

const log = createLogger("DeploySweep")

const STALE_THRESHOLD_MS = 5 * 60 * 1000  // 5 minutes

// Convert JS Date to SQLite datetime format (space-separated, no Z)
// Matches the schema default: datetime('now') → "2026-02-21 10:00:00"
function toSqliteDatetime(date: Date): string {
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "")
}

export async function sweepStalePendingDeploys(): Promise<number> {
  try {
    const cutoff = toSqliteDatetime(new Date(Date.now() - STALE_THRESHOLD_MS))

    const stale = await db
      .select({ id: workflows.id })
      .from(workflows)
      .where(
        and(
          eq(workflows.deployStatus, "pending"),
          lt(workflows.updatedAt, cutoff),
        ),
      )
      .limit(100)
      .all()

    if (stale.length === 0) return 0

    if (stale.length === 100) {
      log.warn("Deploy sweep hit limit of 100 — remaining stale deploys will be caught on next restart")
    }

    const staleIds = stale.map((r) => r.id)
    await db.update(workflows)
      .set({
        deployStatus: "failed",
        updatedAt: toSqliteDatetime(new Date()),
      })
      .where(inArray(workflows.id, staleIds))

    log.info(`Swept ${stale.length} stale pending deploy(s) to "failed"`)
    return stale.length
  } catch (err) {
    log.error(`Deploy sweep error: ${(err as Error).message}`)
    return 0
  }
}
