import express from "express"
import cors from "cors"
import { config } from "./config"
import { defaultLimiter } from "./middleware/rate-limiter"
import { errorHandler } from "./middleware/error-handler"

// Route imports
import healthRouter from "./routes/health"
import workflowsRouter from "./routes/workflows"
import generateRouter from "./routes/generate"
import simulateRouter from "./routes/simulate"
import publishRouter from "./routes/publish"
import executeRouter from "./routes/execute"
import redeployRouter from "./routes/redeploy"
import eventsRouter from "./routes/events"
import discoverRouter from "./routes/discover"
import pipelinesRouter from "./routes/pipelines"
import { requestId } from "./middleware/request-id"
import { createLogger } from "./lib/logger"
import { checkCRECli } from "./services/cre/compiler"
import { warmDependencyCache } from "./services/cre/dep-cache"
import { sweepStalePendingDeploys } from "./services/cre/deploy-sweep"
import { sweepStaleExecutions } from "./services/pipeline/execution-sweep"

const log = createLogger("Server")

const app = express()

// ── CORS ──
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (curl, server-to-server)
      if (!origin) return callback(null, true)
      const allowed = [
        "http://localhost:3000",
        config.NEXT_PUBLIC_API_URL,
      ]
      if (allowed.includes(origin)) return callback(null, true)
      callback(new Error(`CORS: origin ${origin} not allowed`))
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Owner-Address",
      "X-Owner-Signature",
      "X-Owner-Timestamp",
      "X-Payment",
      "X-Payment-Response",
      "X-Request-Id",
    ],
    exposedHeaders: ["X-Payment-Required", "X-Payment-Address", "X-Request-Id"],
  }),
)

// ── Body parsing ──
app.use(express.json({ limit: "1mb" }))

// ── Request ID (before all routes for correlation) ──
app.use(requestId)

// ── SSE route (before global limiter — has its own eventsSseLimiter) ──
app.use("/api", eventsRouter)

// ── Global rate limiter ──
app.use(defaultLimiter)

// ── Routes (all under /api prefix) ──
app.use("/api", healthRouter)
app.use("/api", workflowsRouter)
app.use("/api", generateRouter)
app.use("/api", simulateRouter)
app.use("/api", publishRouter)
app.use("/api", executeRouter)
app.use("/api", redeployRouter)
app.use("/api", discoverRouter)
app.use("/api", pipelinesRouter)

// ── Error handler (must be last) ──
app.use(errorHandler)

// ── Start server ──
app.listen(config.API_PORT, () => {
  log.info(`Listening on http://localhost:${config.API_PORT}`)
  // Fire-and-forget CRE CLI check — log-only, never crash
  checkCRECli().catch(() => {})
  // Pre-warm dependency cache for faster first simulation
  warmDependencyCache().catch(() => {})
  // Sweep stale pending deploys from previous crashed processes
  sweepStalePendingDeploys().catch(() => {})
  // Sweep stale running pipeline executions from previous crashed processes
  sweepStaleExecutions().catch(() => {})
})

export default app
