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

export type SSEEvent = ExecutionEvent | PublishEvent | DeployEvent | DiscoveryEvent
