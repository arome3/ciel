"use client"

import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TableCell, TableRow } from "@/components/ui/table"
import type { WorkflowListItem } from "@/lib/api"
import { Eye, RotateCcw, Copy } from "lucide-react"
import { toast } from "sonner"

function deployBadge(status?: string | null) {
  switch (status) {
    case "deployed":
      return <Badge className="bg-green-900/60 text-green-300 text-[10px]">Deployed</Badge>
    case "pending":
      return <Badge className="bg-yellow-900/60 text-yellow-300 text-[10px]">Pending</Badge>
    case "failed":
      return <Badge className="bg-red-900/60 text-red-300 text-[10px]">Failed</Badge>
    default:
      return <Badge variant="outline" className="text-[10px]">None</Badge>
  }
}

interface PublishedWorkflowRowProps {
  workflow: WorkflowListItem
  onRedeploy?: (id: string) => void
}

export function PublishedWorkflowRow({ workflow, onRedeploy }: PublishedWorkflowRowProps) {
  const successRate = workflow.totalExecutions > 0
    ? Math.round((workflow.successfulExecutions / workflow.totalExecutions) * 100)
    : 0

  return (
    <TableRow>
      <TableCell className="font-medium">
        <Link href={`/workflow/${workflow.id}`} className="hover:text-primary transition-colors">
          {workflow.name}
        </Link>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {workflow.priceUsdc === 0 ? "Free" : `$${(workflow.priceUsdc / 1_000_000).toFixed(2)}`}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {workflow.totalExecutions}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {workflow.totalExecutions > 0 ? `${successRate}%` : "—"}
      </TableCell>
      <TableCell>{deployBadge(workflow.deployStatus)}</TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" asChild>
            <Link href={`/workflow/${workflow.id}`}>
              <Eye className="h-3.5 w-3.5" />
            </Link>
          </Button>
          {workflow.deployStatus === "failed" && onRedeploy && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => onRedeploy(workflow.id)}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => {
              navigator.clipboard.writeText(workflow.id)
              toast.success("Workflow ID copied")
            }}
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}
