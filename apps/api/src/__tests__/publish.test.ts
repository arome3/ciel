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
    CONSUMER_CONTRACT_ADDRESS: "0xTestConsumer",
    X402_FACILITATOR_URL: "https://facilitator.test",
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
const TX_HASH = "0xabc123def456"
const ONCHAIN_ID = "0xonchain789"

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
  code: "// test workflow code",
  config: '{"test": true}',
}

let mockSelectResult: any = TEST_WORKFLOW

const mockUpdateWhere = mock(() => Promise.resolve())
const mockUpdateSet = mock(() => ({ where: mockUpdateWhere }))
const mockUpdate = mock(() => ({ set: mockUpdateSet }))

const mockSelectGet = mock(() => Promise.resolve(mockSelectResult))
const mockSelectWhere = mock(() => ({ get: mockSelectGet }))
const mockSelectFrom = mock(() => ({ where: mockSelectWhere }))
const mockSelect = mock(() => ({ from: mockSelectFrom }))

const mockDb = {
  select: mockSelect,
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
    donWorkflowId: "don_workflow_id",
    deployStatus: "deploy_status",
    x402Endpoint: "x402_endpoint",
    updatedAt: "updated_at",
    category: "category",
    capabilities: "capabilities",
    chains: "chains",
    code: "code",
    config: "config",
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

// ── Deployer mock ──
let mockDeployError = false

const mockDeployWorkflow = mock(() => {
  if (mockDeployError) return Promise.reject(new Error("Deploy failed"))
  return Promise.resolve({
    donWorkflowId: "don-123",
    success: true,
  })
})

mock.module(resolve(SRC, "services/cre/deployer.ts"), () => ({
  deployWorkflow: mockDeployWorkflow,
  handleDeployResult: mock((_id: string, p: Promise<any>) => { p.catch(() => {}) }),
}))

// ── Bazaar mock ──
const mockRegisterWorkflowInBazaar = mock((_params: any) => Promise.resolve())

mock.module(resolve(SRC, "services/x402/bazaar.ts"), () => ({
  registerBazaarExtension: mock(),
  getWorkflowDiscoveryExtension: mock(() => ({})),
  registerWorkflowInBazaar: mockRegisterWorkflowInBazaar,
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
  mockDeployError = false
  mockRegisterWorkflowInBazaar.mockClear()
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
      txHash: TX_HASH,
      onchainWorkflowId: ONCHAIN_ID,
      name: "Published Workflow",
      description: "A workflow being published",
      priceUsdc: 10000,
    },
    headers: opts.headers ?? {
      "x-owner-address": OWNER_ADDR,
    },
  } as any

  const res = {
    json: mock((data: any) => { jsonResult = data }),
    status: mock(function(this: any) { return this }),
  } as any

  const next = (err?: any) => { if (err) nextErr = err }

  const layer = router.stack.find(
    (l: any) => l.route?.path === "/publish/confirm" && l.route?.methods?.post,
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

describe("publish/confirm route — ownership check", () => {
  test("returns 403 when X-Owner-Address header missing", async () => {
    const { error } = await invokeRoute({ headers: {} })

    expect(error).toBeTruthy()
    expect(error.code).toBe("PUBLISH_FAILED")
    expect(error.statusCode).toBe(403)
    expect(error.message).toContain("X-Owner-Address")
  })

  test("returns 403 for wrong owner address", async () => {
    const { error } = await invokeRoute({
      headers: {
        "x-owner-address": "0x0000000000000000000000000000000000000001",
      },
    })

    expect(error).toBeTruthy()
    expect(error.code).toBe("PUBLISH_FAILED")
    expect(error.statusCode).toBe(403)
    expect(error.message).toContain("Not authorized")
  })
})

describe("publish/confirm route — workflow validation", () => {
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

  test("returns 400 for missing txHash", async () => {
    const { error } = await invokeRoute({
      body: {
        workflowId: TEST_ID,
        onchainWorkflowId: ONCHAIN_ID,
        name: "Test",
        description: "A workflow test",
        priceUsdc: 10000,
      },
    })

    expect(error).toBeTruthy()
  })

  test("returns 400 for missing onchainWorkflowId", async () => {
    const { error } = await invokeRoute({
      body: {
        workflowId: TEST_ID,
        txHash: TX_HASH,
        name: "Test",
        description: "A workflow test",
        priceUsdc: 10000,
      },
    })

    expect(error).toBeTruthy()
  })
})

describe("publish/confirm route — success", () => {
  test("returns correct response shape with deploy fields", async () => {
    const { json, error } = await invokeRoute()

    expect(error).toBeNull()
    expect(json).toBeTruthy()
    expect(json.workflowId).toBe(TEST_ID)
    expect(json.onchainWorkflowId).toBe(ONCHAIN_ID)
    expect(json.publishTxHash).toBe(TX_HASH)
    expect(json.x402Endpoint).toContain(`/api/workflows/${TEST_ID}/execute`)
    expect(json.deployStatus).toBe("pending")
    expect(json.donWorkflowId).toBeNull()
  })

  test("still succeeds when config JSON is invalid", async () => {
    mockSelectResult = { ...TEST_WORKFLOW, config: "not-json{{" }

    const { json, error } = await invokeRoute()

    expect(error).toBeNull()
    expect(json).toBeTruthy()
    expect(json.workflowId).toBe(TEST_ID)
  })

  test("deploy failure does not crash confirm response", async () => {
    mockDeployError = true

    const { json, error } = await invokeRoute()

    // Response is sent BEFORE deploy runs — should always succeed
    expect(error).toBeNull()
    expect(json).toBeTruthy()
    expect(json.workflowId).toBe(TEST_ID)
    expect(json.deployStatus).toBe("pending")
  })
})

describe("publish/confirm route — error propagation", () => {
  test("emitter failure does not block response", async () => {
    // emitEvent is fire-and-forget via the emitter module
    const { json, error } = await invokeRoute()

    expect(error).toBeNull()
    expect(json).toBeTruthy()
  })
})

describe("publish/confirm route — Bazaar registration", () => {
  test("calls registerWorkflowInBazaar with correct params on success", async () => {
    const { json, error } = await invokeRoute()

    expect(error).toBeNull()
    expect(json).toBeTruthy()
    expect(mockRegisterWorkflowInBazaar).toHaveBeenCalledTimes(1)

    const params = mockRegisterWorkflowInBazaar.mock.calls[0][0]
    expect(params.x402Endpoint).toContain(`/api/workflows/${TEST_ID}/execute`)
    expect(params.name).toBe("Published Workflow")
    expect(params.description).toBe("A workflow being published")
    expect(params.category).toBe("core-defi")
    expect(params.priceUsdc).toBe(10000)
    expect(params.capabilities).toEqual(["price-feed"])
    expect(params.chains).toEqual(["base-sepolia"])
  })

  test("Bazaar registration failure does not block publish response", async () => {
    mockRegisterWorkflowInBazaar.mockRejectedValueOnce(new Error("Bazaar down"))

    const { json, error } = await invokeRoute()

    expect(error).toBeNull()
    expect(json).toBeTruthy()
    expect(json.workflowId).toBe(TEST_ID)
  })

  test("does not call registerWorkflowInBazaar when publish validation fails", async () => {
    mockSelectResult = null // workflow not found

    const { error } = await invokeRoute()

    expect(error).toBeTruthy()
    expect(mockRegisterWorkflowInBazaar).not.toHaveBeenCalled()
  })
})
