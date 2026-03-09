import { Router } from "express"
import { createSession } from "better-sse"
import { getAgentChannel, getConnectedClientCount } from "../services/events/emitter"
import { MAX_SSE_CLIENTS } from "../services/events/types"
import { AppError, ErrorCodes } from "../types/errors"
import { eventsSseLimiter } from "../middleware/rate-limiter"
import { sqlite } from "../db"
import { createLogger } from "../lib/logger"

const log = createLogger("Events")
const router = Router()

// Prepared statement for Last-Event-ID replay
const replayStmt = sqlite.prepare(
  "SELECT id, type, data FROM events WHERE id > ? ORDER BY id ASC LIMIT 100"
)

router.get("/events", eventsSseLimiter, async (req, res, next) => {
  try {
    const channel = getAgentChannel()

    // ── Client cap — prevent unbounded SSE sessions ──
    if (channel.sessionCount >= MAX_SSE_CLIENTS) {
      throw new AppError(
        ErrorCodes.SSE_CAPACITY_FULL,
        503,
        `SSE capacity reached (max ${MAX_SSE_CLIENTS} clients)`,
      )
    }

    // Built-in keepAlive sends SSE comments (`: keepalive`) natively
    const session = await createSession(req, res, { keepAlive: 30_000 })

    channel.register(session)

    // ── Replay missed events (Last-Event-ID header) ──
    const lastId = session.lastId
    if (lastId) {
      const lastIdNum = parseInt(lastId, 10)
      if (!Number.isNaN(lastIdNum)) {
        const rows = replayStmt.all(lastIdNum) as { id: number; type: string; data: string }[]
        for (const row of rows) {
          try {
            const parsed = JSON.parse(row.data)
            session.push(parsed, row.type, String(row.id))
          } catch {
            // Skip malformed rows
          }
        }
      }
    }

    // Send connection greeting
    session.push({ connectedAt: Date.now() }, "system")

    req.on("close", () => {
      channel.deregister(session)
      log.debug("SSE client disconnected")
    })
  } catch (err) {
    next(err)
  }
})

// GET /events/recent — fetch recent events to seed the activity feed on page load
const recentStmt = sqlite.prepare(
  "SELECT id, type, data, created_at FROM events ORDER BY id DESC LIMIT ?"
)

router.get("/events/recent", (_req, res, next) => {
  try {
    const limit = Math.min(Number(_req.query.limit) || 20, 50)
    const rows = recentStmt.all(limit) as { id: number; type: string; data: string; created_at: string }[]

    const events = rows
      .map((row) => {
        try {
          return { id: row.id, type: row.type, data: JSON.parse(row.data), createdAt: row.created_at }
        } catch {
          return null
        }
      })
      .filter(Boolean)

    res.json({ events })
  } catch (err) {
    next(err)
  }
})

router.get("/events/health", (_req, res) => {
  res.json({
    status: "ok",
    connectedClients: getConnectedClientCount(),
    timestamp: Date.now(),
  })
})

export default router
