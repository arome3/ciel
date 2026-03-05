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
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  })

  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (body.error?.message) message = body.error.message
      else if (body.message) message = body.message
      else if (typeof body.error === "string") message = body.error
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

export interface ConfirmPublishResponse {
  workflowId: string
  onchainWorkflowId: string
  publishTxHash: string
  x402Endpoint: string
  deployStatus: "pending" | "deployed" | "failed"
  donWorkflowId: string | null
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
  ownerAddress: string
}

export interface WorkflowDetail extends WorkflowListItem {
  code: string
  config: Record<string, unknown>
  simulationTrace: Array<{ step: string; status: string; duration: number; output: string }> | null
  templateId: number
  templateName: string
  prompt: string
  published: boolean
  publishTxHash: string | null
  x402Endpoint: string | null
  consumerSol: string | null
  onchainWorkflowId: string | null
  inputSchema: unknown
  outputSchema: unknown
  createdAt: string
  updatedAt: string
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
    signal?: AbortSignal,
  ): Promise<GeneratedWorkflow> {
    const timeoutSignal = AbortSignal.timeout(660_000) // 11min — backend pipeline is 10min max
    const combinedSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal

    const raw = await request<RawGenerateResponse>("/api/generate", {
      method: "POST",
      body: JSON.stringify({ prompt, templateHint }),
      signal: combinedSignal,
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

  async confirmPublish(
    workflowId: string,
    txHash: string,
    onchainWorkflowId: string,
    name: string,
    description: string,
    priceUsdc: number,
    ownerAddress: string,
  ): Promise<ConfirmPublishResponse> {
    return request<ConfirmPublishResponse>("/api/publish/confirm", {
      method: "POST",
      headers: { "X-Owner-Address": ownerAddress },
      body: JSON.stringify({
        workflowId,
        txHash,
        onchainWorkflowId,
        name,
        description,
        priceUsdc,
      }),
    })
  },

  async listWorkflows(params?: {
    page?: number
    limit?: number
    category?: string
    search?: string
    sort?: string
  }): Promise<WorkflowsListResponse> {
    const query = new URLSearchParams()
    if (params?.page) query.set("page", String(params.page))
    if (params?.limit) query.set("limit", String(params.limit))
    if (params?.category) query.set("category", params.category)
    if (params?.search) query.set("search", params.search)
    if (params?.sort) query.set("sort", params.sort)
    const qs = query.toString()
    return request<WorkflowsListResponse>(
      `/api/workflows${qs ? `?${qs}` : ""}`,
    )
  },

  async getWorkflow(id: string): Promise<WorkflowDetail> {
    return request<WorkflowDetail>(`/api/workflows/${id}`)
  },

  // ─────────────────────────────────────────────
  // Pipeline API methods
  // ─────────────────────────────────────────────

  async createPipeline(data: {
    name: string
    description: string
    ownerAddress: string
    steps: Array<{
      id: string
      workflowId: string
      position: number
      inputMapping?: Record<string, { source: string; field: string }>
    }>
  }): Promise<{ id: string; name: string; totalPrice: string }> {
    return request("/api/pipelines", {
      method: "POST",
      body: JSON.stringify(data),
    })
  },

  async listPipelines(params?: {
    page?: number
    limit?: number
    owner?: string
    active?: boolean
  }): Promise<{ pipelines: unknown[]; total: number; page: number; limit: number }> {
    const query = new URLSearchParams()
    if (params?.page) query.set("page", String(params.page))
    if (params?.limit) query.set("limit", String(params.limit))
    if (params?.owner) query.set("owner", params.owner)
    if (params?.active !== undefined) query.set("active", String(params.active))
    const qs = query.toString()
    return request(`/api/pipelines${qs ? `?${qs}` : ""}`)
  },

  async getPipeline(id: string): Promise<unknown> {
    return request(`/api/pipelines/${id}`)
  },

  async executePipeline(
    id: string,
    triggerInput?: Record<string, unknown>,
    ownerAuth?: { address: string; signature: string; timestamp?: string },
  ): Promise<{ executionId: string; status: string; stepResults: unknown[]; finalOutput: unknown }> {
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (ownerAuth) {
      headers["X-Owner-Address"] = ownerAuth.address
      headers["X-Owner-Signature"] = ownerAuth.signature
      if (ownerAuth.timestamp) {
        headers["X-Owner-Timestamp"] = ownerAuth.timestamp
      }
    }

    return request(`/api/pipelines/${id}/execute`, {
      method: "POST",
      headers,
      body: JSON.stringify({ triggerInput: triggerInput ?? {} }),
    })
  },

  async checkCompatibility(
    sourceWorkflowId: string,
    targetWorkflowId: string,
  ): Promise<{ compatible: boolean; score: number; suggestions: unknown[] }> {
    return request("/api/pipelines/check-compatibility", {
      method: "POST",
      body: JSON.stringify({ sourceWorkflowId, targetWorkflowId }),
    })
  },

  async suggestPipelines(): Promise<{ suggestions: unknown[] }> {
    return request("/api/pipelines/suggest")
  },

  // ─────────────────────────────────────────────
  // Tenderly API methods
  // ─────────────────────────────────────────────

  async tenderlyCreate(opts: {
    name: string
    networkId?: number
    chainId?: number
    syncState?: boolean
  }): Promise<{
    id: string
    name: string
    networkId: number
    chainId: number
    rpcUrl: string
    explorerUrl: string
  }> {
    return request("/api/tenderly/create", {
      method: "POST",
      body: JSON.stringify(opts),
    })
  },

  async tenderlyDeployContracts(): Promise<{
    registryAddress: string
    consumerAddress: string
    explorerUrl: string
  }> {
    return request("/api/tenderly/deploy-contracts", {
      method: "POST",
    })
  },

  async tenderlyFund(
    address: string,
    amountEth: number = 100,
  ): Promise<{ address: string; amountEth: number; funded: boolean }> {
    return request("/api/tenderly/fund", {
      method: "POST",
      body: JSON.stringify({ address, amountEth }),
    })
  },

  async tenderlyStatus(): Promise<{
    active: boolean
    testnet: {
      id: string
      name: string
      networkId: number
      chainId: number
      rpcUrl: string
      explorerUrl: string
    } | null
    contracts: { registry: string | null; consumer: string | null }
    snapshotId: string | null
  }> {
    return request("/api/tenderly/status")
  },

  async tenderlySnapshot(): Promise<{ snapshotId: string }> {
    return request("/api/tenderly/snapshot", { method: "POST" })
  },

  async tenderlyRevert(snapshotId: string): Promise<{ reverted: boolean }> {
    return request("/api/tenderly/revert", {
      method: "POST",
      body: JSON.stringify({ snapshotId }),
    })
  },

  async tenderlyCleanup(): Promise<{ destroyed: boolean }> {
    return request("/api/tenderly/cleanup", { method: "DELETE" })
  },

  async executeWorkflow(
    id: string,
    ownerAuth?: { address: string; signature: string },
  ): Promise<{ success: boolean; result: unknown }> {
    const headers: Record<string, string> = {}
    if (ownerAuth) {
      headers["X-Owner-Address"] = ownerAuth.address
      headers["X-Owner-Signature"] = ownerAuth.signature
    }

    const res = await fetch(`${API_BASE}/api/workflows/${id}/execute`, {
      headers,
    })

    if (res.status === 402) {
      const body = await res.json().catch(() => ({}))
      const err = new ApiError(402, body.message ?? "Payment required")
      throw err
    }

    if (!res.ok) {
      let message = `Execution failed (${res.status})`
      try {
        const body = await res.json()
        if (body.message) message = body.message
      } catch {
        // use default
      }
      throw new ApiError(res.status, message)
    }

    return res.json()
  },
}
