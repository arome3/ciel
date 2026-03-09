"use client"

import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import type { PipelineListItem } from "@/lib/api"
import {
  Play,
  Trash2,
  GitBranch,
  Clock,
  DollarSign,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Undo2,
} from "lucide-react"

function relativeTime(dateStr?: string) {
  if (!dateStr) return ""
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

function formatPrice(totalPrice: string): string {
  const num = Number(totalPrice) / 1_000_000
  return num === 0 ? "Free" : `$${num.toFixed(2)}`
}

function getStepCount(steps: string): number {
  try {
    return JSON.parse(steps).length
  } catch {
    return 0
  }
}

interface LastExecution {
  status: string
  duration: number | null
  createdAt: string
}

interface MyPipelineCardProps {
  pipeline: PipelineListItem
  lastExecution?: LastExecution | null
  onExecute?: (id: string) => void
  onDelete?: (id: string) => void
  onRestore?: (id: string) => void
  onExpand?: (id: string) => void
  isExpanded?: boolean
  isExecuting?: boolean
}

export function MyPipelineCard({
  pipeline,
  lastExecution,
  onExecute,
  onDelete,
  onRestore,
  onExpand,
  isExpanded,
  isExecuting,
}: MyPipelineCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const stepCount = getStepCount(pipeline.steps)

  return (
    <Card className="flex flex-col gap-3 p-4">
      {/* Header: status + active badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-block rounded-md bg-indigo-900/60 px-1.5 py-0.5 text-[10px] font-medium text-indigo-300">
            Pipeline
          </span>
          {pipeline.isActive ? (
            <Badge className="bg-green-900/60 text-green-300 text-[10px]">Active</Badge>
          ) : (
            <Badge variant="outline" className="text-[10px]">Inactive</Badge>
          )}
        </div>
        {lastExecution && (
          <span className={`text-[10px] font-medium ${
            lastExecution.status === "completed"
              ? "text-green-400"
              : lastExecution.status === "failed"
                ? "text-red-400"
                : lastExecution.status === "partial"
                  ? "text-yellow-400"
                  : "text-muted-foreground"
          }`}>
            {lastExecution.status === "completed" ? "Last: passed" :
             lastExecution.status === "failed" ? "Last: failed" :
             lastExecution.status === "partial" ? "Last: partial" :
             `Last: ${lastExecution.status}`}
          </span>
        )}
      </div>

      {/* Name + description */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">
          {pipeline.name}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
          {pipeline.description}
        </p>
      </div>

      {/* Metrics row */}
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <GitBranch className="h-3 w-3" />
          {stepCount} step{stepCount !== 1 ? "s" : ""}
        </span>
        <span className="flex items-center gap-1">
          <RotateCcw className="h-3 w-3" />
          {pipeline.executionCount} run{pipeline.executionCount !== 1 ? "s" : ""}
        </span>
        <span className="flex items-center gap-1">
          <DollarSign className="h-3 w-3" />
          {formatPrice(pipeline.totalPrice)}
        </span>
        <span className="ml-auto flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {relativeTime(pipeline.updatedAt)}
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5">
        {pipeline.isActive && onExecute && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 flex-1 gap-1 text-xs"
            onClick={() => onExecute(pipeline.id)}
            disabled={isExecuting}
          >
            <Play className="h-3 w-3" />
            {isExecuting ? "Running..." : "Execute"}
          </Button>
        )}
        {!pipeline.isActive && onRestore && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 flex-1 gap-1 text-xs"
            onClick={() => onRestore(pipeline.id)}
          >
            <Undo2 className="h-3 w-3" />
            Restore
          </Button>
        )}
        {onExpand && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs text-muted-foreground"
            onClick={() => onExpand(pipeline.id)}
          >
            {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            History
          </Button>
        )}
        {pipeline.isActive && onDelete && (
          confirmDelete ? (
            <div className="flex items-center gap-1">
              <Button
                variant="destructive"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => { onDelete(pipeline.id); setConfirmDelete(false) }}
              >
                Confirm
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )
        )}
      </div>
    </Card>
  )
}
