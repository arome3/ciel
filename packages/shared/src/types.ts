export interface Workflow {
  id: string
  name: string
  description: string
  prompt: string
  templateId: number
  templateName: string
  code: string
  config: string
  consumerSol?: string
  simulationSuccess: boolean
  simulationTrace?: string
  simulationDuration?: number
  published: boolean
  onchainWorkflowId?: string
  publishTxHash?: string
  ownerAddress: string
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  x402Endpoint?: string
  priceUsdc: number
  category: string
  capabilities: string
  chains: string
  totalExecutions: number
  successfulExecutions: number
  createdAt: string
  updatedAt: string
}
