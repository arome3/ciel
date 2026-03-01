import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import {
  cosineSimilarity,
  isEmbeddingReady,
  warmEmbeddingCache,
  embeddingScores,
  _resetEmbeddingState,
} from "../services/ai-engine/embedding-matcher"

// ─────────────────────────────────────────────
// Suite 1: Cosine Similarity (unit tests — no model needed)
// ─────────────────────────────────────────────

describe("cosineSimilarity", () => {
  test("identical vectors return 1.0", () => {
    const a = new Float32Array([1, 2, 3])
    const b = new Float32Array([1, 2, 3])
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5)
  })

  test("orthogonal vectors return 0.0", () => {
    const a = new Float32Array([1, 0, 0])
    const b = new Float32Array([0, 1, 0])
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5)
  })

  test("opposite vectors return -1.0", () => {
    const a = new Float32Array([1, 2, 3])
    const b = new Float32Array([-1, -2, -3])
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5)
  })

  test("scaled vectors return 1.0 (direction-only)", () => {
    const a = new Float32Array([1, 0, 0])
    const b = new Float32Array([5, 0, 0])
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5)
  })

  test("zero vector returns 0.0", () => {
    const a = new Float32Array([0, 0, 0])
    const b = new Float32Array([1, 2, 3])
    expect(cosineSimilarity(a, b)).toBe(0)
  })

  test("works with 384-dim vectors", () => {
    const a = new Float32Array(384).fill(1)
    const b = new Float32Array(384).fill(1)
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5)
  })
})

// ─────────────────────────────────────────────
// Suite 2: State Guards (no model needed)
// ─────────────────────────────────────────────

describe("Embedding state guards", () => {
  test("isEmbeddingReady returns false before warm", () => {
    _resetEmbeddingState()
    expect(isEmbeddingReady()).toBe(false)
  })

  test("embeddingScores returns empty array when not ready", async () => {
    _resetEmbeddingState()
    const scores = await embeddingScores("Check ETH price and alert me")
    expect(scores).toEqual([])
  })
})

// ─────────────────────────────────────────────
// Suite 3: Model Loading + Scoring (requires ONNX model download)
// ─────────────────────────────────────────────
// These tests download the model on first run (~25MB).
// They are slower but verify the full pipeline works end-to-end.

describe("Embedding model integration", () => {
  beforeAll(async () => {
    _resetEmbeddingState()
    await warmEmbeddingCache()
  }, 120_000) // 2 minute timeout for model download

  afterAll(() => {
    _resetEmbeddingState()
  })

  test("warmEmbeddingCache sets isEmbeddingReady to true", () => {
    expect(isEmbeddingReady()).toBe(true)
  })

  test("embeddingScores returns 22 entries", async () => {
    const scores = await embeddingScores("Monitor ETH price and alert me")
    expect(scores.length).toBe(22)
  })

  test("all scores are in [0, 1] range", async () => {
    const scores = await embeddingScores("Swap tokens on Uniswap when price drops")
    for (const { score } of scores) {
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(1)
    }
  })

  test("scores are sorted descending", async () => {
    const scores = await embeddingScores("Bridge USDC from Ethereum to Base")
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1].score).toBeGreaterThanOrEqual(scores[i].score)
    }
  })

  // ── Natural language ranking tests ──
  // Each prompt should rank the correct template #1

  test("price alert prompt ranks T1 first", async () => {
    const scores = await embeddingScores("Alert me when my crypto goes up in price")
    expect(scores[0].templateId).toBe(1)
  })

  test("portfolio rebalance prompt ranks T2 first", async () => {
    const scores = await embeddingScores("Rebalance my crypto portfolio across chains")
    expect(scores[0].templateId).toBe(2)
  })

  test("prediction market prompt ranks T3 first", async () => {
    const scores = await embeddingScores("Settle a bet when the election results come in")
    expect(scores[0].templateId).toBe(3)
  })

  test("insurance payout prompt ranks T7 first", async () => {
    const scores = await embeddingScores("Pay farmers if rainfall is too low for their crops")
    expect(scores[0].templateId).toBe(7)
  })

  test("AI consensus prompt ranks T9 first", async () => {
    const scores = await embeddingScores("Ask multiple AI models and check if they agree")
    expect(scores[0].templateId).toBe(9)
  })

  test("DEX swap prompt ranks T11 first", async () => {
    const scores = await embeddingScores("Buy ETH on Uniswap when the price dips below $2000")
    expect(scores[0].templateId).toBe(11)
  })

  test("wallet monitoring prompt ranks T12 first", async () => {
    const scores = await embeddingScores("Watch my wallet for large token transfers and alert me")
    expect(scores[0].templateId).toBe(12)
  })

  test("CCIP bridge prompt ranks T15 first", async () => {
    const scores = await embeddingScores("Send USDC from Ethereum to Base chain via bridge")
    expect(scores[0].templateId).toBe(15)
  })

  test("stateful storage prompt ranks T14 first", async () => {
    const scores = await embeddingScores("Store values between runs and compute a running average")
    expect(scores[0].templateId).toBe(14)
  })

  test("dual trigger prompt ranks T16 first", async () => {
    const scores = await embeddingScores("Handle both scheduled execution and on-chain event triggers")
    expect(scores[0].templateId).toBe(16)
  })
})
