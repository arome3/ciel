"use client"

import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { getCategoryVariant } from "@/lib/design-tokens"
import type { WorkflowListItem } from "@/lib/api"
import { Pencil, Eye, RotateCcw, Trash2 } from "lucide-react"

function getStatusBadge(item: WorkflowListItem) {
  if (!item.published) {
    return <Badge variant="outline" className="text-[10px]">Draft</Badge>
  }
  switch (item.deployStatus) {
    case "deployed":
      return <Badge className="bg-green-900/60 text-green-300 text-[10px]">Deployed</Badge>
    case "pending":
      return <Badge className="bg-yellow-900/60 text-yellow-300 text-[10px]">Pending</Badge>
    case "failed":
      return <Badge className="bg-red-900/60 text-red-300 text-[10px]">Failed</Badge>
    default:
      return <Badge className="bg-blue-900/60 text-blue-300 text-[10px]">Published</Badge>
  }
}

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

interface MyWorkflowCardProps {
  workflow: WorkflowListItem
  onDelete?: (id: string) => void
  onRedeploy?: (id: string) => void
}

export function MyWorkflowCard({ workflow, onDelete, onRedeploy }: MyWorkflowCardProps) {
  const isDraft = !workflow.published
  const isFailed = workflow.deployStatus === "failed"

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-medium ${getCategoryVariant(workflow.category)}`}>
            {workflow.category}
          </span>
          {getStatusBadge(workflow)}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">
          {workflow.name}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
          {workflow.description}
        </p>
      </div>

      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{relativeTime(workflow.updatedAt ?? workflow.createdAt)}</span>
        {workflow.published && workflow.totalExecutions > 0 && (
          <span>{workflow.totalExecutions} executions</span>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        {isDraft ? (
          <>
            <Button variant="outline" size="sm" className="h-7 flex-1 gap-1 text-xs" asChild>
              <Link href={`/workflow/${workflow.id}`}>
                <Pencil className="h-3 w-3" />
                Edit
              </Link>
            </Button>
            {onDelete && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive"
                onClick={() => onDelete(workflow.id)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </>
        ) : (
          <>
            <Button variant="outline" size="sm" className="h-7 flex-1 gap-1 text-xs" asChild>
              <Link href={`/workflow/${workflow.id}`}>
                <Eye className="h-3 w-3" />
                View
              </Link>
            </Button>
            {isFailed && onRedeploy && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => onRedeploy(workflow.id)}
              >
                <RotateCcw className="h-3 w-3" />
                Retry
              </Button>
            )}
          </>
        )}
      </div>
    </Card>
  )
}
