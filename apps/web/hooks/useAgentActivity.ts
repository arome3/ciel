"use client"

import { useEffect, useRef } from "react"
import { createSSEConnection } from "@/lib/sse"
import { useWorkflowStore, type SSEEvent } from "@/lib/store"
import { useActivityStore } from "@/lib/activity-store"
import { api } from "@/lib/api"

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" ? v : fallback
}

function mapDbEventToSSE(row: { type: string; data: Record<string, unknown> }): SSEEvent | null {
  const d = row.data
  switch (row.type) {
    case "execution":
      return {
        type: "execution",
        workflowId: str(d.workflowId),
        workflowName: str(d.workflowName),
        agentAddress: str(d.agentAddress, "anonymous"),
        result: d.result,
        txHash: typeof d.txHash === "string" ? d.txHash : undefined,
        timestamp: num(d.timestamp, Date.now()),
      }
    case "publish":
      return {
        type: "publish",
        workflowId: str(d.workflowId),
        workflowName: str(d.name),
        agentAddress: "system",
        category: str(d.category),
        txHash: str(d.txHash),
        timestamp: num(d.timestamp, Date.now()),
      }
    case "discovery":
      return {
        type: "discovery",
        agentAddress: str(d.agentAddress, "anonymous"),
        query: str(d.query),
        matchCount: num(d.matchCount),
        timestamp: num(d.timestamp, Date.now()),
      }
    case "pipeline_started":
      return {
        type: "pipeline",
        workflowName: str(d.pipelineName, "Pipeline"),
        agentAddress: "system",
        timestamp: num(d.timestamp, Date.now()),
      }
    case "pipeline_completed":
      return {
        type: "pipeline",
        workflowName: str(d.pipelineName, "Pipeline"),
        agentAddress: "system",
        result: d.finalOutput,
        timestamp: num(d.timestamp, Date.now()),
      }
    case "pipeline_failed":
      return {
        type: "pipeline",
        workflowName: str(d.pipelineName, "Pipeline"),
        agentAddress: "system",
        error: "Pipeline execution failed",
        timestamp: num(d.timestamp, Date.now()),
      }
    case "deploy":
      return {
        type: "deploy",
        workflowId: str(d.workflowId),
        workflowName: str(d.workflowName, "Workflow"),
        agentAddress: "system",
        error: d.status === "failed" ? str(d.error, "Deploy failed") : undefined,
        timestamp: num(d.timestamp, Date.now()),
      }
    default:
      // Skip pipeline_step_* and other granular events
      return null
  }
}

export function useAgentActivity() {
  const addAgentEvent = useWorkflowStore((s) => s.addAgentEvent)
  const agentEvents = useWorkflowStore((s) => s.agentEvents)
  const isConnected = useActivityStore((s) => s.isConnected)
  const connectionError = useActivityStore((s) => s.connectionError)
  const setConnected = useActivityStore((s) => s.setConnected)
  const setConnectionError = useActivityStore((s) => s.setConnectionError)
  const seededRef = useRef(false)

  // Seed the feed with recent events from DB on first mount
  useEffect(() => {
    if (seededRef.current) return
    seededRef.current = true

    api.getRecentEvents(20).then((res) => {
      // Events come newest-first from the API; reverse so oldest are added first
      const reversed = [...res.events].reverse()
      for (const row of reversed) {
        const mapped = mapDbEventToSSE(row)
        if (mapped) addAgentEvent(mapped)
      }
    }).catch(() => {
      // Silently ignore — feed will still work via SSE
    })
  }, [addAgentEvent])

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
