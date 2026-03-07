"use client"

import { useState, useEffect } from "react"
import { GripVertical } from "lucide-react"
import { Input } from "@/components/ui/input"
import { getCategoryVariant } from "@/lib/design-tokens"
import { usePipelineBuilderStore } from "@/lib/pipeline-builder-store"

export function WorkflowPalette() {
  const palette = usePipelineBuilderStore((s) => s.palette)
  const isLoadingPalette = usePipelineBuilderStore((s) => s.isLoadingPalette)
  const fetchPalette = usePipelineBuilderStore((s) => s.fetchPalette)
  const [search, setSearch] = useState("")

  useEffect(() => {
    fetchPalette()
  }, [fetchPalette])

  const filtered = search
    ? palette.filter(
        (wf) =>
          wf.name.toLowerCase().includes(search.toLowerCase()) ||
          wf.category.toLowerCase().includes(search.toLowerCase()),
      )
    : palette

  function handleDragStart(
    e: React.DragEvent<HTMLDivElement>,
    workflowId: string,
  ) {
    e.dataTransfer.setData("workflowId", workflowId)
    e.dataTransfer.effectAllowed = "copy"
  }

  return (
    <div className="flex w-[280px] flex-col border-r border-border bg-card">
      <div className="border-b border-border p-3">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Workflows
        </h2>
        <Input
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 text-xs"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {isLoadingPalette ? (
          <div className="space-y-2 p-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-lg bg-muted"
              />
            ))}
          </div>
        ) : (
          <div className="space-y-1.5">
            {filtered.map((wf) => {
              const inCount = Object.keys(
                wf.inputSchema.properties ?? {},
              ).length
              const outCount = Object.keys(
                wf.outputSchema.properties ?? {},
              ).length
              const price = wf.priceUsdc === 0 ? "Free" : `$${(wf.priceUsdc / 1_000_000).toFixed(2)}`

              return (
                <div
                  key={wf.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, wf.id)}
                  className="flex cursor-grab items-start gap-1.5 rounded-lg border border-border bg-background p-2.5 transition-colors hover:border-primary/50 active:cursor-grabbing"
                >
                  <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/40" />
                  <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${getCategoryVariant(wf.category)}`}
                    >
                      {wf.category}
                    </span>
                    <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                      {price}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs font-semibold text-foreground">
                    {wf.name}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground line-clamp-1">
                    {wf.description}
                  </p>
                  <p className="mt-1.5 text-[10px] text-muted-foreground">
                    {inCount} in → {outCount} out
                  </p>
                  </div>
                </div>
              )
            })}

            {filtered.length === 0 && (
              <p className="py-8 text-center text-xs text-muted-foreground">
                {palette.length === 0
                  ? "No published workflows with schemas found"
                  : "No workflows found"}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
