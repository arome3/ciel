import { z } from "zod"

// ─────────────────────────────────────────────
// Request Schemas
// ─────────────────────────────────────────────

export const GenerateRequestSchema = z.object({
  prompt: z.string().min(10).max(2000),
  templateHint: z.number().int().min(1).max(10).optional(),
  parameters: z.record(z.unknown()).optional(),
})

export const SimulateRequestSchema = z.object({
  workflowId: z.string().uuid(),
  config: z.record(z.unknown()).optional(),
})

export const PublishRequestSchema = z.object({
  workflowId: z.string().uuid(),
  name: z.string().min(3).max(100),
  description: z.string().min(10).max(500),
  priceUsdc: z.number().int().min(1000).max(10_000_000),
})

export const WorkflowsListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  category: z
    .enum(["core-defi", "institutional", "risk-compliance", "ai-powered"])
    .optional(),
  search: z.string().optional(),
})

// ─────────────────────────────────────────────
// Response Interfaces
// ─────────────────────────────────────────────

export interface GenerateResponse {
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

export interface SimulateResponse {
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

export interface PublishResponse {
  workflowId: string
  onchainWorkflowId: string
  publishTxHash: string
  x402Endpoint: string
}

export interface WorkflowSummary {
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

export interface WorkflowsListResponse {
  workflows: WorkflowSummary[]
  total: number
  page: number
  limit: number
}
