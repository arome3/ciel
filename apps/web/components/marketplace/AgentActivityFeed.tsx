"use client"

import { ScrollArea } from "@/components/ui/scroll-area"
import { useAgentActivity } from "@/hooks/useAgentActivity"
import type { SSEEvent } from "@/lib/store"

function truncateAddress(address: string): string {
  if (address.length <= 12) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function formatRelativeTime(timestamp: number): string {
  const diff = Math.floor((Date.now() - timestamp) / 1000)
  if (diff < 60) return "just now"
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

const EVENT_BADGES: Record<string, { label: string; className: string }> = {
  execution: { label: "[EXEC]", className: "text-green-400" },
  publish: { label: "[PUB]", className: "text-blue-400" },
  discovery: { label: "[DISC]", className: "text-muted-foreground" },
}

function EventItem({ event }: { event: SSEEvent }) {
  const badge = EVENT_BADGES[event.type] ?? {
    label: `[${event.type.toUpperCase()}]`,
    className: "text-muted-foreground",
  }

  const displayName = event.workflowName ?? event.query ?? "Unknown"

  return (
    <div className="flex items-start gap-3 rounded-lg bg-muted/50 p-3">
      <span className={`font-mono text-xs font-bold ${badge.className}`}>
        {badge.label}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">
          <span className="font-medium">{displayName}</span>
        </p>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">
            {truncateAddress(event.agentAddress)}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatRelativeTime(event.timestamp)}
          </span>
        </div>
        {event.error && (
          <p className="mt-1 text-xs text-red-400">{event.error}</p>
        )}
      </div>
    </div>
  )
}

export function AgentActivityFeed() {
  const { agentEvents, isConnected, connectionError } = useAgentActivity()

  return (
    <div className="rounded-xl border border-border bg-card">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span
          className={`h-2 w-2 rounded-full ${
            isConnected
              ? "animate-pulse bg-green-500"
              : connectionError
                ? "bg-red-500"
                : "bg-yellow-500"
          }`}
        />
        <h3 className="text-sm font-semibold text-foreground">
          Agent Activity
        </h3>
        <span className="text-xs text-muted-foreground">
          {isConnected ? "Live" : connectionError ? "Disconnected" : "Connecting..."}
        </span>
      </div>

      {/* Event list */}
      <ScrollArea className="h-[400px]">
        <div className="space-y-2 p-4" aria-live="polite">
          {agentEvents.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Waiting for agent activity...
            </p>
          ) : (
            agentEvents.map((event, i) => (
              <EventItem
                key={`${event.type}-${event.timestamp}-${i}`}
                event={event}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
