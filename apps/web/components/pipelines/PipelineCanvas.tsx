"use client"

import { useState, useRef, useCallback } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { getCategoryVariant } from "@/lib/design-tokens"
import { usePipelineBuilderStore } from "@/lib/pipeline-builder-store"
import { ConnectionLine } from "./ConnectionLine"
import { FieldMapper } from "./FieldMapper"

const STEP_WIDTH = 200
const STEP_HEIGHT = 80

export function PipelineCanvas() {
  const {
    steps,
    connections,
    selectedStepId,
    palette,
    addStep,
    removeStep,
    moveStep,
    selectStep,
    connectSteps,
  } = usePipelineBuilderStore()

  const canvasRef = useRef<HTMLDivElement>(null)
  const [draggingStepId, setDraggingStepId] = useState<string | null>(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(
    null,
  )

  // Handle drop from palette
  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      const workflowId = e.dataTransfer.getData("workflowId")
      if (!workflowId || !canvasRef.current) return

      const rect = canvasRef.current.getBoundingClientRect()
      const x = e.clientX - rect.left - STEP_WIDTH / 2
      const y = e.clientY - rect.top - STEP_HEIGHT / 2
      addStep(workflowId, Math.max(0, x), Math.max(0, y))
    },
    [addStep],
  )

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "copy"
  }, [])

  // Step dragging within canvas
  const handleStepMouseDown = useCallback(
    (e: React.MouseEvent, stepId: string) => {
      if (e.shiftKey) {
        // Shift-click to connect
        if (selectedStepId && selectedStepId !== stepId) {
          connectSteps(selectedStepId, stepId)
          selectStep(null)
        } else {
          selectStep(stepId)
        }
        return
      }

      const step = steps.find((s) => s.id === stepId)
      if (!step) return
      setDraggingStepId(stepId)
      setDragOffset({ x: e.clientX - step.x, y: e.clientY - step.y })
      selectStep(stepId)
    },
    [selectedStepId, steps, connectSteps, selectStep],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!draggingStepId) return
      const x = e.clientX - dragOffset.x
      const y = e.clientY - dragOffset.y
      moveStep(draggingStepId, Math.max(0, x), Math.max(0, y))
    },
    [draggingStepId, dragOffset, moveStep],
  )

  const handleMouseUp = useCallback(() => {
    setDraggingStepId(null)
  }, [])

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === canvasRef.current) {
        selectStep(null)
      }
    },
    [selectStep],
  )

  // Find connection being edited
  const editingConnection = editingConnectionId
    ? connections.find((c) => c.id === editingConnectionId)
    : null
  const editingSourceStep = editingConnection
    ? steps.find((s) => s.id === editingConnection.sourceStepId)
    : null
  const editingTargetStep = editingConnection
    ? steps.find((s) => s.id === editingConnection.targetStepId)
    : null
  const editingSourceWf =
    editingSourceStep
      ? palette.find((w) => w.id === editingSourceStep.workflowId)
      : null
  const editingTargetWf =
    editingTargetStep
      ? palette.find((w) => w.id === editingTargetStep.workflowId)
      : null

  return (
    <div className="relative flex-1">
      <div
        ref={canvasRef}
        className="h-full w-full overflow-auto bg-background"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handleCanvasClick}
      >
        {steps.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">
              Drag workflows from the palette to start building
            </p>
          </div>
        ) : (
          <div className="relative min-h-full min-w-full" style={{ minHeight: 600 }}>
            {/* SVG overlay for connections */}
            <svg className="pointer-events-none absolute inset-0 h-full w-full">
              {connections.map((conn) => {
                const source = steps.find((s) => s.id === conn.sourceStepId)
                const target = steps.find((s) => s.id === conn.targetStepId)
                if (!source || !target) return null
                return (
                  <ConnectionLine
                    key={conn.id}
                    connection={conn}
                    sourceStep={source}
                    targetStep={target}
                    onClick={setEditingConnectionId}
                  />
                )
              })}
            </svg>

            {/* Step cards */}
            {steps.map((step) => {
              const wf = palette.find((w) => w.id === step.workflowId)
              if (!wf) return null
              const isSelected = selectedStepId === step.id

              return (
                <div
                  key={step.id}
                  className={cn(
                    "absolute flex cursor-move flex-col rounded-lg border bg-card p-3 shadow-sm transition-shadow select-none",
                    isSelected
                      ? "border-primary shadow-md ring-1 ring-primary"
                      : "border-border hover:border-primary/50",
                  )}
                  style={{
                    left: step.x,
                    top: step.y,
                    width: STEP_WIDTH,
                    height: STEP_HEIGHT,
                  }}
                  onMouseDown={(e) => handleStepMouseDown(e, step.id)}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${getCategoryVariant(wf.category)}`}
                    >
                      {wf.category}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeStep(step.id)
                      }}
                      className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label={`Remove ${step.name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <p className="mt-1 text-xs font-semibold text-foreground truncate">
                    {step.name}
                  </p>
                  <p className="mt-auto text-[10px] text-muted-foreground">
                    {isSelected ? "Shift+click another to connect" : ""}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Field Mapper Dialog */}
      {editingConnection && editingSourceWf && editingTargetWf && (
        <FieldMapper
          connection={editingConnection}
          sourceWorkflow={editingSourceWf}
          targetWorkflow={editingTargetWf}
          open={!!editingConnectionId}
          onOpenChange={(open) => {
            if (!open) setEditingConnectionId(null)
          }}
        />
      )}
    </div>
  )
}
