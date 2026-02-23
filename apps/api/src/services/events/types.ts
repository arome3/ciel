// ─────────────────────────────────────────────
// SSE Event Types — discriminated union
// ─────────────────────────────────────────────

/** Max concurrent SSE connections before returning 503 */
export const MAX_SSE_CLIENTS = 50

export interface ExecutionEventData {
  workflowId: string
  workflowName: string
  agentAddress: string
  result: unknown
  txHash?: string
  timestamp: number
}

export interface PublishEventData {
  workflowId: string
  name: string
  category: string
  txHash: string
  timestamp: number
}

export interface DeployEventData {
  workflowId: string
  status: "deployed" | "failed"
  donWorkflowId?: string
  error?: string
  timestamp: number
}

export interface DiscoveryEventData {
  agentAddress: string
  query: string
  matchCount: number
  timestamp: number
}

export interface ExecutionEvent {
  type: "execution"
  silent?: boolean
  data: ExecutionEventData
}

export interface PublishEvent {
  type: "publish"
  silent?: boolean
  data: PublishEventData
}

export interface DeployEvent {
  type: "deploy"
  silent?: boolean
  data: DeployEventData
}

export interface DiscoveryEvent {
  type: "discovery"
  silent?: boolean
  data: DiscoveryEventData
}

// ─────────────────────────────────────────────
// Pipeline Event Types
// ─────────────────────────────────────────────

export interface PipelineStartedEventData {
  pipelineId: string
  executionId: string
  pipelineName: string
  stepCount: number
  totalPrice: string
  timestamp: number
}

export interface PipelineStepStartedEventData {
  pipelineId: string
  executionId: string
  stepId: string
  workflowId: string
  position: number
  timestamp: number
}

export interface PipelineStepCompletedEventData {
  pipelineId: string
  executionId: string
  stepId: string
  workflowName: string
  output: unknown
  duration: number
  timestamp: number
}

export interface PipelineStepFailedEventData {
  pipelineId: string
  executionId: string
  stepId: string
  error: string
  duration: number
  timestamp: number
}

export interface PipelineCompletedEventData {
  pipelineId: string
  executionId: string
  status: "completed" | "partial"
  finalOutput: unknown
  totalDuration: number
  totalPaid: string | null
  stepsCompleted: number
  stepsTotal: number
  timestamp: number
}

export interface PipelineFailedEventData {
  pipelineId: string
  executionId: string
  status: "failed"
  finalOutput: unknown
  totalDuration: number
  totalPaid: string | null
  stepsCompleted: number
  stepsTotal: number
  timestamp: number
}

export interface PipelineStartedEvent {
  type: "pipeline_started"
  silent?: boolean
  data: PipelineStartedEventData
}

export interface PipelineStepStartedEvent {
  type: "pipeline_step_started"
  silent?: boolean
  data: PipelineStepStartedEventData
}

export interface PipelineStepCompletedEvent {
  type: "pipeline_step_completed"
  silent?: boolean
  data: PipelineStepCompletedEventData
}

export interface PipelineStepFailedEvent {
  type: "pipeline_step_failed"
  silent?: boolean
  data: PipelineStepFailedEventData
}

export interface PipelineCompletedEvent {
  type: "pipeline_completed"
  silent?: boolean
  data: PipelineCompletedEventData
}

export interface PipelineFailedEvent {
  type: "pipeline_failed"
  silent?: boolean
  data: PipelineFailedEventData
}

export type SSEEvent =
  | ExecutionEvent
  | PublishEvent
  | DeployEvent
  | DiscoveryEvent
  | PipelineStartedEvent
  | PipelineStepStartedEvent
  | PipelineStepCompletedEvent
  | PipelineStepFailedEvent
  | PipelineCompletedEvent
  | PipelineFailedEvent
