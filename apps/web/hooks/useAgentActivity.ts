"use client"

import { useEffect } from "react"
import { createSSEConnection } from "@/lib/sse"
import { useWorkflowStore, type SSEEvent } from "@/lib/store"
import { useActivityStore } from "@/lib/activity-store"

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" ? v : fallback
}

export function useAgentActivity() {
  const addAgentEvent = useWorkflowStore((s) => s.addAgentEvent)
  const agentEvents = useWorkflowStore((s) => s.agentEvents)
  const isConnected = useActivityStore((s) => s.isConnected)
  const connectionError = useActivityStore((s) => s.connectionError)
  const setConnected = useActivityStore((s) => s.setConnected)
  const setConnectionError = useActivityStore((s) => s.setConnectionError)

  useEffect(() => {
    const cleanup = createSSEConnection(
      {
        onOpen: () => setConnected(true),
        onExecution: (raw) => {
          const d = raw as Record<string, unknown>
          addAgentEvent({
            type: "execution",
            workflowId: str(d.workflowId),
            workflowName: str(d.workflowName),
            agentAddress: str(d.agentAddress, "anonymous"),
            result: d.result,
            txHash: typeof d.txHash === "string" ? d.txHash : undefined,
            timestamp: num(d.timestamp, Date.now()),
          })
        },
        onPublish: (raw) => {
          const d = raw as Record<string, unknown>
          addAgentEvent({
            type: "publish",
            workflowId: str(d.workflowId),
            workflowName: str(d.name),
            agentAddress: "system",
            category: str(d.category),
            txHash: str(d.txHash),
            timestamp: num(d.timestamp, Date.now()),
          })
        },
        onDiscovery: (raw) => {
          const d = raw as Record<string, unknown>
          addAgentEvent({
            type: "discovery",
            agentAddress: str(d.agentAddress, "anonymous"),
            query: str(d.query),
            matchCount: num(d.matchCount),
            timestamp: num(d.timestamp, Date.now()),
          })
        },
      },
      () => {
        setConnectionError(true)
      },
    )

    return () => {
      cleanup()
      setConnected(false)
    }
  }, [addAgentEvent, setConnected, setConnectionError])

  return { agentEvents, isConnected, connectionError }
}
