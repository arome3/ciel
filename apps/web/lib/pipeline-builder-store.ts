import { create } from "zustand"
import { api } from "./api"

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface JSONSchema {
  type: string
  properties?: Record<string, { type: string; description?: string }>
  required?: string[]
}

export interface PaletteWorkflow {
  id: string
  name: string
  category: string
  description: string
  priceUsdc: number
  inputSchema: JSONSchema
  outputSchema: JSONSchema
}

export interface PipelineStep {
  id: string
  workflowId: string
  name: string
  x: number
  y: number
}

export interface FieldMapping {
  sourceField: string
  targetField: string
  confidence: number
}

export interface Connection {
  id: string
  sourceStepId: string
  targetStepId: string
  fieldMappings: FieldMapping[]
  compatibility: number
}

interface UndoSnapshot {
  steps: PipelineStep[]
  connections: Connection[]
}

interface PipelineBuilderState {
  // Data
  steps: PipelineStep[]
  connections: Connection[]
  selectedStepId: string | null
  palette: PaletteWorkflow[]
  name: string
  description: string

  // Connection drag state
  connectingFrom: { stepId: string; type: "output" } | null
  connectingMouse: { x: number; y: number } | null

  // Undo/redo
  undoStack: UndoSnapshot[]
  redoStack: UndoSnapshot[]

  // Loading states
  isLoadingPalette: boolean
  isSaving: boolean
  isExecuting: boolean

  // Actions
  fetchPalette: () => Promise<void>
  addStep: (workflowId: string, x: number, y: number) => void
  removeStep: (stepId: string) => void
  moveStep: (stepId: string, x: number, y: number) => void
  selectStep: (stepId: string | null) => void
  connectSteps: (sourceId: string, targetId: string) => Promise<void>
  disconnectSteps: (connectionId: string) => void
  updateFieldMapping: (connectionId: string, mappings: FieldMapping[]) => void
  setName: (name: string) => void
  setDescription: (description: string) => void
  savePipeline: (ownerAddress: string) => Promise<string | null>
  executePipeline: (pipelineId: string, triggerInput?: Record<string, unknown>, ownerAuth?: { address: string; signature: string; timestamp: string }) => Promise<unknown>
  reset: () => void

  // Connection drag actions
  startConnecting: (stepId: string) => void
  updateConnectingMouse: (x: number, y: number) => void
  cancelConnecting: () => void

  // Undo/redo actions
  undo: () => void
  redo: () => void

  // Computed
  totalPrice: () => number
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

const GRID_SIZE = 20
const MAX_UNDO = 50

/** Snap a coordinate to the nearest grid point. */
export function snapToGrid(v: number): number {
  return Math.round(v / GRID_SIZE) * GRID_SIZE
}

let stepCounter = 0

function generateStepId(): string {
  return `step-${++stepCounter}-${Date.now()}`
}

function generateConnectionId(): string {
  return `conn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

/** Score how well source output fields match target input fields (0-1). */
function computeCompatibility(
  source: PaletteWorkflow,
  target: PaletteWorkflow,
): number {
  const outProps = source.outputSchema.properties ?? {}
  const inProps = target.inputSchema.properties ?? {}
  const inKeys = Object.keys(inProps)
  if (inKeys.length === 0) return 1

  let matched = 0
  for (const key of inKeys) {
    if (outProps[key] && outProps[key].type === inProps[key].type) {
      matched++
    }
  }
  return matched / inKeys.length
}

/** Suggest field mappings between source output and target input. */
function suggestMappings(
  source: PaletteWorkflow,
  target: PaletteWorkflow,
): FieldMapping[] {
  const outProps = source.outputSchema.properties ?? {}
  const inProps = target.inputSchema.properties ?? {}
  const mappings: FieldMapping[] = []

  for (const [inKey, inField] of Object.entries(inProps)) {
    // Exact name + type match
    if (outProps[inKey] && outProps[inKey].type === inField.type) {
      mappings.push({
        sourceField: inKey,
        targetField: inKey,
        confidence: 1,
      })
      continue
    }
    // Type-only match (first matching output field)
    const typeMatch = Object.entries(outProps).find(
      ([, f]) => f.type === inField.type,
    )
    if (typeMatch) {
      mappings.push({
        sourceField: typeMatch[0],
        targetField: inKey,
        confidence: 0.6,
      })
    }
  }

  return mappings
}

// ─────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────

function pushUndo(state: PipelineBuilderState): UndoSnapshot[] {
  const snapshot: UndoSnapshot = {
    steps: state.steps.map((s) => ({ ...s })),
    connections: state.connections.map((c) => ({ ...c, fieldMappings: [...c.fieldMappings] })),
  }
  return [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot]
}

export const usePipelineBuilderStore = create<PipelineBuilderState>(
  (set, get) => ({
    steps: [],
    connections: [],
    selectedStepId: null,
    palette: [],
    name: "",
    description: "",
    connectingFrom: null,
    connectingMouse: null,
    undoStack: [],
    redoStack: [],
    isLoadingPalette: false,
    isSaving: false,
    isExecuting: false,

    fetchPalette: async () => {
      set({ isLoadingPalette: true })
      try {
        const res = await api.listWorkflows({ limit: 100 })
        const withSchemas = (res.workflows as any[])
          .filter((wf) => wf.inputSchema && wf.outputSchema)
          .map((wf) => ({
            id: wf.id,
            name: wf.name,
            category: wf.category,
            description: wf.description,
            priceUsdc: wf.priceUsdc,
            inputSchema: wf.inputSchema as JSONSchema,
            outputSchema: wf.outputSchema as JSONSchema,
          }))

        set({ palette: withSchemas })
      } catch {
        set({ palette: [] })
      } finally {
        set({ isLoadingPalette: false })
      }
    },

    addStep: (workflowId, x, y) => {
      const state = get()
      const wf = state.palette.find((w) => w.id === workflowId)
      if (!wf) return
      const step: PipelineStep = {
        id: generateStepId(),
        workflowId,
        name: wf.name,
        x: snapToGrid(x),
        y: snapToGrid(y),
      }
      set((s) => ({
        steps: [...s.steps, step],
        undoStack: pushUndo(s),
        redoStack: [],
      }))
    },

    removeStep: (stepId) => {
      set((s) => ({
        steps: s.steps.filter((st) => st.id !== stepId),
        connections: s.connections.filter(
          (c) => c.sourceStepId !== stepId && c.targetStepId !== stepId,
        ),
        selectedStepId:
          s.selectedStepId === stepId ? null : s.selectedStepId,
        undoStack: pushUndo(s),
        redoStack: [],
      }))
    },

    moveStep: (stepId, x, y) => {
      set((s) => ({
        steps: s.steps.map((st) =>
          st.id === stepId ? { ...st, x: snapToGrid(x), y: snapToGrid(y) } : st,
        ),
      }))
    },

    selectStep: (stepId) => set({ selectedStepId: stepId }),

    connectSteps: async (sourceId, targetId) => {
      const { steps, connections, palette } = get()
      // Prevent duplicate connections
      if (
        connections.some(
          (c) =>
            c.sourceStepId === sourceId && c.targetStepId === targetId,
        )
      )
        return

      const sourceStep = steps.find((s) => s.id === sourceId)
      const targetStep = steps.find((s) => s.id === targetId)
      if (!sourceStep || !targetStep) return

      const sourceWf = palette.find((w) => w.id === sourceStep.workflowId)
      const targetWf = palette.find((w) => w.id === targetStep.workflowId)
      if (!sourceWf || !targetWf) return

      // Try API compatibility check first, fallback to local
      let compatibility: number
      let fieldMappings: FieldMapping[]

      try {
        const result = await api.checkCompatibility(
          sourceStep.workflowId,
          targetStep.workflowId,
        )
        compatibility = result.score
        fieldMappings = (result.suggestions as any[]).map((s) => ({
          sourceField: s.sourceField,
          targetField: s.targetField,
          confidence: s.confidence,
        }))
      } catch {
        // Fallback to local computation
        compatibility = computeCompatibility(sourceWf, targetWf)
        fieldMappings = suggestMappings(sourceWf, targetWf)
      }

      const connection: Connection = {
        id: generateConnectionId(),
        sourceStepId: sourceId,
        targetStepId: targetId,
        fieldMappings,
        compatibility,
      }

      set((s) => ({
        connections: [...s.connections, connection],
        undoStack: pushUndo(s),
        redoStack: [],
      }))
    },

    disconnectSteps: (connectionId) => {
      set((s) => ({
        connections: s.connections.filter((c) => c.id !== connectionId),
        undoStack: pushUndo(s),
        redoStack: [],
      }))
    },

    updateFieldMapping: (connectionId, mappings) => {
      set((s) => ({
        connections: s.connections.map((c) =>
          c.id === connectionId ? { ...c, fieldMappings: mappings } : c,
        ),
      }))
    },

    setName: (name) => set({ name }),
    setDescription: (description) => set({ description }),

    savePipeline: async (ownerAddress) => {
      const { steps, connections, name, description } = get()
      if (steps.length === 0) return null

      set({ isSaving: true })
      try {
        // Build step configs with position derived from y-coordinate ordering
        const sortedSteps = [...steps].sort((a, b) => a.y - b.y)
        const pipelineSteps = sortedSteps.map((step, idx) => {
          // Find input mappings from connections where this step is the target
          const incomingConns = connections.filter((c) => c.targetStepId === step.id)
          const inputMapping: Record<string, { source: string; field: string }> = {}

          for (const conn of incomingConns) {
            for (const fm of conn.fieldMappings) {
              inputMapping[fm.targetField] = {
                source: conn.sourceStepId,
                field: fm.sourceField,
              }
            }
          }

          return {
            id: step.id,
            workflowId: step.workflowId,
            position: idx,
            ...(Object.keys(inputMapping).length > 0 ? { inputMapping } : {}),
          }
        })

        const result = await api.createPipeline({
          name: name || "Untitled Pipeline",
          description: description || "A composable workflow pipeline",
          ownerAddress,
          steps: pipelineSteps,
        })

        return result.id
      } catch {
        return null
      } finally {
        set({ isSaving: false })
      }
    },

    executePipeline: async (pipelineId, triggerInput, ownerAuth) => {
      set({ isExecuting: true })
      try {
        const result = await api.executePipeline(pipelineId, triggerInput, ownerAuth)
        return result
      } finally {
        set({ isExecuting: false })
      }
    },

    // Connection drag
    startConnecting: (stepId) => set({ connectingFrom: { stepId, type: "output" }, connectingMouse: null }),
    updateConnectingMouse: (x, y) => set({ connectingMouse: { x, y } }),
    cancelConnecting: () => set({ connectingFrom: null, connectingMouse: null }),

    // Undo/redo
    undo: () => {
      const { undoStack, steps, connections } = get()
      if (undoStack.length === 0) return
      const prev = undoStack[undoStack.length - 1]
      const current: UndoSnapshot = {
        steps: steps.map((s) => ({ ...s })),
        connections: connections.map((c) => ({ ...c, fieldMappings: [...c.fieldMappings] })),
      }
      set((s) => ({
        steps: prev.steps,
        connections: prev.connections,
        undoStack: s.undoStack.slice(0, -1),
        redoStack: [...s.redoStack, current],
      }))
    },

    redo: () => {
      const { redoStack, steps, connections } = get()
      if (redoStack.length === 0) return
      const next = redoStack[redoStack.length - 1]
      const current: UndoSnapshot = {
        steps: steps.map((s) => ({ ...s })),
        connections: connections.map((c) => ({ ...c, fieldMappings: [...c.fieldMappings] })),
      }
      set((s) => ({
        steps: next.steps,
        connections: next.connections,
        redoStack: s.redoStack.slice(0, -1),
        undoStack: [...s.undoStack, current],
      }))
    },

    reset: () => {
      stepCounter = 0
      set({
        steps: [],
        connections: [],
        selectedStepId: null,
        name: "",
        description: "",
        connectingFrom: null,
        connectingMouse: null,
        undoStack: [],
        redoStack: [],
      })
    },

    totalPrice: () => {
      const { steps, palette } = get()
      return steps.reduce((sum, step) => {
        const wf = palette.find((w) => w.id === step.workflowId)
        return sum + (wf?.priceUsdc ?? 0)
      }, 0)
    },
  }),
)
