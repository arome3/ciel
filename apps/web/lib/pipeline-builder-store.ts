import { create } from "zustand"

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

interface PipelineBuilderState {
  // Data
  steps: PipelineStep[]
  connections: Connection[]
  selectedStepId: string | null
  palette: PaletteWorkflow[]
  name: string
  description: string

  // Actions
  addStep: (workflowId: string, x: number, y: number) => void
  removeStep: (stepId: string) => void
  moveStep: (stepId: string, x: number, y: number) => void
  selectStep: (stepId: string | null) => void
  connectSteps: (sourceId: string, targetId: string) => void
  disconnectSteps: (connectionId: string) => void
  updateFieldMapping: (connectionId: string, mappings: FieldMapping[]) => void
  setName: (name: string) => void
  setDescription: (description: string) => void
  reset: () => void

  // Computed
  totalPrice: () => number
}

// ─────────────────────────────────────────────
// Mock palette workflows
// ─────────────────────────────────────────────

const MOCK_PALETTE: PaletteWorkflow[] = [
  {
    id: "wf-price-feed",
    name: "Price Feed Oracle",
    category: "DeFi",
    description: "Fetches real-time asset prices from Chainlink feeds",
    priceUsdc: 50000,
    inputSchema: {
      type: "object",
      properties: {
        assetPair: { type: "string", description: "e.g. ETH/USD" },
        interval: { type: "string", description: "Polling interval" },
      },
      required: ["assetPair"],
    },
    outputSchema: {
      type: "object",
      properties: {
        price: { type: "number", description: "Current price" },
        timestamp: { type: "number", description: "Unix timestamp" },
        source: { type: "string", description: "Data source ID" },
      },
    },
  },
  {
    id: "wf-threshold",
    name: "Threshold Gate",
    category: "Utility",
    description: "Passes data through only when a condition is met",
    priceUsdc: 20000,
    inputSchema: {
      type: "object",
      properties: {
        value: { type: "number", description: "Value to check" },
        threshold: { type: "number", description: "Threshold value" },
        operator: { type: "string", description: "gt, lt, eq, gte, lte" },
      },
      required: ["value", "threshold"],
    },
    outputSchema: {
      type: "object",
      properties: {
        passed: { type: "boolean", description: "Whether condition was met" },
        value: { type: "number", description: "The checked value" },
      },
    },
  },
  {
    id: "wf-alert",
    name: "Alert Sender",
    category: "Utility",
    description: "Sends notifications via webhook or on-chain event",
    priceUsdc: 30000,
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "Alert message" },
        severity: { type: "string", description: "info, warning, critical" },
        passed: { type: "boolean", description: "Whether to send" },
      },
      required: ["message"],
    },
    outputSchema: {
      type: "object",
      properties: {
        sent: { type: "boolean", description: "Whether alert was sent" },
        alertId: { type: "string", description: "Alert ID" },
      },
    },
  },
  {
    id: "wf-evm-write",
    name: "EVM Transaction",
    category: "DeFi",
    description: "Executes a write transaction on an EVM chain",
    priceUsdc: 100000,
    inputSchema: {
      type: "object",
      properties: {
        contractAddress: { type: "string", description: "Target contract" },
        functionName: { type: "string", description: "Function to call" },
        args: { type: "string", description: "Encoded arguments" },
        value: { type: "number", description: "ETH value to send" },
      },
      required: ["contractAddress", "functionName"],
    },
    outputSchema: {
      type: "object",
      properties: {
        txHash: { type: "string", description: "Transaction hash" },
        success: { type: "boolean", description: "Whether tx succeeded" },
        gasUsed: { type: "number", description: "Gas consumed" },
      },
    },
  },
  {
    id: "wf-compliance",
    name: "Compliance Check",
    category: "Security",
    description: "Runs KYC/AML screening on an address",
    priceUsdc: 75000,
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "Address to screen" },
        checkType: { type: "string", description: "kyc, aml, sanctions" },
      },
      required: ["address"],
    },
    outputSchema: {
      type: "object",
      properties: {
        passed: { type: "boolean", description: "Whether check passed" },
        riskScore: { type: "number", description: "0-100 risk score" },
        flags: { type: "string", description: "Comma-separated flags" },
      },
    },
  },
  {
    id: "wf-aggregator",
    name: "Data Aggregator",
    category: "Analytics",
    description: "Combines multiple data sources into a single output",
    priceUsdc: 40000,
    inputSchema: {
      type: "object",
      properties: {
        values: { type: "string", description: "JSON array of values" },
        method: { type: "string", description: "mean, median, mode, consensus" },
      },
      required: ["values"],
    },
    outputSchema: {
      type: "object",
      properties: {
        result: { type: "number", description: "Aggregated result" },
        confidence: { type: "number", description: "Confidence 0-1" },
        sources: { type: "number", description: "Number of sources used" },
      },
    },
  },
]

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

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

export const usePipelineBuilderStore = create<PipelineBuilderState>(
  (set, get) => ({
    steps: [],
    connections: [],
    selectedStepId: null,
    palette: MOCK_PALETTE,
    name: "",
    description: "",

    addStep: (workflowId, x, y) => {
      const wf = MOCK_PALETTE.find((w) => w.id === workflowId)
      if (!wf) return
      const step: PipelineStep = {
        id: generateStepId(),
        workflowId,
        name: wf.name,
        x,
        y,
      }
      set((s) => ({ steps: [...s.steps, step] }))
    },

    removeStep: (stepId) => {
      set((s) => ({
        steps: s.steps.filter((st) => st.id !== stepId),
        connections: s.connections.filter(
          (c) => c.sourceStepId !== stepId && c.targetStepId !== stepId,
        ),
        selectedStepId:
          s.selectedStepId === stepId ? null : s.selectedStepId,
      }))
    },

    moveStep: (stepId, x, y) => {
      set((s) => ({
        steps: s.steps.map((st) =>
          st.id === stepId ? { ...st, x, y } : st,
        ),
      }))
    },

    selectStep: (stepId) => set({ selectedStepId: stepId }),

    connectSteps: (sourceId, targetId) => {
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

      const compatibility = computeCompatibility(sourceWf, targetWf)
      const fieldMappings = suggestMappings(sourceWf, targetWf)

      const connection: Connection = {
        id: generateConnectionId(),
        sourceStepId: sourceId,
        targetStepId: targetId,
        fieldMappings,
        compatibility,
      }

      set((s) => ({ connections: [...s.connections, connection] }))
    },

    disconnectSteps: (connectionId) => {
      set((s) => ({
        connections: s.connections.filter((c) => c.id !== connectionId),
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

    reset: () => {
      stepCounter = 0
      set({
        steps: [],
        connections: [],
        selectedStepId: null,
        name: "",
        description: "",
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
