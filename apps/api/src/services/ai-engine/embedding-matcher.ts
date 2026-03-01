// ─────────────────────────────────────────────
// Embedding Matcher — Semantic Signal Layer
// ─────────────────────────────────────────────
// Uses all-MiniLM-L6-v2 (22M params, 384-dim) via @huggingface/transformers
// to embed user prompts and compare against pre-computed template centroids.
//
// Key patterns:
//   - Lazy model loading: first call downloads ONNX weights, cached thereafter
//   - Graceful degradation: if model fails, keyword system operates alone
//   - Template centroids: averaged embeddings of 5-8 example prompts per template
//   - Cosine similarity: dot(a,b) / (||a|| * ||b||), hand-rolled (5 lines)

import { createLogger } from "../../lib/logger"

const log = createLogger("EmbeddingMatcher")

// ─────────────────────────────────────────────
// State
// ─────────────────────────────────────────────

let embedder: ((text: string) => Promise<Float32Array>) | null = null
let ready = false
let warmPromise: Promise<void> | null = null

// 22 template centroids: templateId → 384-dim vector
const centroids: Map<number, Float32Array> = new Map()

// ─────────────────────────────────────────────
// Template Example Prompts (natural language, NOT keyword-engineered)
// ─────────────────────────────────────────────

const TEMPLATE_EXAMPLES: Record<number, string[]> = {
  1: [
    "Alert me when ETH price goes above $4000",
    "Send a notification if BTC drops below $30,000",
    "Track the price of Solana and notify me on big moves",
    "Monitor token price and warn me when it crashes",
    "Keep an eye on crypto prices and text me if something changes",
    "Set up a price alert for my favorite token",
  ],
  2: [
    "Rebalance my portfolio across multiple chains",
    "Automatically adjust my crypto allocations when they drift",
    "Keep my portfolio balanced across Ethereum and Base",
    "Redistribute my holdings when one asset grows too large",
    "Cross-chain portfolio management with automatic rebalancing",
    "Balance my DeFi positions based on yield performance",
  ],
  3: [
    "Settle a prediction market bet when the game ends",
    "Pay out winners after the election results are in",
    "Resolve a prediction market outcome using AI verification",
    "Determine who won the bet and distribute winnings",
    "Use AI to verify sports results and settle markets",
    "Polymarket settlement with multi-source verification",
  ],
  4: [
    "Mint stablecoins when someone deposits collateral",
    "Issue new tokens after checking compliance and reserves",
    "Create USDC when a bank deposit is confirmed",
    "Stablecoin minting pipeline with KYC verification",
    "Process fiat deposits and issue corresponding stablecoins",
  ],
  5: [
    "Verify that our stablecoin is fully backed by reserves",
    "Check the collateralization ratio and publish proof on-chain",
    "Monitor reserve levels and alert if under-collateralized",
    "Daily proof of reserve attestation for our token",
    "Audit the backing ratio and write the result on-chain",
  ],
  6: [
    "Process fund subscriptions and calculate NAV",
    "Handle investor redemptions with share price calculation",
    "Tokenized fund management with daily NAV updates",
    "Accept new investments and mint fund shares",
    "Calculate net asset value and process redemption requests",
  ],
  7: [
    "Pay farmers automatically if it doesn't rain enough",
    "Trigger insurance payout when temperature exceeds threshold",
    "Weather-based parametric insurance for crop damage",
    "Flight delay insurance that auto-pays when delayed",
    "Climate insurance that settles based on rainfall data",
    "Compensate policyholders when weather conditions hit triggers",
  ],
  8: [
    "Block transactions from sanctioned addresses",
    "Check KYC status before allowing DeFi operations",
    "Screen wallets against compliance blacklists",
    "Gate DeFi access behind AML verification",
    "Reject transactions from non-compliant users",
    "Sanctions screening for on-chain operations",
  ],
  9: [
    "Ask GPT, Claude, and Gemini to verify the same data point",
    "Use multiple AI models to reach consensus on a value",
    "Cross-check AI outputs to prevent hallucination",
    "Multi-model verification oracle for on-chain data",
    "Get consensus from three AIs before writing results",
    "Byzantine fault tolerant AI oracle with median voting",
  ],
  10: [
    "Aggregate data from multiple custom API sources",
    "Create a composite price index from several feeds",
    "Build a custom oracle that combines multiple data sources",
    "Publish a weighted average of different price feeds",
    "Custom data aggregation oracle for on-chain publishing",
  ],
  11: [
    "Buy ETH automatically when the price dips below $2000",
    "Swap tokens on Uniswap when conditions are right",
    "Auto-trade on a DEX when price hits my target",
    "Conditional token swap when market drops",
    "Set up a limit-order-like automation on Uniswap",
    "DCA into ETH by buying every day if price is low",
  ],
  12: [
    "Watch my wallet for large incoming transfers",
    "Alert me when a whale moves tokens from an address",
    "Monitor wallet activity and notify on big movements",
    "Track token transfers on a specific address",
    "Watch for ERC-20 transfers to and from my wallet",
    "Whale alert: notify when large amounts move on-chain",
  ],
  13: [
    "Read the latest price from a Chainlink data feed",
    "Get the current ETH/USD price from the Chainlink oracle",
    "Query a Chainlink price proxy contract on-chain",
    "Fetch the latest answer from an aggregator contract",
    "Read on-chain Chainlink feed data periodically",
  ],
  14: [
    "Remember values between workflow runs",
    "Keep a running average of prices across executions",
    "Store state in S3 and update it each time",
    "Track a counter that persists between runs",
    "Accumulate data over time with stateful storage",
    "Save historical values and compute trends",
  ],
  15: [
    "Send USDC from Ethereum to Base using CCIP",
    "Bridge my tokens cross-chain via Chainlink",
    "Move assets from one chain to another automatically",
    "Cross-chain token transfer when balance is high",
    "CCIP bridge tokens between networks on a schedule",
  ],
  16: [
    "React to both a scheduled timer and on-chain events",
    "Handle cron schedules and contract events in one workflow",
    "Two triggers: periodic check plus event listener",
    "Dual handler for both timed execution and log events",
    "Combined schedule and event-driven workflow with two handlers",
  ],
  17: [
    "Burn stablecoins after compliance check",
    "Redeem USDC tokens and permanently burn them from supply",
    "Remove tokens from circulation by burning redeemed stablecoins",
    "Destroy tokens when a user redeems their stablecoins",
    "Verify compliance then burn and reduce total token supply",
    "Burn and redeem stablecoins on demand",
  ],
  18: [
    "Initiate bank wire transfer every 4 hours",
    "Send SWIFT payment for settled trades",
    "Automated payment processing with idempotency tracking",
    "Process pending wire transfers on a schedule",
    "Bank payment initiation and confirmation workflow",
    "Schedule automatic remittance payments",
  ],
  19: [
    "Lock tokens in escrow until delivery confirmed",
    "Release escrow when settlement conditions are met",
    "Hold funds in escrow for delivery versus payment",
    "Escrow management for trade settlement",
    "Lock collateral and release when conditions clear",
    "DvP escrow workflow with conditional release",
  ],
  20: [
    "Reconcile on-chain settlements with bank records daily",
    "Check if DvP settlement matches on-chain state",
    "Daily settlement reconciliation between off-chain and blockchain",
    "Compare clearing house records with on-chain ledger",
    "Detect settlement mismatches and alert operations team",
    "T+1 settlement verification and attestation",
  ],
  21: [
    "Update shareholder registry when equity transfers occur",
    "Maintain cap table on chain with compliance checks",
    "Process share transfers through a digital transfer agent",
    "On-chain shareholder registry with KYC gating",
    "Register equity holder changes on blockchain",
  ],
  22: [
    "Distribute dividends to all token holders monthly",
    "Calculate pro rata payout for shareholders",
    "Batch dividend payments to equity holders",
    "Monthly shareholder dividend distribution workflow",
    "Pay dividends proportionally based on share ownership",
    "Automated yield distribution to registered holders",
  ],
}

// ─────────────────────────────────────────────
// Cosine Similarity
// ─────────────────────────────────────────────

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

// ─────────────────────────────────────────────
// Model Loading + Embedding
// ─────────────────────────────────────────────

async function loadModel(): Promise<(text: string) => Promise<Float32Array>> {
  // Dynamic import to avoid blocking module load
  const { pipeline } = await import("@huggingface/transformers")

  const extractor = await pipeline(
    "feature-extraction",
    "Xenova/all-MiniLM-L6-v2",
  )

  return async (text: string): Promise<Float32Array> => {
    const output = await extractor(text, { pooling: "mean", normalize: true })
    // output.data is a flat Float32Array for single input
    return new Float32Array(output.data as ArrayLike<number>)
  }
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * Pre-loads the ONNX model and computes template centroid vectors.
 * Call at server startup (fire-and-forget). Idempotent.
 */
export function warmEmbeddingCache(): Promise<void> {
  // Shared Promise pattern: concurrent callers await the same in-flight warm.
  // Prevents _resetEmbeddingState() race where clearing `warming` mid-flight
  // allowed a second warm to start and corrupt state.
  if (ready) return Promise.resolve()
  if (warmPromise) return warmPromise

  warmPromise = (async () => {
    try {
      log.info("Loading embedding model...")
      embedder = await loadModel()

      // Compute centroids for each template
      for (const [idStr, examples] of Object.entries(TEMPLATE_EXAMPLES)) {
        const id = parseInt(idStr, 10)
        const embeddings: Float32Array[] = []

        for (const example of examples) {
          const vec = await embedder(example)
          embeddings.push(vec)
        }

        // Average all embeddings → centroid
        const dim = embeddings[0].length
        const centroid = new Float32Array(dim)
        for (const emb of embeddings) {
          for (let i = 0; i < dim; i++) {
            centroid[i] += emb[i]
          }
        }
        for (let i = 0; i < dim; i++) {
          centroid[i] /= embeddings.length
        }

        centroids.set(id, centroid)
      }

      ready = true
      log.info(`Embedding cache warm: ${centroids.size} template centroids computed`)
    } catch (err) {
      log.info(
        "Embedding model failed to load — keyword-only mode:",
        err instanceof Error ? err.message : String(err),
      )
      ready = false
    } finally {
      warmPromise = null
    }
  })()

  return warmPromise
}

/**
 * Returns true if the embedding model is loaded and centroids are computed.
 */
export function isEmbeddingReady(): boolean {
  return ready
}

/**
 * Computes cosine similarity scores for a prompt against all template centroids.
 * Returns empty array if model is not loaded (graceful degradation).
 */
export async function embeddingScores(
  prompt: string,
): Promise<Array<{ templateId: number; score: number }>> {
  if (!ready || !embedder) return []

  try {
    const promptVec = await embedder(prompt)

    const scores: Array<{ templateId: number; score: number }> = []
    for (const [templateId, centroid] of centroids) {
      const raw = cosineSimilarity(promptVec, centroid)
      // Clamp to [0, 1]: cosine similarity returns [-1, 1] but our fusion
      // formula assumes non-negative scores. Negative similarity means
      // the prompt is semantically opposite to the template — treat as 0.
      const score = Math.max(0, Math.min(1, raw))
      scores.push({ templateId, score })
    }

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score)
    return scores
  } catch (err) {
    log.debug("Embedding scoring failed:", err instanceof Error ? err.message : String(err))
    return []
  }
}

// ─────────────────────────────────────────────
// Test Introspection (underscore prefix per convention)
// ─────────────────────────────────────────────

export function _resetEmbeddingState(): void {
  embedder = null
  ready = false
  warmPromise = null
  centroids.clear()
}
