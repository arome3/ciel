// apps/api/src/services/pipeline/execution-sweep.ts
// Startup sweep: marks stale "running" pipeline executions as "failed".
// Prevents records stuck in "running" state after process crashes (OOM, SIGKILL).
// Pattern mirrors apps/api/src/services/cre/deploy-sweep.ts exactly.

import { eq, and, lt, inArray } from "drizzle-orm"
import { db } from "../../db"
import { pipelineExecutions } from "../../db/schema"
import { createLogger } from "../../lib/logger"

const log = createLogger("PipelineExecutionSweep")

const STALE_THRESHOLD_MS = 10 * 60 * 1000  // 10 min (2× PIPELINE_TIMEOUT_MS)

// Convert JS Date to SQLite datetime format (space-separated, no Z)
// Matches the schema default: datetime('now') → "2026-02-21 10:00:00"
function toSqliteDatetime(date: Date): string {
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "")
}

export async function sweepStaleExecutions(): Promise<number> {
  try {
    const cutoff = toSqliteDatetime(new Date(Date.now() - STALE_THRESHOLD_MS))

    const stale = await db
      .select({ id: pipelineExecutions.id })
      .from(pipelineExecutions)
      .where(
        and(
          eq(pipelineExecutions.status, "running"),
          lt(pipelineExecutions.createdAt, cutoff),
        ),
      )
      .limit(100)
      .all()

    if (stale.length === 0) return 0

    if (stale.length === 100) {
      log.warn("Execution sweep hit limit of 100 — remaining stale records will be caught on next restart")
    }

    const staleIds = stale.map((r) => r.id)
    await db.update(pipelineExecutions)
      .set({
        status: "failed",
        duration: null,
      })
      .where(inArray(pipelineExecutions.id, staleIds))

    log.info(`Swept ${stale.length} stale running pipeline execution(s) to "failed"`)
    return stale.length
  } catch (err) {
    log.error(`Pipeline execution sweep error: ${(err as Error).message}`)
    return 0
  }
}
