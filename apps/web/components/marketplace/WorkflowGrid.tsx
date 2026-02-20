"use client"

import { useEffect, useMemo } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkflowStore } from "@/lib/store"
import { WorkflowCard } from "./WorkflowCard"

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-20 rounded-full" />
        <div className="flex gap-1">
          <Skeleton className="h-2.5 w-2.5 rounded-full" />
          <Skeleton className="h-2.5 w-2.5 rounded-full" />
        </div>
      </div>
      <Skeleton className="mt-3 h-4 w-3/4" />
      <Skeleton className="mt-2 h-3 w-full" />
      <Skeleton className="mt-1 h-3 w-2/3" />
      <div className="mt-3 flex gap-1.5">
        <Skeleton className="h-5 w-14 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <Skeleton className="mt-3 h-5 w-24" />
      <div className="mt-3 flex gap-4 border-t border-border pt-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-20" />
      </div>
    </div>
  )
}

export function WorkflowGrid() {
  const workflows = useWorkflowStore((s) => s.workflows)
  const isLoading = useWorkflowStore((s) => s.isLoadingWorkflows)
  const filters = useWorkflowStore((s) => s.filters)
  const fetchWorkflows = useWorkflowStore((s) => s.fetchWorkflows)

  useEffect(() => {
    fetchWorkflows()
  }, [fetchWorkflows])

  // Client-side chain filter + sort
  const filtered = useMemo(() => {
    let result = workflows

    // Chain filter (not supported by backend)
    if (filters.chain) {
      result = result.filter((w) => w.chains.includes(filters.chain!))
    }

    // Client-side sort
    switch (filters.sortBy) {
      case "newest":
        // Backend already sorts by totalExecutions desc — keep as-is for now
        break
      case "most-executed":
        result = [...result].sort(
          (a, b) => b.totalExecutions - a.totalExecutions,
        )
        break
      case "price-asc":
        result = [...result].sort((a, b) => a.priceUsdc - b.priceUsdc)
        break
      case "price-desc":
        result = [...result].sort((a, b) => b.priceUsdc - a.priceUsdc)
        break
    }

    return result
  }, [workflows, filters.chain, filters.sortBy])

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    )
  }

  if (filtered.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card">
        <span className="mb-2 font-mono text-lg text-muted-foreground/30">
          {"[ ]"}
        </span>
        <p className="text-sm text-muted-foreground">
          No workflows found
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Try adjusting your filters or search query
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {filtered.map((workflow) => (
        <WorkflowCard key={workflow.id} workflow={workflow} />
      ))}
    </div>
  )
}
