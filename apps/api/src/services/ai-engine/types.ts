export interface ParsedIntent {
  /** How the workflow is triggered */
  triggerType: "cron" | "http" | "evm_log" | "unknown"

  /** Confidence score for trigger type classification (0-1) */
  confidence: number

  /** Cron expression if a schedule was detected */
  schedule?: string

  /** Data sources the workflow needs, e.g. ["price-feed", "weather-api"] */
  dataSources: string[]

  /** Conditional expressions, e.g. ["drops below $1800", "exceeds 2%"] */
  conditions: string[]

  /** Actions to perform, e.g. ["evmWrite", "alert"] */
  actions: string[]

  /** Target chains, e.g. ["base-sepolia", "ethereum-sepolia"] */
  chains: string[]

  /** All significant words extracted from the prompt (length > 3, lowercased) */
  keywords: string[]

  /** Whether negation was detected in the prompt (e.g., "don't", "never", "stop") */
  negated: boolean

  /** Named entities detected (brand names, proper nouns) mapped to source IDs */
  entities: Record<string, string[]>
}
