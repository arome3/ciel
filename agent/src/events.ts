// agent/src/events.ts — SSE event stream listener for real-time platform feedback

import * as log from "./logger"

const MAGENTA = "\x1b[35m"
const RESET = "\x1b[0m"
const DIM = "\x1b[2m"

type EventCallback = (type: string, data: Record<string, unknown>) => void

// ─────────────────────────────────────────────
// SSE Client (manual parsing — no EventSource in Bun)
// ─────────────────────────────────────────────

export class SSEListener {
  private controller: AbortController | null = null
  private connected = false
  private stopped = false
  private callback: EventCallback
  private reconnectAttempts = 0
  private readonly maxReconnects = 3
  private readonly reconnectDelayMs = 2000

  constructor(
    private cielApiUrl: string,
    callback: EventCallback,
  ) {
    this.callback = callback
  }

  async connect(): Promise<void> {
    this.stopped = false
    this.controller = new AbortController()

    try {
      const res = await fetch(`${this.cielApiUrl}/api/events`, {
        headers: { Accept: "text/event-stream" },
        signal: this.controller.signal,
      })

      if (!res.ok || !res.body) {
        log.warn("SSE connection failed — real-time events unavailable")
        return
      }

      this.connected = true
      this.reconnectAttempts = 0
      log.done("Connected to event stream")

      // Parse SSE in background; reconnect on unexpected close
      this.consumeStream(res.body).catch(() => {}).finally(() => {
        this.connected = false
        if (!this.stopped) this.tryReconnect()
      })
    } catch {
      // Connection failed silently — SSE is optional
    }
  }

  private tryReconnect(): void {
    if (this.stopped || this.reconnectAttempts >= this.maxReconnects) return
    this.reconnectAttempts++
    setTimeout(() => {
      if (!this.stopped) this.connect().catch(() => {})
    }, this.reconnectDelayMs * this.reconnectAttempts)
  }

  private async consumeStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let currentType = "message"
    let currentData = ""

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          if (line.startsWith("event:")) {
            currentType = line.slice(6).trim()
          } else if (line.startsWith("data:")) {
            currentData += line.slice(5).trim()
          } else if (line === "") {
            // Empty line = event boundary
            if (currentData) {
              try {
                const parsed = JSON.parse(currentData)
                this.callback(currentType, parsed)
              } catch {
                // Skip malformed events
              }
            }
            currentType = "message"
            currentData = ""
          }
          // Lines starting with ":" are comments (keepalive) — skip
        }
      }
    } finally {
      reader.releaseLock()
      this.connected = false
    }
  }

  disconnect(): void {
    this.stopped = true
    if (this.controller) {
      this.controller.abort()
      this.controller = null
    }
    this.connected = false
  }

  get isConnected(): boolean {
    return this.connected
  }
}

// ─────────────────────────────────────────────
// Default event handler — logs events to terminal
// ─────────────────────────────────────────────

export function createEventLogger(): EventCallback {
  return (type: string, data: Record<string, unknown>) => {
    // Skip system/keepalive events
    if (type === "system") return

    const label = formatEventType(type)
    const detail = formatEventDetail(type, data)
    console.log(`${DIM}  ${MAGENTA}⚡${RESET}${DIM} [${label}] ${detail}${RESET}`)
  }
}

function formatEventType(type: string): string {
  const map: Record<string, string> = {
    execution: "Execution",
    publish: "Publish",
    deploy: "Deploy",
    discovery: "Discovery",
    pipeline_started: "Pipeline",
    pipeline_step_started: "Step",
    pipeline_step_completed: "Step",
    pipeline_step_failed: "Step",
    pipeline_completed: "Pipeline",
    pipeline_failed: "Pipeline",
  }
  return map[type] ?? type
}

function formatEventDetail(type: string, data: Record<string, unknown>): string {
  switch (type) {
    case "execution":
      return `workflow ${shortId(data.workflowId)} — ${data.success ? "success" : "failed"}`
    case "deploy":
      return `workflow ${shortId(data.workflowId)} — ${data.deployStatus}`
    case "pipeline_started":
      return `pipeline ${shortId(data.pipelineId)} started`
    case "pipeline_step_completed":
      return `step ${shortId(data.stepId)} completed (${data.duration}ms)`
    case "pipeline_step_failed":
      return `step ${shortId(data.stepId)} failed: ${data.error ?? "unknown"}`
    case "pipeline_completed":
      return `pipeline ${shortId(data.pipelineId)} completed (${data.duration}ms)`
    case "pipeline_failed":
      return `pipeline ${shortId(data.pipelineId)} failed`
    default:
      return JSON.stringify(data).slice(0, 80)
  }
}

function shortId(id: unknown): string {
  if (typeof id !== "string") return "?"
  return id.length > 12 ? id.slice(0, 8) + "..." : id
}
