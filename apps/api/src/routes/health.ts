import { Router } from "express"
import { sqlite } from "../db"
import { getConnectedClientCount } from "../services/events/emitter"

const router = Router()
const startTime = Date.now()

router.get("/health", (_req, res) => {
  let dbOk = false
  try {
    sqlite.exec("SELECT 1")
    dbOk = true
  } catch {
    // DB unreachable
  }

  const sseClients = getConnectedClientCount()
  const uptimeMs = Date.now() - startTime

  const status = dbOk ? "ok" : "degraded"
  const statusCode = dbOk ? 200 : 503

  res.status(statusCode).json({
    status,
    timestamp: new Date().toISOString(),
    version: "0.1.0",
    uptime: uptimeMs,
    db: dbOk ? "connected" : "unreachable",
    sseClients,
  })
})

export default router
