"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useSignMessage } from "wagmi"
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
  const { signMessageAsync } = useSignMessage()

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
      let ownerAuth: { address: string; signature: string; timestamp: string } | undefined
      if (ownerAddress) {
        try {
          const timestamp = String(Date.now())
          const signature = await signMessageAsync({
            message: `${savedPipelineId}:${timestamp}`,
          })
          ownerAuth = { address: ownerAddress, signature, timestamp }
        } catch {
          // User rejected signing — proceed without auth
        }
      }

      const result = await executePipelineAction(savedPipelineId, undefined, ownerAuth)
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
    <div className="sticky bottom-0 flex h-14 items-center gap-3 border-t border-border bg-card px-4">
      {/* Name + description */}
      <Input
        placeholder="Pipeline name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="h-8 w-56 text-xs"
      />
      <Input
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="hidden h-8 w-72 text-xs lg:block"
      />

      {/* Stats */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span>{steps.length} step{steps.length !== 1 ? "s" : ""}</span>
        <span>·</span>
        <span className="font-mono">${price} USDC</span>
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
