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

export interface PipelineListItem {
  id: string
  name: string
  description: string
  ownerAddress: string
  steps: string // JSON
  totalPrice: string
  isActive: boolean
  executionCount: number
  createdAt: string
  updatedAt: string
}

export interface PipelineExecution {
  id: string
  pipelineId: string
  agentAddress: string | null
  totalPaid: string | null
  status: "pending" | "running" | "completed" | "failed" | "partial"
  stepResults: unknown[] | null
  triggerInput: Record<string, unknown> | null
  finalOutput: unknown | null
  duration: number | null
  createdAt: string
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
  published?: boolean
  publishedAt?: string | null
  deployStatus?: string | null
  createdAt?: string
  updatedAt?: string
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
  deployStatus: string | null
  inputSchema: unknown
  outputSchema: unknown
  createdAt: string
  updatedAt: string
}

export interface TemplateCatalogItem {
  id: number
  name: string
  category: string
  categoryLabel: string
  triggerType: string
  triggerLabel: string
  capabilities: string[]
  description: string
}

export interface TemplateRequestItem {
  id: string
  description: string
  category: string | null
  triggerType: string | null
  ownerAddress: string
  status: string
  createdAt: string
  voteCount: number
}

export interface UserSettings {
  ownerAddress: string
  displayName: string | null
  defaultChain: string
  webhookUrl: string | null
  notifyDeployFail: boolean
  notifyExecFail: boolean
  notifyExecSuccess: boolean
  githubInstallationId?: number | null
  githubUsername?: string | null
}

export interface GitHubStatus {
  connected: boolean
  username: string | null
  installationId: number | null
}

export interface GitHubRepo {
  owner: string
  name: string
  fullName: string
  private: boolean
  defaultBranch: string
}

export interface GitHubExportResult {
  success: boolean
  repoUrl: string
  branch: string
  filesCreated: string[]
  commitSha: string
  commitUrl: string
}

export interface GitHubImportResult {
  workflowId: string
  code: string
  config: Record<string, unknown>
  validation: { valid: boolean; errors: string[] }
  source: { repo: string; branch: string; path: string }
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

  async refine(
    workflowId: string,
    refinementPrompt: string,
    ownerAddress?: string,
    signal?: AbortSignal,
  ): Promise<GeneratedWorkflow & { revisionNumber: number }> {
    const timeoutSignal = AbortSignal.timeout(360_000) // 6min — backend pipeline is 5min max
    const combinedSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal

    const headers: Record<string, string> = {}
    if (ownerAddress) headers["X-Owner-Address"] = ownerAddress

    const raw = await request<RawGenerateResponse & { revisionNumber: number }>("/api/refine", {
      method: "POST",
      headers,
      body: JSON.stringify({ workflowId, refinementPrompt }),
      signal: combinedSignal,
    })

    let config: Record<string, unknown> = {}
    try {
      config = JSON.parse(raw.configJson)
    } catch {
      // default to empty
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
      revisionNumber: raw.revisionNumber,
    }
  },

  async generateDescription(input: {
    explanation: string
    templateName: string
    category: string
    capabilities: string[]
  }): Promise<{ description: string }> {
    return request("/api/generate-description", {
      method: "POST",
      body: JSON.stringify(input),
    })
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
    owner?: string
    published?: "true" | "false" | "all"
  }): Promise<WorkflowsListResponse> {
    const query = new URLSearchParams()
    if (params?.page) query.set("page", String(params.page))
    if (params?.limit) query.set("limit", String(params.limit))
    if (params?.category) query.set("category", params.category)
    if (params?.search) query.set("search", params.search)
    if (params?.sort) query.set("sort", params.sort)
    if (params?.owner) query.set("owner", params.owner)
    if (params?.published) query.set("published", params.published)
    const qs = query.toString()
    const headers: Record<string, string> = {}
    if (params?.owner && (params?.published === "all" || params?.published === "false")) {
      headers["X-Owner-Address"] = params.owner
    }
    return request<WorkflowsListResponse>(
      `/api/workflows${qs ? `?${qs}` : ""}`,
      { headers },
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
  }): Promise<{ pipelines: PipelineListItem[]; total: number; page: number; limit: number }> {
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

  async getPipelineHistory(
    id: string,
    params?: { page?: number; limit?: number },
  ): Promise<{ executions: PipelineExecution[]; total: number; page: number; limit: number }> {
    const query = new URLSearchParams()
    if (params?.page) query.set("page", String(params.page))
    if (params?.limit) query.set("limit", String(params.limit))
    const qs = query.toString()
    return request(`/api/pipelines/${id}/history${qs ? `?${qs}` : ""}`)
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

  workflowExportUrl(workflowId: string): string {
    return `${API_BASE}/api/workflows/${workflowId}/export`
  },

  async redeployWorkflow(
    workflowId: string,
    auth: { address: string; signature: string },
  ): Promise<{ workflowId: string; deployStatus: string; message: string }> {
    return request(`/api/workflows/${workflowId}/redeploy`, {
      method: "POST",
      headers: {
        "X-Owner-Address": auth.address,
        "X-Owner-Signature": auth.signature,
      },
    })
  },

  async updateWorkflowConfig(
    workflowId: string,
    config: Record<string, unknown>,
    auth: { address: string; signature: string },
  ): Promise<{ config: Record<string, unknown> }> {
    return request<{ config: Record<string, unknown> }>(
      `/api/workflows/${workflowId}/config`,
      {
        method: "PATCH",
        headers: {
          "X-Owner-Address": auth.address,
          "X-Owner-Signature": auth.signature,
        },
        body: JSON.stringify({ config }),
      },
    )
  },

  // ─────────────────────────────────────────────
  // Templates API methods
  // ─────────────────────────────────────────────

  async listTemplates(): Promise<{
    templates: TemplateCatalogItem[]
    total: number
  }> {
    return request("/api/templates")
  },

  async listTemplateRequests(params?: {
    page?: number
    limit?: number
    sort?: "votes" | "newest"
    status?: "open" | "planned" | "completed" | "all"
  }): Promise<{
    requests: TemplateRequestItem[]
    total: number
    page: number
    limit: number
  }> {
    const query = new URLSearchParams()
    if (params?.page) query.set("page", String(params.page))
    if (params?.limit) query.set("limit", String(params.limit))
    if (params?.sort) query.set("sort", params.sort)
    if (params?.status) query.set("status", params.status)
    const qs = query.toString()
    return request(`/api/template-requests${qs ? `?${qs}` : ""}`)
  },

  async createTemplateRequest(
    data: { description: string; category?: string; triggerType?: string },
    ownerAddress: string,
  ): Promise<TemplateRequestItem> {
    return request("/api/template-requests", {
      method: "POST",
      headers: { "X-Owner-Address": ownerAddress },
      body: JSON.stringify(data),
    })
  },

  async voteTemplateRequest(
    requestId: string,
    ownerAddress: string,
  ): Promise<{ voted: boolean }> {
    return request(`/api/template-requests/${requestId}/vote`, {
      method: "POST",
      headers: { "X-Owner-Address": ownerAddress },
    })
  },

  // ─────────────────────────────────────────────
  // Settings API methods
  // ─────────────────────────────────────────────

  async getSettings(ownerAddress: string): Promise<UserSettings> {
    return request("/api/settings", {
      headers: { "X-Owner-Address": ownerAddress },
    })
  },

  async updateSettings(
    settings: Partial<UserSettings>,
    ownerAddress: string,
  ): Promise<UserSettings> {
    const { ownerAddress: _, ...body } = settings as UserSettings
    return request("/api/settings", {
      method: "PUT",
      headers: { "X-Owner-Address": ownerAddress },
      body: JSON.stringify(body),
    })
  },

  // ─────────────────────────────────────────────
  // Events API methods
  // ─────────────────────────────────────────────

  async getRecentEvents(limit = 20): Promise<{
    events: Array<{ id: number; type: string; data: Record<string, unknown>; createdAt: string }>
  }> {
    return request(`/api/events/recent?limit=${limit}`)
  },

  // ─────────────────────────────────────────────
  // GitHub API methods
  // ─────────────────────────────────────────────

  githubInstallUrl(ownerAddress: string): string {
    return `${API_BASE}/api/github/install`
  },

  async githubStatus(ownerAddress: string): Promise<GitHubStatus> {
    return request("/api/github/status", {
      headers: { "X-Owner-Address": ownerAddress },
    })
  },

  async githubDisconnect(ownerAddress: string): Promise<{ disconnected: boolean }> {
    return request("/api/github/disconnect", {
      method: "DELETE",
      headers: { "X-Owner-Address": ownerAddress },
    })
  },

  async githubRepos(ownerAddress: string): Promise<{ repos: GitHubRepo[] }> {
    return request("/api/github/repos", {
      headers: { "X-Owner-Address": ownerAddress },
    })
  },

  async exportToGitHub(
    workflowId: string,
    ownerAddress: string,
    options: {
      repo: string
      owner: string
      createRepo?: boolean
      isPrivate?: boolean
      branch?: string
      createBranch?: boolean
      commitMessage?: string
      path?: string
    },
  ): Promise<GitHubExportResult> {
    return request(`/api/workflows/${workflowId}/export-github`, {
      method: "POST",
      headers: { "X-Owner-Address": ownerAddress },
      body: JSON.stringify(options),
    })
  },

  async importFromGitHub(
    ownerAddress: string,
    url: string,
    branch?: string,
    configPath?: string,
  ): Promise<GitHubImportResult> {
    return request("/api/workflows/import-github", {
      method: "POST",
      headers: { "X-Owner-Address": ownerAddress },
      body: JSON.stringify({ url, branch, configPath }),
    })
  },

  async executeWorkflow(
    id: string,
    ownerAuth?: { address: string; signature: string },
    configOverrides?: Record<string, unknown>,
  ): Promise<{ success: boolean; result: unknown }> {
    const headers: Record<string, string> = {}
    if (ownerAuth) {
      headers["X-Owner-Address"] = ownerAuth.address
      headers["X-Owner-Signature"] = ownerAuth.signature
    }

    // POST when configOverrides provided, GET otherwise (backward compat)
    const usePost = !!configOverrides
    const fetchOpts: RequestInit = {
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
    }

    if (usePost) {
      fetchOpts.method = "POST"
      fetchOpts.body = JSON.stringify({ configOverrides })
    }

    const res = await fetch(`${API_BASE}/api/workflows/${id}/execute`, fetchOpts)

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
