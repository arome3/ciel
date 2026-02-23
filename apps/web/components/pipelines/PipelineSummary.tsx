"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { usePipelineBuilderStore } from "@/lib/pipeline-builder-store"
import { toastSuccess, toastInfo, toastError } from "@/lib/toast"

interface PipelineSummaryProps {
  ownerAddress?: string
}

export function PipelineSummary({ ownerAddress }: PipelineSummaryProps) {
  const steps = usePipelineBuilderStore((s) => s.steps)
  const name = usePipelineBuilderStore((s) => s.name)
  const description = usePipelineBuilderStore((s) => s.description)
  const setName = usePipelineBuilderStore((s) => s.setName)
  const setDescription = usePipelineBuilderStore((s) => s.setDescription)
  const reset = usePipelineBuilderStore((s) => s.reset)
  const totalPrice = usePipelineBuilderStore((s) => s.totalPrice)
  const savePipeline = usePipelineBuilderStore((s) => s.savePipeline)
  const executePipelineAction = usePipelineBuilderStore((s) => s.executePipeline)
  const isSaving = usePipelineBuilderStore((s) => s.isSaving)
  const isExecuting = usePipelineBuilderStore((s) => s.isExecuting)

  const [savedPipelineId, setSavedPipelineId] = useState<string | null>(null)

  const price = (totalPrice() / 1_000_000).toFixed(2)

  async function handleSave() {
    if (!ownerAddress) {
      toastError("Connect wallet", "Connect your wallet to save pipelines")
      return
    }
    const id = await savePipeline(ownerAddress)
    if (id) {
      setSavedPipelineId(id)
      toastSuccess("Pipeline saved", `"${name || "Untitled"}" saved successfully`)
    } else {
      toastError("Save failed", "Could not save pipeline. Check that steps are added.")
    }
  }

  async function handleExecute() {
    if (!savedPipelineId) {
      toastInfo("Save first", "Save the pipeline before executing")
      return
    }

    try {
      const result = await executePipelineAction(savedPipelineId)
      const status = (result as any)?.status
      if (status === "completed") {
        toastSuccess("Pipeline completed", "All steps executed successfully")
      } else if (status === "partial") {
        toastInfo("Partial completion", "Some steps failed during execution")
      } else {
        toastError("Pipeline failed", "Pipeline execution failed")
      }
    } catch {
      toastError("Execution error", "Failed to execute pipeline")
    }
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
      <Button
        variant="outline"
        size="sm"
        onClick={handleSave}
        disabled={isSaving || steps.length === 0 || !ownerAddress}
        className="text-xs"
      >
        {isSaving ? "Saving..." : "Save"}
      </Button>
      <Button
        size="sm"
        onClick={handleExecute}
        disabled={isExecuting || !savedPipelineId}
        className="text-xs"
      >
        {isExecuting ? "Running..." : "Execute"}
      </Button>
    </div>
  )
}
