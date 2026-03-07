import { create } from "zustand"
import type {
  GeneratedWorkflow,
  Simulation,
  WorkflowListItem,
} from "./api"
import { api } from "./api"

export interface SSEEvent {
  type: string
  workflowId?: string
  workflowName?: string
  agentAddress: string
  result?: unknown
  error?: string
  timestamp: number
  query?: string
  matchCount?: number
  category?: string
  txHash?: string
}

interface WorkflowState {
  // Builder flow
  prompt: string
  templateHint: number | null
  generatedWorkflow: GeneratedWorkflow | null
  simulation: Simulation | null
  editedConfig: Record<string, unknown> | null

  // Refinement
  isRefining: boolean
  refinementPrompt: string
  revisionHistory: Array<{ prompt: string; timestamp: number }>

  // Loading flags
  isGenerating: boolean
  isSimulating: boolean
  isPublishing: boolean

  // Marketplace
  workflows: WorkflowListItem[]
  searchQuery: string
  filters: {
    category: string | null
    chain: string | null
    sortBy: string
    ownerAddress: string | null
  }
  isLoadingWorkflows: boolean

  // Agent events (capped at 50)
  agentEvents: SSEEvent[]

  // Error
  error: string | null

  // Builder actions
  setPrompt: (prompt: string) => void
  setTemplateHint: (hint: number | null) => void
  setGeneratedWorkflow: (workflow: GeneratedWorkflow | null) => void
  setSimulation: (simulation: Simulation | null) => void
  setIsGenerating: (v: boolean) => void
  setIsSimulating: (v: boolean) => void
  setIsPublishing: (v: boolean) => void
  setWorkflows: (workflows: WorkflowListItem[]) => void
  addAgentEvent: (event: SSEEvent) => void
  setError: (error: string | null) => void
  updateConfigField: (key: string, value: unknown) => void
  resetBuilder: () => void
  generate: (prompt: string) => Promise<void>
  setRefinementPrompt: (prompt: string) => void
  setIsRefining: (v: boolean) => void
  refine: (workflowId: string, refinementPrompt: string, ownerAddress?: string) => Promise<void>

  // Marketplace actions
  setSearchQuery: (query: string) => void
  setFilter: (key: "category" | "chain" | "sortBy" | "ownerAddress", value: string | null) => void
  clearFilters: () => void
  fetchWorkflows: () => Promise<void>
}

const MAX_AGENT_EVENTS = 50

/** Active generate request controller — allows cancellation */
let _activeGenerateController: AbortController | null = null

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  prompt: "",
  templateHint: null,
  generatedWorkflow: null,
  simulation: null,
  editedConfig: null,
  isRefining: false,
  refinementPrompt: "",
  revisionHistory: [],
  isGenerating: false,
  isSimulating: false,
  isPublishing: false,
  workflows: [],
  searchQuery: "",
  filters: {
    category: null,
    chain: null,
    sortBy: "newest",
    ownerAddress: null,
  },
  isLoadingWorkflows: false,
  agentEvents: [],
  error: null,

  setPrompt: (prompt) => set({ prompt }),
  setTemplateHint: (templateHint) => set({ templateHint }),
  setGeneratedWorkflow: (generatedWorkflow) => set({ generatedWorkflow }),
  setSimulation: (simulation) => set({ simulation }),
  setIsGenerating: (isGenerating) => set({ isGenerating }),
  setIsSimulating: (isSimulating) => set({ isSimulating }),
  setIsPublishing: (isPublishing) => set({ isPublishing }),
  setWorkflows: (workflows) => set({ workflows }),
  addAgentEvent: (event) =>
    set((state) => ({
      agentEvents: [event, ...state.agentEvents].slice(0, MAX_AGENT_EVENTS),
    })),
  setError: (error) => set({ error }),
  updateConfigField: (key, value) =>
    set((state) => ({
      editedConfig: state.editedConfig
        ? { ...state.editedConfig, [key]: value }
        : null,
    })),
  resetBuilder: () => {
    if (_activeGenerateController) {
      _activeGenerateController.abort()
      _activeGenerateController = null
    }
    set({
      prompt: "",
      templateHint: null,
      generatedWorkflow: null,
      simulation: null,
      editedConfig: null,
      isRefining: false,
      refinementPrompt: "",
      revisionHistory: [],
      isGenerating: false,
      isSimulating: false,
      isPublishing: false,
      error: null,
    })
  },

  generate: async (prompt: string) => {
    const state = get()
    if (state.isGenerating) return

    const controller = new AbortController()
    _activeGenerateController = controller

    const hint = get().templateHint ?? undefined
    set({ prompt, isGenerating: true, error: null, simulation: null, generatedWorkflow: null })
    try {
      const workflow = await api.generate(prompt, hint, controller.signal)
      if (!controller.signal.aborted) {
        set({
          generatedWorkflow: workflow,
          editedConfig: workflow.config ? { ...workflow.config } : null,
          isGenerating: false,
        })
      }
    } catch (err) {
      if (controller.signal.aborted) return // cancelled — resetBuilder already cleaned up
      const message = err instanceof Error ? err.message : "Failed to generate workflow"
      set({ error: message, isGenerating: false })
    } finally {
      _activeGenerateController = null
    }
  },

  setRefinementPrompt: (refinementPrompt) => set({ refinementPrompt }),
  setIsRefining: (isRefining) => set({ isRefining }),

  refine: async (workflowId: string, refinementPrompt: string, ownerAddress?: string) => {
    const state = get()
    if (state.isRefining || state.isGenerating) return

    const controller = new AbortController()
    _activeGenerateController = controller

    set({ isRefining: true, error: null })
    try {
      const result = await api.refine(workflowId, refinementPrompt, ownerAddress, controller.signal)
      if (!controller.signal.aborted) {
        set((s) => ({
          generatedWorkflow: result,
          editedConfig: result.config ? { ...result.config } : null,
          simulation: null,
          isRefining: false,
          refinementPrompt: "",
          revisionHistory: [
            ...s.revisionHistory,
            { prompt: refinementPrompt, timestamp: Date.now() },
          ],
        }))
      }
    } catch (err) {
      if (controller.signal.aborted) return
      const message = err instanceof Error ? err.message : "Refinement failed"
      set({ error: message, isRefining: false })
    } finally {
      _activeGenerateController = null
    }
  },

  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setFilter: (key, value) =>
    set((state) => ({
      filters: { ...state.filters, [key]: value },
    })),
  clearFilters: () =>
    set({
      searchQuery: "",
      filters: { category: null, chain: null, sortBy: "newest", ownerAddress: null },
    }),
  fetchWorkflows: async () => {
    const { searchQuery, filters } = get()
    set({ isLoadingWorkflows: true })
    try {
      const res = await api.listWorkflows({
        search: searchQuery || undefined,
        category: filters.category ?? undefined,
        sort: filters.sortBy,
        owner: filters.ownerAddress ?? undefined,
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
