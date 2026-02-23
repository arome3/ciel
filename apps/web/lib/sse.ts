const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"

export interface SSEHandlers {
  onExecution?: (data: unknown) => void
  onPublish?: (data: unknown) => void
  onDiscovery?: (data: unknown) => void
  onPipelineStarted?: (data: unknown) => void
  onPipelineStepCompleted?: (data: unknown) => void
  onPipelineStepFailed?: (data: unknown) => void
  onPipelineCompleted?: (data: unknown) => void
  onOpen?: () => void
}

/**
 * Creates an SSE connection to /api/events with automatic reconnect.
 * Uses addEventListener for named event types (not onmessage).
 * Returns a cleanup function for useEffect.
 */
export function createSSEConnection(
  handlers: SSEHandlers,
  onError?: (err: Event) => void,
): () => void {
  let disposed = false
  let es: EventSource | null = null
  let reconnectDelay = 1000

  function connect() {
    if (disposed) return

    es = new EventSource(`${API_BASE}/api/events`)

    es.addEventListener("open", () => {
      reconnectDelay = 1000
      handlers.onOpen?.()
    })

    es.addEventListener("execution", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data)
        handlers.onExecution?.(data)
      } catch {
        // malformed event data — ignore
      }
    })

    es.addEventListener("publish", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data)
        handlers.onPublish?.(data)
      } catch {
        // malformed event data — ignore
      }
    })

    es.addEventListener("discovery", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data)
        handlers.onDiscovery?.(data)
      } catch {
        // malformed event data — ignore
      }
    })

    es.addEventListener("pipeline_started", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data)
        handlers.onPipelineStarted?.(data)
      } catch {
        // malformed event data — ignore
      }
    })

    es.addEventListener("pipeline_step_completed", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data)
        handlers.onPipelineStepCompleted?.(data)
      } catch {
        // malformed event data — ignore
      }
    })

    es.addEventListener("pipeline_step_failed", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data)
        handlers.onPipelineStepFailed?.(data)
      } catch {
        // malformed event data — ignore
      }
    })

    es.addEventListener("pipeline_completed", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data)
        handlers.onPipelineCompleted?.(data)
      } catch {
        // malformed event data — ignore
      }
    })

    es.onerror = (err) => {
      onError?.(err)
      es?.close()
      if (disposed) return

      // Exponential backoff: 1s → 2s → 4s → ... → max 30s
      setTimeout(connect, reconnectDelay)
      reconnectDelay = Math.min(reconnectDelay * 2, 30_000)
    }
  }

  connect()

  return () => {
    disposed = true
    es?.close()
  }
}
