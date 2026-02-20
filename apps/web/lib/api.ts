const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"

class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  })

  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (body.message) message = body.message
      else if (body.error) message = body.error
    } catch {
      // use default message
    }
    throw new ApiError(res.status, message)
  }

  return res.json() as Promise<T>
}

// ─────────────────────────────────────────────
// Raw API response types (match backend exactly)
// ─────────────────────────────────────────────

interface RawGenerateResponse {
  workflowId: string
  code: string
  configJson: string
  explanation: string
  consumerSol: string | null
  intent: {
    triggerType: string
    confidence: number
    dataSources: string[]
    actions: string[]
    chains: string[]
  }
  template: {
    templateId: number
    templateName: string
    category: string
    confidence: number
  }
  validation: {
    valid: boolean
    errors: string[]
  }
  fallback: boolean
}

interface RawSimulateResponse {
  workflowId: string
  success: boolean
  trace: Array<{
    step: string
    status: string
    duration: number
    output: string
  }>
  duration: number
}

// ─────────────────────────────────────────────
// Transformed frontend types
// ─────────────────────────────────────────────

export interface GeneratedWorkflow {
  id: string
  code: string
  config: Record<string, unknown>
  fallback: boolean
  language: string
  explanation: string
  consumerSol: string | null
  intent: {
    triggerType: string
    confidence: number
    dataSources: string[]
    actions: string[]
    chains: string[]
  }
  template: {
    templateId: number
    templateName: string
    category: string
    confidence: number
  }
  validation: {
    valid: boolean
    errors: string[]
  }
}

export interface SimulationStep {
  name: string
  status: "success" | "error" | "skipped"
  durationMs: number
  output?: string
  error?: string
}

export interface Simulation {
  workflowId: string
  steps: SimulationStep[]
  totalDurationMs: number
  success: boolean
}

export interface PublishResponse {
  workflowId: string
  onchainWorkflowId: string
  publishTxHash: string
  x402Endpoint: string
}

export interface WorkflowListItem {
  id: string
  name: string
  description: string
  category: string
  priceUsdc: number
  capabilities: string[]
  chains: string[]
  totalExecutions: number
  successfulExecutions: number
}

interface WorkflowsListResponse {
  workflows: WorkflowListItem[]
  total: number
  page: number
  limit: number
}

// ─────────────────────────────────────────────
// API methods with boundary transforms
// ─────────────────────────────────────────────

export const api = {
  async generate(
    prompt: string,
    templateHint?: number,
  ): Promise<GeneratedWorkflow> {
    const raw = await request<RawGenerateResponse>("/api/generate", {
      method: "POST",
      body: JSON.stringify({ prompt, templateHint }),
    })

    let config: Record<string, unknown> = {}
    try {
      config = JSON.parse(raw.configJson)
    } catch {
      // configJson may be empty or malformed — default to empty
    }

    return {
      id: raw.workflowId,
      code: raw.code,
      config,
      fallback: raw.fallback,
      language: "typescript",
      explanation: raw.explanation,
      consumerSol: raw.consumerSol,
      intent: raw.intent,
      template: raw.template,
      validation: raw.validation,
    }
  },

  async simulate(
    workflowId: string,
    config?: Record<string, unknown>,
  ): Promise<Simulation> {
    const raw = await request<RawSimulateResponse>("/api/simulate", {
      method: "POST",
      body: JSON.stringify({ mode: "stored", workflowId, config }),
    })

    return {
      workflowId: raw.workflowId,
      success: raw.success,
      totalDurationMs: raw.duration,
      steps: raw.trace.map((t) => ({
        name: t.step,
        status: t.status as SimulationStep["status"],
        durationMs: t.duration,
        output: t.output || undefined,
        error: t.status === "error" ? t.output : undefined,
      })),
    }
  },

  async publish(
    workflowId: string,
    name: string,
    description: string,
    priceUsdc: number,
  ): Promise<PublishResponse> {
    return request<PublishResponse>("/api/publish", {
      method: "POST",
      body: JSON.stringify({ workflowId, name, description, priceUsdc }),
    })
  },

  async listWorkflows(params?: {
    page?: number
    limit?: number
    category?: string
    search?: string
  }): Promise<WorkflowsListResponse> {
    const query = new URLSearchParams()
    if (params?.page) query.set("page", String(params.page))
    if (params?.limit) query.set("limit", String(params.limit))
    if (params?.category) query.set("category", params.category)
    if (params?.search) query.set("search", params.search)
    const qs = query.toString()
    return request<WorkflowsListResponse>(
      `/api/workflows${qs ? `?${qs}` : ""}`,
    )
  },

  async getWorkflow(id: string): Promise<WorkflowListItem> {
    return request<WorkflowListItem>(`/api/workflows/${id}`)
  },
}
