import type { SSEEvent } from "./types"

export interface EmitterChannel {
  broadcast: (data: unknown, eventType: string, options?: { eventId?: string }) => void
  register: (session: any) => any
  deregister: (session: any) => any
  sessionCount: number
}

export interface EmitterDeps {
  channel: EmitterChannel
  syncInsertEvent: (type: string, data: string) => number
  log: { error: (...args: any[]) => void }
}

/** Pure factory — no module-level singletons, safe for unit tests */
export function createEmitterFromDeps(deps: EmitterDeps) {
  return {
    emitEvent(event: SSEEvent): void {
      const enrichedData = {
        ...event.data,
        timestamp: event.data.timestamp ?? Date.now(),
      }

      // Sync insert — returns auto-increment id for SSE replay
      const id = deps.syncInsertEvent(event.type, JSON.stringify(enrichedData))

      // Silent events persist to DB but skip SSE broadcast
      if (event.silent) return

      try {
        deps.channel.broadcast(enrichedData, event.type, { eventId: String(id) })
      } catch (err) {
        deps.log.error("SSE broadcast failed", err)
      }
    },
    getAgentChannel: () => deps.channel,
    getConnectedClientCount: () => deps.channel.sessionCount,
  }
}
