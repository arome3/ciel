export interface CielSDKConfig {
  apiUrl: string
  privateKey?: string
  network?: string
  timeout?: number
}

export interface DiscoverQuery {
  category?: string
  chain?: string
  capability?: string
}

export interface DiscoveredWorkflow {
  workflowId: string
  name: string
  description: string
  category: string
  chains: string[]
  capabilities: string[]
  priceUsdc: number
  x402Endpoint: string
  totalExecutions: number
  successfulExecutions: number
  source: string
  inputSchema?: unknown
  outputSchema?: unknown
}

export interface WorkflowDetail {
  id: string
  name: string
  description: string
  prompt: string
  category: string
  priceUsdc: number
  capabilities: string[]
  chains: string[]
  totalExecutions: number
  successfulExecutions: number
  published: boolean
  deployStatus: string | null
  ownerAddress: string
  code: string
  config: Record<string, unknown>
  configJson: string
  templateId: number
  templateName: string
  consumerSol: string | null
  simulationTrace: Array<{ step: string; status: string; duration: number; output: string }> | null
  onchainWorkflowId: string | null
  donWorkflowId: string | null
  publishTxHash: string | null
  x402Endpoint: string | null
  inputSchema: unknown
  outputSchema: unknown
  createdAt: string
  updatedAt: string
}

export interface ListWorkflowsParams {
  page?: number
  limit?: number
  category?: string
  search?: string
}

export interface ListWorkflowsResponse {
  workflows: Array<{
    id: string
    name: string
    description: string
    prompt: string
    category: string
    priceUsdc: number
    capabilities: string[]
    chains: string[]
    totalExecutions: number
    successfulExecutions: number
    published: boolean
    deployStatus: string | null
    ownerAddress: string
    createdAt: string
  }>
  total: number
  page: number
  limit: number
}

export interface ExecuteOptions {
  configOverrides?: Record<string, unknown>
}

export interface ExecutionResult {
  executionId: string
  workflowId: string
  success: boolean
  result: unknown
  duration: number
  payment?: {
    txHash?: string
    amountUsdc?: number
  }
}

export class CielSDKError extends Error {
  public readonly code: string
  public readonly statusCode?: number

  constructor(code: string, message: string, statusCode?: number) {
    super(message)
    this.code = code
    this.statusCode = statusCode
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
