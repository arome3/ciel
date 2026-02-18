import { Router } from "express"

const router = Router()

router.get("/events", (req, res) => {
  // SSE headers
  res.setHeader("Content-Type", "text/event-stream")
  res.setHeader("Cache-Control", "no-cache")
  res.setHeader("Connection", "keep-alive")
  res.flushHeaders()

  // Keepalive comment every 30 seconds
  const keepalive = setInterval(() => {
    res.write(":keepalive\n\n")
  }, 30_000)

  // Clean up on client disconnect
  req.on("close", () => {
    clearInterval(keepalive)
    res.end()
  })
})

export default router
