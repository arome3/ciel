import { describe, test, expect, mock, beforeAll, beforeEach } from "bun:test"
import { resolve } from "path"

// ─────────────────────────────────────────────
// Mocks — external boundaries only
// ─────────────────────────────────────────────

const SRC = resolve(import.meta.dir, "..")

// ── Config mock ──
mock.module(resolve(SRC, "config.ts"), () => ({
  config: {
    CONSUMER_CONTRACT_ADDRESS: "0xTestConsumer",
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
const OWNER_ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
const TEST_WORKFLOW = {
  id: TEST_ID,
  published: true,
  deployStatus: "failed",
  ownerAddress: OWNER_ADDR,
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
    published: "published",
    deployStatus: "deploy_status",
    donWorkflowId: "don_workflow_id",
    ownerAddress: "owner_address",
    code: "code",
    config: "config",
    updatedAt: "updated_at",
  },
  executions: { id: "id" },
  events: { id: "id", type: "type", data: "data" },
}))

// ── Emitter mock ──
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
  parseDonWorkflowId: (output: string) => "don-123",
  _getDeployState: () => ({ activeCount: 0, queueLength: 0 }),
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
  const mod = await import("../routes/redeploy")
  router = mod.default
})

beforeEach(() => {
  mockSelectResult = { ...TEST_WORKFLOW }
  mockDeployError = false
  mockVerifyResult = true
  mockVerifyThrows = false
})

// ─────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────

async function invokeRoute(opts: {
  id?: string
  headers?: Record<string, string>
} = {}) {
  let nextErr: any = null
  let jsonResult: any = null

  const req = {
    params: { id: opts.id ?? TEST_ID },
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
    (l: any) => l.route?.path === "/workflows/:id/redeploy" && l.route?.methods?.post,
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

describe("redeploy route — input validation", () => {
  test("returns 400 for invalid UUID", async () => {
    const { error } = await invokeRoute({ id: "not-a-uuid" })

    expect(error).toBeTruthy()
    expect(error.code).toBe("INVALID_INPUT")
    expect(error.statusCode).toBe(400)
  })
})

describe("redeploy route — ownership verification", () => {
  test("returns 403 when ownership headers missing", async () => {
    const { error } = await invokeRoute({ headers: {} })

    expect(error).toBeTruthy()
    expect(error.code).toBe("PUBLISH_FAILED")
    expect(error.statusCode).toBe(403)
    expect(error.message).toContain("ownership headers")
  })

  test("returns 403 when signature verification fails", async () => {
    mockVerifyResult = false

    const { error } = await invokeRoute()

    expect(error).toBeTruthy()
    expect(error.code).toBe("PUBLISH_FAILED")
    expect(error.statusCode).toBe(403)
    expect(error.message).toContain("Signature verification failed")
  })

  test("returns 403 when called by non-owner", async () => {
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

  test("returns 403 when verifyMessage throws", async () => {
    mockVerifyThrows = true

    const { error } = await invokeRoute()

    expect(error).toBeTruthy()
    expect(error.code).toBe("PUBLISH_FAILED")
    expect(error.statusCode).toBe(403)
    expect(error.message).toContain("Invalid signature format")
  })
})

describe("redeploy route — workflow validation", () => {
  test("returns 404 for non-existent workflow", async () => {
    mockSelectResult = null

    const { error } = await invokeRoute()

    expect(error).toBeTruthy()
    expect(error.code).toBe("WORKFLOW_NOT_FOUND")
    expect(error.statusCode).toBe(404)
  })

  test("returns 400 for unpublished workflow", async () => {
    mockSelectResult = { ...TEST_WORKFLOW, published: false }

    const { error } = await invokeRoute()

    expect(error).toBeTruthy()
    expect(error.code).toBe("WORKFLOW_NOT_PUBLISHED")
    expect(error.statusCode).toBe(400)
  })

  test("returns 409 for deployed workflow", async () => {
    mockSelectResult = { ...TEST_WORKFLOW, deployStatus: "deployed" }

    const { error } = await invokeRoute()

    expect(error).toBeTruthy()
    expect(error.code).toBe("DEPLOY_CONFLICT")
    expect(error.statusCode).toBe(409)
  })

  test("returns 409 for pending workflow", async () => {
    mockSelectResult = { ...TEST_WORKFLOW, deployStatus: "pending" }

    const { error } = await invokeRoute()

    expect(error).toBeTruthy()
    expect(error.code).toBe("DEPLOY_CONFLICT")
    expect(error.statusCode).toBe(409)
  })
})

describe("redeploy route — success", () => {
  test("returns pending status for failed workflow", async () => {
    mockSelectResult = { ...TEST_WORKFLOW, deployStatus: "failed" }

    const { json, error } = await invokeRoute()

    expect(error).toBeNull()
    expect(json).toBeTruthy()
    expect(json.workflowId).toBe(TEST_ID)
    expect(json.deployStatus).toBe("pending")
    expect(json.message).toBe("Redeploy initiated")
  })

  test("returns pending status for none workflow", async () => {
    mockSelectResult = { ...TEST_WORKFLOW, deployStatus: "none" }

    const { json, error } = await invokeRoute()

    expect(error).toBeNull()
    expect(json).toBeTruthy()
    expect(json.deployStatus).toBe("pending")
  })

  test("deploy failure does not crash response", async () => {
    mockSelectResult = { ...TEST_WORKFLOW, deployStatus: "failed" }
    mockDeployError = true

    const { json, error } = await invokeRoute()

    expect(error).toBeNull()
    expect(json).toBeTruthy()
    expect(json.deployStatus).toBe("pending")
  })
})
