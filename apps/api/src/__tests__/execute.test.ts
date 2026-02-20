import { describe, test, expect, mock, beforeAll, beforeEach } from "bun:test"
import { resolve } from "path"

// ─────────────────────────────────────────────
// Mocks — external boundaries only
// ─────────────────────────────────────────────

const SRC = resolve(import.meta.dir, "..")

// ── Config mock ──
mock.module(resolve(SRC, "config.ts"), () => ({
  config: {
    WALLET_ADDRESS: "0xTestWallet",
    X402_FACILITATOR_URL: "https://facilitator.test",
    NODE_ENV: "test",
    DATABASE_PATH: ":memory:",
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
const TEST_WORKFLOW = {
  id: TEST_ID,
  name: "Test Workflow",
  published: true,
  priceUsdc: 10000,
  templateId: 1,
  onchainWorkflowId: "0xabc123",
}

let mockSelectResult: any = TEST_WORKFLOW
let mockInsertError = false
let mockUpdateError = false
let insertCalled = false
let updateCalled = false
let insertValues: any = null

const mockInsertValues = mock((vals: any) => {
  insertCalled = true
  insertValues = vals
  if (mockInsertError) return Promise.reject(new Error("DB insert error"))
  return Promise.resolve()
})
const mockInsert = mock(() => ({ values: mockInsertValues }))

const mockUpdateWhere = mock(() => {
  updateCalled = true
  if (mockUpdateError) return Promise.reject(new Error("DB update error"))
  return Promise.resolve()
})
const mockUpdateSet = mock(() => ({ where: mockUpdateWhere }))
const mockUpdate = mock(() => ({ set: mockUpdateSet }))

const mockSelectGet = mock(() => {
  return Promise.resolve(mockSelectResult)
})
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
    published: "published",
    priceUsdc: "price_usdc",
    templateId: "template_id",
    onchainWorkflowId: "onchain_workflow_id",
    totalExecutions: "total_executions",
    successfulExecutions: "successful_executions",
  },
  executions: { id: "id" },
  events: { id: "id", type: "type", data: "data" },
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

// ── Emitter mock (prevents better-sse import) ──
mock.module(resolve(SRC, "services/events/emitter.ts"), () => ({
  emitEvent: mock(() => {}),
  getAgentChannel: mock(() => ({})),
  getConnectedClientCount: mock(() => 0),
}))

// ── Owner-verify mock ──
mock.module(resolve(SRC, "middleware/owner-verify.ts"), () => ({
  ownerVerify: (req: any, _res: any, next: any) => next(),
}))

// ── x402 middleware mock ──
mock.module(resolve(SRC, "services/x402/middleware.ts"), () => ({
  conditionalPayment: (req: any, _res: any, next: any) => next(),
}))

// ── Registry mock ──
let recordExecutionCalled = false
let recordExecutionArgs: any[] = []

const mockRecordExecution = mock((...args: any[]) => {
  recordExecutionCalled = true
  recordExecutionArgs = args
  return Promise.resolve()
})

mock.module(resolve(SRC, "services/blockchain/registry.ts"), () => ({
  recordExecution: mockRecordExecution,
  publishToRegistry: mock(() => Promise.resolve({ workflowId: "0x0", txHash: "0x0" })),
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
}))

mock.module(resolve(SRC, "services/blockchain/nonce-manager.ts"), () => ({
  txMutex: { withLock: (fn: any) => fn() },
}))

// ─────────────────────────────────────────────
// Dynamic import
// ─────────────────────────────────────────────

let router: any

beforeAll(async () => {
  const mod = await import("../routes/execute")
  router = mod.default
})

beforeEach(() => {
  mockSelectResult = { ...TEST_WORKFLOW }
  mockInsertError = false
  mockUpdateError = false
  insertCalled = false
  updateCalled = false
  insertValues = null
  recordExecutionCalled = false
  recordExecutionArgs = []
})

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

async function invokeRoute(opts: {
  id?: string
  skipPayment?: boolean
  ownerAddress?: string
} = {}) {
  let nextErr: any = null
  let jsonResult: any = null

  const req = {
    params: { id: opts.id ?? TEST_ID },
    skipPayment: opts.skipPayment,
    ownerAddress: opts.ownerAddress,
  } as any

  const res = {
    json: mock((data: any) => { jsonResult = data }),
    status: mock(function(this: any) { return this }),
  } as any

  const next = (err?: any) => { if (err) nextErr = err }

  const layer = router.stack.find(
    (l: any) => l.route?.path === "/workflows/:id/execute" && l.route?.methods?.get,
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

describe("execute route — UUID validation", () => {
  test("returns 400 for non-UUID workflow ID", async () => {
    const { error } = await invokeRoute({ id: "not-a-uuid" })

    expect(error).toBeTruthy()
    expect(error.code).toBe("INVALID_INPUT")
    expect(error.statusCode).toBe(400)
  })

  test("returns 400 for path traversal attempt", async () => {
    const { error } = await invokeRoute({ id: "../../etc/passwd" })

    expect(error).toBeTruthy()
    expect(error.code).toBe("INVALID_INPUT")
    expect(error.statusCode).toBe(400)
  })

  test("accepts valid UUID v4", async () => {
    const { error } = await invokeRoute({ id: TEST_ID })

    // Should not be INVALID_INPUT — may be 404 or success
    if (error) {
      expect(error.code).not.toBe("INVALID_INPUT")
    }
  })
})

describe("execute route — workflow validation", () => {
  test("returns 404 for non-existent workflow", async () => {
    mockSelectResult = null

    const { error } = await invokeRoute()

    expect(error).toBeTruthy()
    expect(error.code).toBe("WORKFLOW_NOT_FOUND")
    expect(error.statusCode).toBe(404)
  })

  test("returns 404 for unpublished workflow", async () => {
    mockSelectResult = { ...TEST_WORKFLOW, published: false }

    const { error } = await invokeRoute()

    expect(error).toBeTruthy()
    expect(error.code).toBe("WORKFLOW_NOT_FOUND")
    expect(error.statusCode).toBe(404)
  })
})

describe("execute route — success response", () => {
  test("returns correct response shape", async () => {
    const { json, error } = await invokeRoute()

    expect(error).toBeNull()
    expect(json).toBeTruthy()
    expect(json.executionId).toBeString()
    expect(json.workflowId).toBe(TEST_ID)
    expect(json.success).toBe(true)
    expect(json.result).toHaveProperty("output")
    expect(json.result).toHaveProperty("templateId")
    expect(json.duration).toBeNumber()
    expect(json.payment).toBeTruthy()
  })

  test("includes templateId in result", async () => {
    const { json } = await invokeRoute()

    expect(json.result.templateId).toBe(1)
  })
})

describe("execute route — payment flags", () => {
  test("amountUsdc is null when owner-bypassed", async () => {
    const { json } = await invokeRoute({ skipPayment: true })

    expect(json.payment.paid).toBe(false)
    expect(json.payment.amountUsdc).toBeNull()
    expect(json.payment.ownerBypassed).toBe(true)
  })

  test("amountUsdc is workflow.priceUsdc when paid", async () => {
    const { json } = await invokeRoute({ skipPayment: false })

    expect(json.payment.paid).toBe(true)
    expect(json.payment.amountUsdc).toBe(10000)
    expect(json.payment.ownerBypassed).toBe(false)
  })
})

describe("execute route — paid vs bypassed insert strategy", () => {
  test("paid: insert is awaited before response (record exists for settlement)", async () => {
    // For paid requests, insert happens BEFORE res.json()
    // We verify by checking that insert was called with correct values
    const { json, error } = await invokeRoute({ skipPayment: false })

    expect(error).toBeNull()
    expect(insertCalled).toBe(true)
    expect(insertValues.amountUsdc).toBe(10000)
  })

  test("paid: DB insert failure propagates as error", async () => {
    mockInsertError = true

    const { error } = await invokeRoute({ skipPayment: false })

    // For paid requests, insert failure should be caught by handler's try/catch
    expect(error).toBeTruthy()
  })

  test("bypassed: DB insert failure does NOT crash handler", async () => {
    mockInsertError = true

    const { json, error } = await invokeRoute({ skipPayment: true })

    // For bypassed requests, insert is fire-and-forget
    expect(error).toBeNull()
    expect(json).toBeTruthy()
    expect(json.success).toBe(true)
  })

  test("insert has null paymentTxHash (x402 settles after response)", async () => {
    await invokeRoute()

    expect(insertValues.paymentTxHash).toBeNull()
  })
})

describe("execute route — fire-and-forget stats update", () => {
  test("updates workflow stats", async () => {
    await invokeRoute()

    expect(updateCalled).toBe(true)
  })

  test("DB update error does not crash handler", async () => {
    mockUpdateError = true

    const { json, error } = await invokeRoute()

    expect(error).toBeNull()
    expect(json).toBeTruthy()
  })
})

describe("execute route — on-chain recording", () => {
  test("calls recordExecution with workflow onchainWorkflowId", async () => {
    await invokeRoute()

    expect(recordExecutionCalled).toBe(true)
    expect(recordExecutionArgs[0]).toBe("0xabc123")
    expect(recordExecutionArgs[1]).toBe(true)
  })

  test("skips on-chain recording when no onchainWorkflowId", async () => {
    mockSelectResult = { ...TEST_WORKFLOW, onchainWorkflowId: null }

    await invokeRoute()

    expect(recordExecutionCalled).toBe(false)
  })
})
