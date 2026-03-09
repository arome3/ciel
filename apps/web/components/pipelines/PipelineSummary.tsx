"use client"

import { useState, useEffect, useRef } from "react"
import { Loader2, CheckCircle, XCircle, Play, RotateCcw } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useSignMessage } from "wagmi"
import { cn } from "@/lib/utils"
import { usePipelineBuilderStore } from "@/lib/pipeline-builder-store"
import { toastSuccess, toastInfo, toastError } from "@/lib/toast"

type ExecutionResult = "idle" | "running" | "completed" | "failed" | "partial"

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
  const [execResult, setExecResult] = useState<ExecutionResult>("idle")
  const [execDuration, setExecDuration] = useState<number | null>(null)
  const resultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const price = (totalPrice() / 1_000_000).toFixed(2)
  const hasRun = execResult !== "idle" && execResult !== "running"

  // Clear result timer on unmount
  useEffect(() => {
    return () => {
      if (resultTimerRef.current) clearTimeout(resultTimerRef.current)
    }
  }, [])

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

    // Clear any previous result timer
    if (resultTimerRef.current) clearTimeout(resultTimerRef.current)
    setExecResult("running")
    setExecDuration(null)
    const startTime = Date.now()

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
      const duration = Date.now() - startTime
      setExecDuration(duration)
      const status = (result as any)?.status
      if (status === "completed") {
        setExecResult("completed")
        toastSuccess("Pipeline completed", "All steps executed successfully")
      } else if (status === "partial") {
        setExecResult("partial")
        toastInfo("Partial completion", "Some steps failed during execution")
      } else {
        setExecResult("failed")
        toastError("Pipeline failed", "Pipeline execution failed")
      }
    } catch {
      setExecResult("failed")
      setExecDuration(Date.now() - startTime)
      toastError("Execution error", "Failed to execute pipeline")
    }
  }

  // Button content based on state
  function renderExecuteButton() {
    if (isExecuting || execResult === "running") {
      return (
        <Button size="sm" disabled className="text-xs gap-1.5 min-w-[100px]">
          <Loader2 className="h-3 w-3 animate-spin" />
          Running...
        </Button>
      )
    }

    if (execResult === "completed") {
      return (
        <Button
          size="sm"
          className="text-xs gap-1.5 min-w-[100px] bg-green-600 hover:bg-green-700"
          onClick={handleExecute}
          disabled={!savedPipelineId}
        >
          <CheckCircle className="h-3 w-3" />
          Completed
          {execDuration && <span className="text-[10px] opacity-70">({(execDuration / 1000).toFixed(1)}s)</span>}
        </Button>
      )
    }

    if (execResult === "partial") {
      return (
        <Button
          size="sm"
          className="text-xs gap-1.5 min-w-[100px] bg-yellow-600 hover:bg-yellow-700"
          onClick={handleExecute}
          disabled={!savedPipelineId}
        >
          <RotateCcw className="h-3 w-3" />
          Partial — Re-run
        </Button>
      )
    }

    if (execResult === "failed") {
      return (
        <Button
          size="sm"
          variant="destructive"
          className="text-xs gap-1.5 min-w-[100px]"
          onClick={handleExecute}
          disabled={!savedPipelineId}
        >
          <XCircle className="h-3 w-3" />
          Failed — Re-run
        </Button>
      )
    }

    // Default: idle / first run
    return (
      <Button
        size="sm"
        onClick={handleExecute}
        disabled={!savedPipelineId}
        className="text-xs gap-1.5 min-w-[100px]"
      >
        <Play className="h-3 w-3" />
        Execute
      </Button>
    )
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
      {renderExecuteButton()}
    </div>
  )
}
