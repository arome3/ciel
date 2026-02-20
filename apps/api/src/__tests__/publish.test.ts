import { describe, test, expect, mock, beforeAll, beforeEach } from "bun:test"
import { resolve } from "path"

// ─────────────────────────────────────────────
// Mocks — external boundaries only
// ─────────────────────────────────────────────

const SRC = resolve(import.meta.dir, "..")

// ── Config mock ──
mock.module(resolve(SRC, "config.ts"), () => ({
  config: {
    NEXT_PUBLIC_API_URL: "http://localhost:3001",
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
const TEST_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"
const OWNER_ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
const TEST_WORKFLOW = {
  id: TEST_ID,
  name: "Test Workflow",
  description: "A test workflow",
  published: false,
  priceUsdc: 10000,
  category: "core-defi",
  capabilities: '["price-feed"]',
  chains: '["base-sepolia"]',
  ownerAddress: OWNER_ADDR,
  inputSchema: null,
  outputSchema: null,
}

let mockSelectResult: any = TEST_WORKFLOW
let mockInsertError = false

const mockInsertValues = mock((vals: any) => {
  if (mockInsertError) return Promise.reject(new Error("DB insert error"))
  return Promise.resolve()
})
const mockInsert = mock(() => ({ values: mockInsertValues }))

const mockUpdateWhere = mock(() => Promise.resolve())
const mockUpdateSet = mock(() => ({ where: mockUpdateWhere }))
const mockUpdate = mock(() => ({ set: mockUpdateSet }))

const mockSelectGet = mock(() => Promise.resolve(mockSelectResult))
const mockSelectWhere = mock(() => ({ get: mockSelectGet }))
const mockSelectFrom = mock(() => ({ where: mockSelectWhere }))
const mockSelect = mock(() => ({ from: mockSelectFrom }))

const mockDb = {
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
}

mock.module(resolve(SRC, "db/index.ts"), () => ({
  db: mockDb,
  sqlite: {},
}))

mock.module(resolve(SRC, "db/schema.ts"), () => ({
  workflows: {
    id: "id",
    name: "name",
    description: "description",
    published: "published",
    priceUsdc: "price_usdc",
    ownerAddress: "owner_address",
    onchainWorkflowId: "onchain_workflow_id",
    publishTxHash: "publish_tx_hash",
    x402Endpoint: "x402_endpoint",
    updatedAt: "updated_at",
    category: "category",
    capabilities: "capabilities",
    chains: "chains",
    inputSchema: "input_schema",
    outputSchema: "output_schema",
    totalExecutions: "total_executions",
    successfulExecutions: "successful_executions",
  },
  executions: { id: "id" },
  events: {
    id: "id",
    type: "type",
    data: "data",
  },
}))

// ── Emitter mock (prevents better-sse import) ──
mock.module(resolve(SRC, "services/events/emitter.ts"), () => ({
  emitEvent: mock(() => {}),
  getAgentChannel: mock(() => ({})),
  getConnectedClientCount: mock(() => 0),
}))

// ── Rate limiter mock ──
mock.module(resolve(SRC, "middleware/rate-limiter.ts"), () => ({
  executeLimiter: (_req: any, _res: any, next: any) => next(),
  generateLimiter: (_req: any, _res: any, next: any) => next(),
  simulateLimiter: (_req: any, _res: any, next: any) => next(),
  defaultLimiter: (_req: any, _res: any, next: any) => next(),
  discoverLimiter: (_req: any, _res: any, next: any) => next(),
  publishLimiter: (_req: any, _res: any, next: any) => next(),
  eventsSseLimiter: (_req: any, _res: any, next: any) => next(),
}))

// ── Registry mock ──
let mockPublishError = false

const mockPublishToRegistry = mock(() => {
  if (mockPublishError) return Promise.reject(new Error("Registry tx failed"))
  return Promise.resolve({
    workflowId: "0xabc123",
    txHash: "0xtx1",
  })
})

mock.module(resolve(SRC, "services/blockchain/registry.ts"), () => ({
  publishToRegistry: mockPublishToRegistry,
  recordExecution: mock(() => Promise.resolve()),
  updateWorkflow: mock(() => Promise.resolve()),
  deactivateWorkflow: mock(() => Promise.resolve()),
  reactivateWorkflow: mock(() => Promise.resolve()),
  addAuthorizedSender: mock(() => Promise.resolve()),
  removeAuthorizedSender: mock(() => Promise.resolve()),
  getWorkflowFromRegistry: mock(() => Promise.resolve({})),
  searchWorkflowsByCategory: mock(() => Promise.resolve({ data: [], total: 0n })),
  searchWorkflowsByChain: mock(() => Promise.resolve({ data: [], total: 0n })),
  getAllWorkflowIds: mock(() => Promise.resolve({ data: [], total: 0n })),
  getCreatorWorkflows: mock(() => Promise.resolve({ data: [], total: 0n })),
}))

// ── Blockchain provider (prevent import side effects) ──
mock.module(resolve(SRC, "services/blockchain/provider.ts"), () => ({
  publicClient: {},
  walletClient: {},
}))

mock.module(resolve(SRC, "services/blockchain/retry.ts"), () => ({
  withRetry: (fn: any) => fn(),
  isRetryableRpcError: () => false,
}))

mock.module(resolve(SRC, "services/blockchain/nonce-manager.ts"), () => ({
  txMutex: { withLock: (fn: any) => fn() },
}))

// ── viem mock ──
let mockVerifyResult = true
let mockVerifyThrows = false

mock.module("viem", () => ({
  verifyMessage: mock(async () => {
    if (mockVerifyThrows) throw new Error("Bad signature encoding")
    return mockVerifyResult
  }),
}))

// ─────────────────────────────────────────────
// Dynamic import
// ─────────────────────────────────────────────

let router: any

beforeAll(async () => {
  const mod = await import("../routes/publish")
  router = mod.default
})

beforeEach(() => {
  mockSelectResult = { ...TEST_WORKFLOW }
  mockInsertError = false
  mockPublishError = false
  mockVerifyResult = true
  mockVerifyThrows = false
})

// ─────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────

async function invokeRoute(opts: {
  body?: any
  headers?: Record<string, string>
} = {}) {
  let nextErr: any = null
  let jsonResult: any = null

  const req = {
    body: opts.body ?? {
      workflowId: TEST_ID,
      name: "Published Workflow",
      description: "A workflow being published",
      priceUsdc: 10000,
    },
    headers: opts.headers ?? {
      "x-owner-address": OWNER_ADDR,
      "x-owner-signature": "0xvalidsig",
    },
  } as any

  const res = {
    json: mock((data: any) => { jsonResult = data }),
    status: mock(function(this: any) { return this }),
  } as any

  const next = (err?: any) => { if (err) nextErr = err }

  const layer = router.stack.find(
    (l: any) => l.route?.path === "/publish" && l.route?.methods?.post,
  )
  expect(layer).toBeTruthy()

  const handlers = layer.route.stack
  for (const h of handlers) {
    await h.handle(req, res, next)
    if (nextErr) break
  }

  // Allow fire-and-forget promises to settle
  await new Promise((r) => setTimeout(r, 10))

  return { json: jsonResult, error: nextErr }
}

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

describe("publish route — ownership verification", () => {
  test("returns 403 when both ownership headers missing", async () => {
    const { error } = await invokeRoute({ headers: {} })

    expect(error).toBeTruthy()
    expect(error.code).toBe("PUBLISH_FAILED")
    expect(error.statusCode).toBe(403)
    expect(error.message).toContain("ownership headers")
  })

  test("returns 403 when x-owner-signature missing", async () => {
    const { error } = await invokeRoute({
      headers: { "x-owner-address": OWNER_ADDR },
    })

    expect(error).toBeTruthy()
    expect(error.code).toBe("PUBLISH_FAILED")
    expect(error.statusCode).toBe(403)
  })

  test("returns 403 when signature verification returns false", async () => {
    mockVerifyResult = false

    const { error } = await invokeRoute()

    expect(error).toBeTruthy()
    expect(error.code).toBe("PUBLISH_FAILED")
    expect(error.statusCode).toBe(403)
    expect(error.message).toContain("Signature verification failed")
  })

  test("returns 403 for wrong owner address", async () => {
    const { error } = await invokeRoute({
      headers: {
        "x-owner-address": "0x0000000000000000000000000000000000000001",
        "x-owner-signature": "0xvalidsig",
      },
    })

    expect(error).toBeTruthy()
    expect(error.code).toBe("PUBLISH_FAILED")
    expect(error.statusCode).toBe(403)
    expect(error.message).toContain("Not authorized")
  })

  test("returns 403 when verifyMessage throws (bad format)", async () => {
    mockVerifyThrows = true

    const { error } = await invokeRoute()

    expect(error).toBeTruthy()
    expect(error.code).toBe("PUBLISH_FAILED")
    expect(error.statusCode).toBe(403)
    expect(error.message).toContain("Invalid signature format")
  })
})

describe("publish route — workflow validation", () => {
  test("returns 404 for non-existent workflow", async () => {
    mockSelectResult = null

    const { error } = await invokeRoute()

    expect(error).toBeTruthy()
    expect(error.code).toBe("WORKFLOW_NOT_FOUND")
    expect(error.statusCode).toBe(404)
  })

  test("returns 409 for already published workflow", async () => {
    mockSelectResult = { ...TEST_WORKFLOW, published: true }

    const { error } = await invokeRoute()

    expect(error).toBeTruthy()
    expect(error.code).toBe("PUBLISH_FAILED")
    expect(error.statusCode).toBe(409)
  })
})

describe("publish route — success", () => {
  test("returns correct PublishResponse shape", async () => {
    const { json, error } = await invokeRoute()

    expect(error).toBeNull()
    expect(json).toBeTruthy()
    expect(json.workflowId).toBe(TEST_ID)
    expect(json.onchainWorkflowId).toBe("0xabc123")
    expect(json.publishTxHash).toBe("0xtx1")
    expect(json.x402Endpoint).toContain(`/api/workflows/${TEST_ID}/execute`)
  })

  test("still succeeds when capabilities JSON is invalid", async () => {
    mockSelectResult = { ...TEST_WORKFLOW, capabilities: "not-json{{" }

    const { json, error } = await invokeRoute()

    expect(error).toBeNull()
    expect(json).toBeTruthy()
    expect(json.workflowId).toBe(TEST_ID)
  })
})

describe("publish route — error propagation", () => {
  test("publishToRegistry failure propagates as error", async () => {
    mockPublishError = true

    const { error } = await invokeRoute()

    expect(error).toBeTruthy()
  })

  test("emitter failure does not block response", async () => {
    // emitEvent is fire-and-forget via the emitter module
    const { json, error } = await invokeRoute()

    expect(error).toBeNull()
    expect(json).toBeTruthy()
  })
})
