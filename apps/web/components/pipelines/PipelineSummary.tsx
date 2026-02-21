"use client"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { usePipelineBuilderStore } from "@/lib/pipeline-builder-store"
import { toastSuccess, toastInfo } from "@/lib/toast"

export function PipelineSummary() {
  const steps = usePipelineBuilderStore((s) => s.steps)
  const name = usePipelineBuilderStore((s) => s.name)
  const description = usePipelineBuilderStore((s) => s.description)
  const setName = usePipelineBuilderStore((s) => s.setName)
  const setDescription = usePipelineBuilderStore((s) => s.setDescription)
  const reset = usePipelineBuilderStore((s) => s.reset)
  const totalPrice = usePipelineBuilderStore((s) => s.totalPrice)

  const price = (totalPrice() / 1_000_000).toFixed(2)

  function handleSave() {
    toastSuccess("Pipeline saved", `"${name || "Untitled"}" saved as draft`)
  }

  function handleExecute() {
    toastInfo("Pipeline execution", "Pipeline execution is not yet available")
  }

  return (
    <div className="sticky bottom-0 flex h-16 items-center gap-4 border-t border-border bg-card px-4">
      {/* Name + description */}
      <Input
        placeholder="Pipeline name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="h-8 w-40 text-xs"
      />
      <Input
        placeholder="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="hidden h-8 w-48 text-xs sm:block"
      />

      {/* Stats */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>{steps.length} step{steps.length !== 1 ? "s" : ""}</span>
        <span className="font-mono">${price}</span>
      </div>

      <div className="flex-1" />

      {/* Actions */}
      <Button variant="ghost" size="sm" onClick={reset} className="text-xs">
        Reset
      </Button>
      <Button variant="outline" size="sm" onClick={handleSave} className="text-xs">
        Save
      </Button>
      <Button size="sm" onClick={handleExecute} className="text-xs">
        Execute
      </Button>
    </div>
  )
}
