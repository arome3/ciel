const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"

export interface SSEHandlers {
  onExecution?: (data: unknown) => void
  onPublish?: (data: unknown) => void
  onDiscovery?: (data: unknown) => void
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

    es.addEventListener("execution", (e) => {
      reconnectDelay = 1000
      try {
        const data = JSON.parse((e as MessageEvent).data)
        handlers.onExecution?.(data)
      } catch {
        // malformed event data — ignore
      }
    })

    es.addEventListener("publish", (e) => {
      reconnectDelay = 1000
      try {
        const data = JSON.parse((e as MessageEvent).data)
        handlers.onPublish?.(data)
      } catch {
        // malformed event data — ignore
      }
    })

    es.addEventListener("discovery", (e) => {
      reconnectDelay = 1000
      try {
        const data = JSON.parse((e as MessageEvent).data)
        handlers.onDiscovery?.(data)
      } catch {
        // malformed event data — ignore
      }
    })

    // Reset backoff on any successful message (keepalive or named)
    es.onmessage = () => {
      reconnectDelay = 1000
    }

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
