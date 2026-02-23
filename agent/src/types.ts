// agent/src/types.ts — Shared types for the Ciel demo agent

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
  source: "registry" | "bazaar"
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
}

export interface FitnessScore {
  total: number
  breakdown: {
    schemaMatch: number
    outputUsefulness: number
    priceScore: number
    reliabilityScore: number
  }
  recommendation: "execute" | "skip" | "review"
}

export interface RankedWorkflow {
  workflow: DiscoveredWorkflow
  fitness: FitnessScore
}

export interface ExecutionResult {
  success: boolean
  answer?: string
  confidence?: number
  modelsAgreed?: number
  consensusReached?: boolean
  txHash?: string
  blockNumber?: number
  explorerUrl?: string
}

export interface AgentConfig {
  privateKey: `0x${string}`
  rpcUrl: string
  cielApiUrl: string
  facilitatorUrl: string
  bazaarUrl: string
  category: string
  goal: string
}

// ─────────────────────────────────────────────
// Simulation
// ─────────────────────────────────────────────

export interface SimulationResult {
  workflowId: string
  success: boolean
  trace: Array<{
    step: string
    status: string
    duration: number
    output: string
  }>
  duration?: number
}

// ─────────────────────────────────────────────
// Pipeline
// ─────────────────────────────────────────────

export interface PipelineStepResult {
  stepId: string
  workflowId: string
  success: boolean
  output?: Record<string, unknown>
  duration?: number
  error?: string
}

export interface PipelineResult {
  executionId: string
  status: "completed" | "partial" | "failed"
  stepResults: PipelineStepResult[]
  finalOutput?: Record<string, unknown>
  duration: number
}

// ─────────────────────────────────────────────
// SSE Events
// ─────────────────────────────────────────────

export interface SSEEvent {
  type: string
  data: Record<string, unknown>
}
