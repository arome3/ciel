import { describe, test, expect, mock, beforeEach } from "bun:test"
import { resolve } from "path"

// ─────────────────────────────────────────────
// Mocks — external boundaries only
// ─────────────────────────────────────────────

const SRC = resolve(import.meta.dir, "..")

// ── Config mock ──
mock.module(resolve(SRC, "config.ts"), () => ({
  config: {
    DATABASE_PATH: ":memory:",
    NODE_ENV: "test",
  },
}))

// ── Logger mock ──
mock.module(resolve(SRC, "lib/logger.ts"), () => ({
  createLogger: () => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }),
}))

// ── DB mock ──
const MOCK_WORKFLOWS = [
  { id: "wf-1", name: "Price Feed", priceUsdc: 50000, ownerAddress: "0xOwner1" },
  { id: "wf-2", name: "Threshold", priceUsdc: 20000, ownerAddress: "0xOwner2" },
  { id: "wf-3", name: "Alert", priceUsdc: 30000, ownerAddress: "0xOwner3" },
]

let mockWhereResult: any[] = []

const mockWhere = mock(() => Promise.resolve(mockWhereResult))
const mockFrom = mock(() => ({ where: mockWhere }))
const mockSelect = mock(() => ({ from: mockFrom }))

mock.module(resolve(SRC, "db/index.ts"), () => ({
  db: { select: mockSelect },
}))

// Need to mock schema for imports
mock.module(resolve(SRC, "db/schema.ts"), () => ({
  workflows: {
    id: "id",
    name: "name",
    priceUsdc: "price_usdc",
    ownerAddress: "owner_address",
  },
  pipelines: {},
  pipelineExecutions: {},
}))

// ─────────────────────────────────────────────
// Import after mocks
// ─────────────────────────────────────────────

const { calculatePipelinePrice, getPriceBreakdown } = await import(
  "../services/pipeline/pricing"
)

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

describe("calculatePipelinePrice", () => {
  beforeEach(() => {
    mockWhereResult = MOCK_WORKFLOWS
  })

  test("sums prices for all steps", async () => {
    const steps = [
      { id: "s1", workflowId: "wf-1", position: 0 },
      { id: "s2", workflowId: "wf-2", position: 1 },
      { id: "s3", workflowId: "wf-3", position: 2 },
    ]

    const total = await calculatePipelinePrice(steps)
    expect(total).toBe("100000") // 50000 + 20000 + 30000
  })

  test("empty steps → '0'", async () => {
    const total = await calculatePipelinePrice([])
    expect(total).toBe("0")
  })

  test("duplicate workflow references counted separately", async () => {
    const steps = [
      { id: "s1", workflowId: "wf-1", position: 0 },
      { id: "s2", workflowId: "wf-1", position: 1 },
    ]

    const total = await calculatePipelinePrice(steps)
    expect(total).toBe("100000") // 50000 * 2
  })

  test("missing workflow → 0 for that step", async () => {
    mockWhereResult = [MOCK_WORKFLOWS[0]] // Only wf-1

    const steps = [
      { id: "s1", workflowId: "wf-1", position: 0 },
      { id: "s2", workflowId: "wf-missing", position: 1 },
    ]

    const total = await calculatePipelinePrice(steps)
    expect(total).toBe("50000") // Only wf-1 price
  })
})

describe("getPriceBreakdown", () => {
  beforeEach(() => {
    mockWhereResult = MOCK_WORKFLOWS
  })

  test("returns per-step breakdown", async () => {
    const steps = [
      { id: "s1", workflowId: "wf-1", position: 0 },
      { id: "s2", workflowId: "wf-2", position: 1 },
    ]

    const breakdown = await getPriceBreakdown(steps)

    expect(breakdown).toHaveLength(2)
    expect(breakdown[0].workflowName).toBe("Price Feed")
    expect(breakdown[0].priceUsdc).toBe(50000)
    expect(breakdown[0].creatorAddress).toBe("0xOwner1")
    expect(breakdown[0].position).toBe(0)
    expect(breakdown[1].workflowName).toBe("Threshold")
    expect(breakdown[1].priceUsdc).toBe(20000)
  })

  test("empty steps → empty breakdown", async () => {
    const breakdown = await getPriceBreakdown([])
    expect(breakdown).toHaveLength(0)
  })

  test("missing workflow → defaults", async () => {
    mockWhereResult = [] // No workflows found

    const steps = [{ id: "s1", workflowId: "wf-missing", position: 0 }]

    const breakdown = await getPriceBreakdown(steps)

    expect(breakdown[0].workflowName).toBe("Unknown")
    expect(breakdown[0].priceUsdc).toBe(0)
    expect(breakdown[0].creatorAddress).toBe("")
  })
})
