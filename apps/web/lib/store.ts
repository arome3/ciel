import { create } from "zustand"
import type {
  GeneratedWorkflow,
  Simulation,
  WorkflowListItem,
} from "./api"
import { api } from "./api"

export interface SSEEvent {
  type: string
  workflowId: string
  workflowName: string
  agentAddress: string
  result?: unknown
  error?: string
  timestamp: number
}

interface WorkflowState {
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
  searchQuery: string
  filters: {
    category: string | null
    chain: string | null
    sortBy: string
  }
  isLoadingWorkflows: boolean

  // Agent events (capped at 50)
  agentEvents: SSEEvent[]

  // Error
  error: string | null

  // Builder actions
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

  // Marketplace actions
  setSearchQuery: (query: string) => void
  setFilter: (key: "category" | "chain" | "sortBy", value: string | null) => void
  clearFilters: () => void
  fetchWorkflows: () => Promise<void>
}

const MAX_AGENT_EVENTS = 50

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  prompt: "",
  generatedWorkflow: null,
  simulation: null,
  isGenerating: false,
  isSimulating: false,
  isPublishing: false,
  walletAddress: null,
  workflows: [],
  searchQuery: "",
  filters: {
    category: null,
    chain: null,
    sortBy: "newest",
  },
  isLoadingWorkflows: false,
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

  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setFilter: (key, value) =>
    set((state) => ({
      filters: { ...state.filters, [key]: value },
    })),
  clearFilters: () =>
    set({
      searchQuery: "",
      filters: { category: null, chain: null, sortBy: "newest" },
    }),
  fetchWorkflows: async () => {
    const { searchQuery, filters } = get()
    set({ isLoadingWorkflows: true })
    try {
      const res = await api.listWorkflows({
        search: searchQuery || undefined,
        category: filters.category ?? undefined,
        sort: filters.sortBy,
      })
      set({ workflows: res.workflows })
    } catch {
      // list fetch failure is non-fatal — keep stale data
    } finally {
      set({ isLoadingWorkflows: false })
    }
  },
}))

/** @deprecated Use useWorkflowStore instead */
export const useBuilderStore = useWorkflowStore
