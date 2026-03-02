import type { CliConfig } from "./config"
import { apiUnreachable, apiError } from "./errors"

export interface GenerateResponse {
  workflowId: string
  code: string
  configJson: string
  template: {
    id: string
    name: string
    confidence: number
  }
  validation: {
    passed: boolean
    checks: Array<{ name: string; passed: boolean; message?: string }>
  }
  secretsYaml: string | null
}

export interface SimulateResponse {
  success: boolean
  output: unknown
  logs: string[]
  duration: number
  trace?: Array<{
    step: string
    status: string
    detail?: string
    duration?: number
  }>
}

export interface WorkflowSummary {
  id: string
  name: string | null
  description: string | null
  prompt: string
  category: string
  priceUsdc: number | null
  executionCount: number
  published: boolean
  deployStatus: string | null
  ownerAddress: string | null
  createdAt: string
}

export interface WorkflowDetail extends WorkflowSummary {
  code: string
  configJson: string
  capabilities: string | null
  onchainWorkflowId: string | null
  donWorkflowId: string | null
}

export interface PublishResponse {
  workflowId: string
  onchainWorkflowId: string
  publishTxHash: string
  x402Endpoint: string
  deployStatus: string
  donWorkflowId: string | null
}

export interface DiscoveredWorkflow {
  id: string
  name: string
  description: string
  category: string
  chain: string
  priceUsdc: number
  capabilities: string[]
  executionCount: number
  source: string
}

export interface HealthResponse {
  status: string
  uptime: number
  sseClients: number
  database: string
}

export interface PipelineSummary {
  id: string
  name: string
  description: string | null
  ownerAddress: string
  steps: unknown[]
  totalPriceUsdc: number
  active: boolean
  executionCount: number
  createdAt: string
}

export interface PipelineExecution {
  id: string
  pipelineId: string
  status: string
  results: unknown
  startedAt: string
  completedAt: string | null
}

export class CielClient {
  private baseUrl: string
  private timeout: number

  constructor(config: CliConfig) {
    this.baseUrl = config.apiUrl.replace(/\/$/, "")
    this.timeout = config.timeout
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`

    try {
      const res = await fetch(url, {
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
        },
        signal: AbortSignal.timeout(this.timeout),
        ...options,
      })

      if (!res.ok) {
        let message = `Request failed (${res.status})`
        let details: unknown
        try {
          const body = await res.json()
          if (body.error?.message) message = body.error.message
          else if (body.message) message = body.message
          details = body.error?.details ?? body.details
        } catch { /* use default message */ }
        throw apiError(res.status, message, details)
      }

      return res.json() as Promise<T>
    } catch (err) {
      if (err instanceof TypeError && (err.message.includes("fetch") || err.message.includes("connect"))) {
        throw apiUnreachable(this.baseUrl)
      }
      throw err
    }
  }

  private qs(params?: Record<string, string | number | boolean | undefined>): string {
    if (!params) return ""
    const query = new URLSearchParams()
    for (const [key, val] of Object.entries(params)) {
      if (val !== undefined) query.set(key, String(val))
    }
    const str = query.toString()
    return str ? `?${str}` : ""
  }

  // ── Workflow endpoints ──

  async generate(
    prompt: string,
    templateHint?: string,
  ): Promise<GenerateResponse> {
    return this.request<GenerateResponse>("/api/generate", {
      method: "POST",
      body: JSON.stringify({
        prompt,
        ...(templateHint && { templateHint }),
      }),
    })
  }

  async simulate(
    workflowId: string,
    config?: Record<string, unknown>,
  ): Promise<SimulateResponse> {
    return this.request<SimulateResponse>("/api/simulate", {
      method: "POST",
      body: JSON.stringify({
        mode: "stored",
        workflowId,
        ...(config && { config }),
      }),
    })
  }

  async publish(
    workflowId: string,
    name: string,
    description: string,
    priceUsdc: number,
    authHeaders: Record<string, string>,
  ): Promise<PublishResponse> {
    return this.request<PublishResponse>("/api/publish", {
      method: "POST",
      body: JSON.stringify({ workflowId, name, description, priceUsdc }),
      headers: authHeaders,
    })
  }

  async executeWorkflow(
    workflowId: string,
    authHeaders?: Record<string, string>,
  ): Promise<{ result: unknown; payment?: unknown }> {
    return this.request(`/api/workflows/${workflowId}/execute`, {
      headers: authHeaders,
    })
  }

  async redeploy(
    workflowId: string,
    authHeaders: Record<string, string>,
  ): Promise<{ workflowId: string; deployStatus: string }> {
    return this.request(`/api/workflows/${workflowId}/redeploy`, {
      method: "POST",
      headers: authHeaders,
    })
  }

  async listWorkflows(params?: {
    page?: number
    limit?: number
    category?: string
    search?: string
  }): Promise<{ workflows: WorkflowSummary[]; total: number; page: number; limit: number }> {
    return this.request(`/api/workflows${this.qs(params)}`)
  }

  async getWorkflow(id: string): Promise<WorkflowDetail> {
    return this.request(`/api/workflows/${id}`)
  }

  async discover(params?: {
    category?: string
    chain?: string
    capability?: string
  }): Promise<{ workflows: DiscoveredWorkflow[] }> {
    return this.request(`/api/discover${this.qs(params)}`)
  }

  // ── Pipeline endpoints ──

  async createPipeline(
    data: {
      name: string
      description?: string
      ownerAddress: string
      steps: unknown[]
    },
    authHeaders: Record<string, string>,
  ): Promise<PipelineSummary> {
    return this.request("/api/pipelines", {
      method: "POST",
      body: JSON.stringify(data),
      headers: authHeaders,
    })
  }

  async listPipelines(params?: {
    page?: number
    limit?: number
    owner?: string
    active?: boolean
  }): Promise<{ pipelines: PipelineSummary[]; total: number }> {
    return this.request(`/api/pipelines${this.qs(params)}`)
  }

  async getPipeline(id: string): Promise<PipelineSummary> {
    return this.request(`/api/pipelines/${id}`)
  }

  async executePipeline(
    id: string,
    input: unknown,
    authHeaders?: Record<string, string>,
  ): Promise<PipelineExecution> {
    return this.request(`/api/pipelines/${id}/execute`, {
      method: "POST",
      body: JSON.stringify({ input }),
      headers: authHeaders,
    })
  }

  async pipelineHistory(
    id: string,
    params?: { page?: number; limit?: number },
  ): Promise<{ executions: PipelineExecution[]; total: number }> {
    return this.request(`/api/pipelines/${id}/history${this.qs(params)}`)
  }

  // ── Tenderly endpoints ──

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
    return this.request("/api/tenderly/create", {
      method: "POST",
      body: JSON.stringify(opts),
    })
  }

  async tenderlyDeployContracts(): Promise<{
    registryAddress: string
    consumerAddress: string
    explorerUrl: string
  }> {
    return this.request("/api/tenderly/deploy-contracts", {
      method: "POST",
    })
  }

  async tenderlyFund(
    address: string,
    amountEth: number = 100,
  ): Promise<{ address: string; amountEth: number; funded: boolean }> {
    return this.request("/api/tenderly/fund", {
      method: "POST",
      body: JSON.stringify({ address, amountEth }),
    })
  }

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
    return this.request("/api/tenderly/status")
  }

  async tenderlySnapshot(): Promise<{ snapshotId: string }> {
    return this.request("/api/tenderly/snapshot", {
      method: "POST",
    })
  }

  async tenderlyRevert(snapshotId: string): Promise<{ reverted: boolean; snapshotId: string }> {
    return this.request("/api/tenderly/revert", {
      method: "POST",
      body: JSON.stringify({ snapshotId }),
    })
  }

  async tenderlyCleanup(): Promise<{ destroyed: boolean }> {
    return this.request("/api/tenderly/cleanup", {
      method: "DELETE",
    })
  }

  // ── System endpoints ──

  async health(): Promise<HealthResponse> {
    return this.request("/health")
  }

  async connectSSE(): Promise<Response> {
    const url = `${this.baseUrl}/api/events`
    const res = await fetch(url, {
      headers: { Accept: "text/event-stream" },
    })
    if (!res.ok) {
      throw apiError(res.status, "Failed to connect to event stream")
    }
    return res
  }
}
