"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { X, ZoomIn, ZoomOut, Maximize, AlignHorizontalSpaceBetween, GitBranch } from "lucide-react"
import { cn } from "@/lib/utils"
import { getCategoryVariant } from "@/lib/design-tokens"
import { usePipelineBuilderStore, snapToGrid } from "@/lib/pipeline-builder-store"
import { ConnectionLine } from "./ConnectionLine"
import { FieldMapper } from "./FieldMapper"
import { Button } from "@/components/ui/button"

const STEP_WIDTH = 220
const STEP_HEIGHT = 96
const GRID_SIZE = 20
const MIN_ZOOM = 0.4
const MAX_ZOOM = 2.0
const ZOOM_STEP = 0.1
const TIDY_GAP_X = 100
const TIDY_GAP_Y = 40

export function PipelineCanvas() {
  const {
    steps,
    connections,
    selectedStepId,
    palette,
    connectingFrom,
    connectingMouse,
    addStep,
    removeStep,
    moveStep,
    selectStep,
    connectSteps,
    startConnecting,
    updateConnectingMouse,
    cancelConnecting,
    undo,
    redo,
  } = usePipelineBuilderStore()

  const canvasRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [draggingStepId, setDraggingStepId] = useState<string | null>(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null)

  // Canvas transform state
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })

  // Convert client coords to canvas coords accounting for zoom + pan
  const toCanvasCoords = useCallback(
    (clientX: number, clientY: number) => {
      if (!canvasRef.current) return { x: 0, y: 0 }
      const rect = canvasRef.current.getBoundingClientRect()
      return {
        x: (clientX - rect.left - pan.x) / zoom,
        y: (clientY - rect.top - pan.y) / zoom,
      }
    },
    [zoom, pan],
  )

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault()
        if (e.shiftKey) {
          redo()
        } else {
          undo()
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [undo, redo])

  // Handle drop from palette
  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      const workflowId = e.dataTransfer.getData("workflowId")
      if (!workflowId) return

      const { x, y } = toCanvasCoords(e.clientX, e.clientY)
      addStep(workflowId, Math.max(0, x - STEP_WIDTH / 2), Math.max(0, y - STEP_HEIGHT / 2))
    },
    [addStep, toCanvasCoords],
  )

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "copy"
  }, [])

  // Step dragging within canvas
  const handleStepMouseDown = useCallback(
    (e: React.MouseEvent, stepId: string) => {
      // Shift-click to connect (secondary method)
      if (e.shiftKey) {
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
      setDragOffset({
        x: e.clientX / zoom - step.x,
        y: e.clientY / zoom - step.y,
      })
      selectStep(stepId)
      e.stopPropagation()
    },
    [selectedStepId, steps, connectSteps, selectStep, zoom],
  )

  // Connection handle events
  const handleOutputMouseDown = useCallback(
    (e: React.MouseEvent, stepId: string) => {
      e.stopPropagation()
      e.preventDefault()
      startConnecting(stepId)
    },
    [startConnecting],
  )

  const handleInputMouseUp = useCallback(
    (e: React.MouseEvent, stepId: string) => {
      e.stopPropagation()
      if (connectingFrom && connectingFrom.stepId !== stepId) {
        connectSteps(connectingFrom.stepId, stepId)
      }
      cancelConnecting()
    },
    [connectingFrom, connectSteps, cancelConnecting],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      // Connection drag preview
      if (connectingFrom) {
        const { x, y } = toCanvasCoords(e.clientX, e.clientY)
        updateConnectingMouse(x, y)
        return
      }

      // Panning
      if (isPanning) {
        setPan({
          x: e.clientX - panStart.x,
          y: e.clientY - panStart.y,
        })
        return
      }

      // Step dragging
      if (!draggingStepId) return
      const x = e.clientX / zoom - dragOffset.x
      const y = e.clientY / zoom - dragOffset.y
      moveStep(draggingStepId, Math.max(0, x), Math.max(0, y))
    },
    [connectingFrom, isPanning, draggingStepId, dragOffset, moveStep, zoom, toCanvasCoords, updateConnectingMouse, panStart],
  )

  const handleMouseUp = useCallback(() => {
    if (connectingFrom) {
      cancelConnecting()
    }
    setDraggingStepId(null)
    setIsPanning(false)
  }, [connectingFrom, cancelConnecting])

  // Canvas click/pan
  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only start pan on direct canvas/content click (not on nodes)
      if (e.target === canvasRef.current || e.target === contentRef.current) {
        setIsPanning(true)
        setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
        selectStep(null)
      }
    },
    [selectStep, pan],
  )

  // Zoom with Cmd/Ctrl + scroll
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault()
        const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP
        setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z + delta)))
      }
    },
    [],
  )

  // Fit all nodes in view
  const fitToView = useCallback(() => {
    if (steps.length === 0 || !canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const s of steps) {
      minX = Math.min(minX, s.x)
      minY = Math.min(minY, s.y)
      maxX = Math.max(maxX, s.x + STEP_WIDTH)
      maxY = Math.max(maxY, s.y + STEP_HEIGHT)
    }

    const contentW = maxX - minX + 80
    const contentH = maxY - minY + 80
    const scaleX = rect.width / contentW
    const scaleY = rect.height / contentH
    const newZoom = Math.min(Math.max(Math.min(scaleX, scaleY), MIN_ZOOM), 1.5)

    setPan({
      x: (rect.width - contentW * newZoom) / 2 - minX * newZoom + 40 * newZoom,
      y: (rect.height - contentH * newZoom) / 2 - minY * newZoom + 40 * newZoom,
    })
    setZoom(newZoom)
  }, [steps])

  // Auto-layout: left-to-right DAG
  const autoLayout = useCallback(() => {
    if (steps.length === 0) return

    // Build adjacency: which steps are sources (no incoming) vs connected
    const incoming = new Map<string, string[]>()
    const outgoing = new Map<string, string[]>()
    for (const s of steps) {
      incoming.set(s.id, [])
      outgoing.set(s.id, [])
    }
    for (const c of connections) {
      outgoing.get(c.sourceStepId)?.push(c.targetStepId)
      incoming.get(c.targetStepId)?.push(c.sourceStepId)
    }

    // Topological sort into columns
    const columns: string[][] = []
    const placed = new Set<string>()

    // Sources first (no incoming edges)
    const sources = steps.filter((s) => (incoming.get(s.id)?.length ?? 0) === 0)
    if (sources.length > 0) {
      columns.push(sources.map((s) => s.id))
      sources.forEach((s) => placed.add(s.id))
    }

    // BFS for remaining
    let safety = 0
    while (placed.size < steps.length && safety++ < 20) {
      const nextCol: string[] = []
      for (const s of steps) {
        if (placed.has(s.id)) continue
        const deps = incoming.get(s.id) ?? []
        if (deps.every((d) => placed.has(d))) {
          nextCol.push(s.id)
        }
      }
      if (nextCol.length === 0) {
        // Place remaining unconnected
        for (const s of steps) {
          if (!placed.has(s.id)) nextCol.push(s.id)
        }
      }
      columns.push(nextCol)
      nextCol.forEach((id) => placed.add(id))
    }

    // Position nodes
    const startX = 60
    const startY = 60
    for (let col = 0; col < columns.length; col++) {
      const ids = columns[col]
      const totalHeight = ids.length * STEP_HEIGHT + (ids.length - 1) * TIDY_GAP_Y
      const colStartY = startY + Math.max(0, (steps.length > 3 ? 0 : (300 - totalHeight) / 2))

      for (let row = 0; row < ids.length; row++) {
        const x = snapToGrid(startX + col * (STEP_WIDTH + TIDY_GAP_X))
        const y = snapToGrid(colStartY + row * (STEP_HEIGHT + TIDY_GAP_Y))
        moveStep(ids[row], x, y)
      }
    }

    // Fit after layout
    setTimeout(fitToView, 50)
  }, [steps, connections, moveStep, fitToView])

  // Get step index for display numbering (based on position in steps array)
  const getStepNumber = useCallback(
    (stepId: string) => steps.findIndex((s) => s.id === stepId) + 1,
    [steps],
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

  // Live connection preview line (from output handle to cursor)
  const connectingSourceStep = connectingFrom
    ? steps.find((s) => s.id === connectingFrom.stepId)
    : null

  return (
    <div className="relative flex-1 overflow-hidden">
      <div
        ref={canvasRef}
        className={cn(
          "h-full w-full",
          isPanning ? "cursor-grabbing" : "cursor-default",
          connectingFrom ? "cursor-crosshair" : "",
        )}
        style={{
          backgroundImage: "radial-gradient(circle, hsl(var(--muted-foreground) / 0.25) 1px, transparent 1px)",
          backgroundSize: `${GRID_SIZE * zoom}px ${GRID_SIZE * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        {steps.length === 0 ? (
          /* Empty state */
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <GitBranch className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Build a pipeline</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Drag workflows from the left palette onto the canvas, then connect them.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div
            ref={contentRef}
            className="relative min-h-full min-w-full origin-top-left"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              minHeight: 600,
            }}
          >
            {/* SVG overlay for connections */}
            <svg className="pointer-events-none absolute inset-0 h-full w-full" style={{ minHeight: 600, minWidth: "100%" }}>
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
                    stepWidth={STEP_WIDTH}
                    stepHeight={STEP_HEIGHT}
                    onClick={setEditingConnectionId}
                  />
                )
              })}

              {/* Live connection preview */}
              {connectingSourceStep && connectingMouse && (
                <path
                  d={(() => {
                    const x1 = connectingSourceStep.x + STEP_WIDTH
                    const y1 = connectingSourceStep.y + STEP_HEIGHT / 2
                    const x2 = connectingMouse.x
                    const y2 = connectingMouse.y
                    const dx = Math.abs(x2 - x1) * 0.5
                    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
                  })()}
                  fill="none"
                  stroke="hsl(var(--primary))"
                  strokeWidth="2"
                  strokeDasharray="6 4"
                  className="pointer-events-none"
                  opacity={0.6}
                />
              )}
            </svg>

            {/* Step cards */}
            {steps.map((step) => {
              const wf = palette.find((w) => w.id === step.workflowId)
              if (!wf) return null
              const isSelected = selectedStepId === step.id
              const stepNum = getStepNumber(step.id)
              const inCount = Object.keys(wf.inputSchema.properties ?? {}).length
              const outCount = Object.keys(wf.outputSchema.properties ?? {}).length
              const price = wf.priceUsdc === 0 ? "Free" : `$${(wf.priceUsdc / 1_000_000).toFixed(2)}`
              const isConnectingTarget = !!connectingFrom && connectingFrom.stepId !== step.id

              return (
                <div
                  key={step.id}
                  className={cn(
                    "group absolute flex cursor-move flex-col rounded-lg border bg-card p-3 shadow-sm select-none",
                    "transition-shadow duration-150",
                    isSelected
                      ? "border-primary shadow-md ring-1 ring-primary"
                      : "border-border hover:border-primary/50 hover:shadow-md",
                    draggingStepId === step.id && "opacity-90 shadow-lg",
                  )}
                  style={{
                    left: step.x,
                    top: step.y,
                    width: STEP_WIDTH,
                    height: STEP_HEIGHT,
                    transition: draggingStepId ? "none" : "left 300ms ease, top 300ms ease",
                  }}
                  onMouseDown={(e) => handleStepMouseDown(e, step.id)}
                >
                  {/* Input handle (left) */}
                  <div
                    className={cn(
                      "absolute left-0 top-1/2 z-10 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 transition-all",
                      isConnectingTarget
                        ? "border-primary bg-primary/30 scale-125"
                        : "border-border bg-background group-hover:border-primary/60",
                    )}
                    onMouseUp={(e) => handleInputMouseUp(e, step.id)}
                  />

                  {/* Output handle (right) */}
                  <div
                    className={cn(
                      "absolute right-0 top-1/2 z-10 h-3.5 w-3.5 translate-x-1/2 -translate-y-1/2 rounded-full border-2 cursor-crosshair transition-all",
                      "border-primary/60 bg-primary/80 hover:scale-125 hover:bg-primary",
                    )}
                    onMouseDown={(e) => handleOutputMouseDown(e, step.id)}
                  />

                  {/* Header row */}
                  <div className="flex items-center gap-1.5">
                    <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-bold text-muted-foreground">
                      {stepNum}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${getCategoryVariant(wf.category)}`}
                    >
                      {wf.category}
                    </span>
                    <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                      {price}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeStep(step.id)
                      }}
                      className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                      aria-label={`Remove ${step.name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>

                  {/* Name */}
                  <p className="mt-1.5 text-xs font-semibold text-foreground truncate">
                    {step.name}
                  </p>

                  {/* I/O info */}
                  <p className="mt-auto text-[10px] text-muted-foreground">
                    {inCount} in → {outCount} out
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Canvas controls — bottom right */}
      <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-lg border border-border bg-card/90 p-1 shadow-sm backdrop-blur-sm">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))}
          title="Zoom in"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        <span className="w-10 text-center text-[10px] font-mono text-muted-foreground">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))}
          title="Zoom out"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <div className="mx-0.5 h-4 w-px bg-border" />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={fitToView}
          title="Fit to view"
        >
          <Maximize className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={autoLayout}
          title="Auto-layout"
        >
          <AlignHorizontalSpaceBetween className="h-3.5 w-3.5" />
        </Button>
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
