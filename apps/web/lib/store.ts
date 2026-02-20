import { create } from "zustand"
import type {
  GeneratedWorkflow,
  Simulation,
  WorkflowListItem,
} from "./api"

export interface SSEEvent {
  type: string
  workflowId: string
  workflowName: string
  agentAddress: string
  result?: unknown
  error?: string
  timestamp: number
}

interface BuilderState {
  // Builder flow
  prompt: string
  generatedWorkflow: GeneratedWorkflow | null
  simulation: Simulation | null

  // Loading flags
  isGenerating: boolean
  isSimulating: boolean
  isPublishing: boolean

  // User
  walletAddress: string | null

  // Marketplace
  workflows: WorkflowListItem[]

  // Agent events (capped at 50)
  agentEvents: SSEEvent[]

  // Error
  error: string | null

  // Actions
  setPrompt: (prompt: string) => void
  setGeneratedWorkflow: (workflow: GeneratedWorkflow | null) => void
  setSimulation: (simulation: Simulation | null) => void
  setIsGenerating: (v: boolean) => void
  setIsSimulating: (v: boolean) => void
  setIsPublishing: (v: boolean) => void
  setWalletAddress: (address: string | null) => void
  setWorkflows: (workflows: WorkflowListItem[]) => void
  addAgentEvent: (event: SSEEvent) => void
  setError: (error: string | null) => void
  resetBuilder: () => void
}

const MAX_AGENT_EVENTS = 50

export const useBuilderStore = create<BuilderState>((set) => ({
  prompt: "",
  generatedWorkflow: null,
  simulation: null,
  isGenerating: false,
  isSimulating: false,
  isPublishing: false,
  walletAddress: null,
  workflows: [],
  agentEvents: [],
  error: null,

  setPrompt: (prompt) => set({ prompt }),
  setGeneratedWorkflow: (generatedWorkflow) => set({ generatedWorkflow }),
  setSimulation: (simulation) => set({ simulation }),
  setIsGenerating: (isGenerating) => set({ isGenerating }),
  setIsSimulating: (isSimulating) => set({ isSimulating }),
  setIsPublishing: (isPublishing) => set({ isPublishing }),
  setWalletAddress: (walletAddress) => set({ walletAddress }),
  setWorkflows: (workflows) => set({ workflows }),
  addAgentEvent: (event) =>
    set((state) => ({
      agentEvents: [event, ...state.agentEvents].slice(0, MAX_AGENT_EVENTS),
    })),
  setError: (error) => set({ error }),
  resetBuilder: () =>
    set({
      prompt: "",
      generatedWorkflow: null,
      simulation: null,
      isGenerating: false,
      isSimulating: false,
      isPublishing: false,
      error: null,
    }),
}))
