import { describe, test, expect, mock, beforeAll, beforeEach } from "bun:test"
import { resolve } from "path"

// ─────────────────────────────────────────────
// Mocks — DB, config, compiler, dep-cache, rate-limiter at absolute paths
// ─────────────────────────────────────────────

const SRC = resolve(import.meta.dir, "..")

// ── Config mock ──
mock.module(resolve(SRC, "config.ts"), () => ({
  config: {
    DATABASE_PATH: ":memory:",
    CRE_CLI_PATH: "echo",
    OPENAI_API_KEY: "sk-test",
    ANTHROPIC_API_KEY: "sk-ant-test",
    GEMINI_API_KEY: "test",
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
const TEST_WORKFLOW_ID = "00000000-0000-0000-0000-000000000001"
const TEST_WORKFLOW = {
  id: TEST_WORKFLOW_ID,
  code: "// test workflow code",
  config: '{"apiUrl":"https://api.test.com"}',
}

let mockSelectResult: any[] = [TEST_WORKFLOW]
let mockUpdateCalled = false
let mockUpdateError = false

const mockWhere = mock(() => {
  // For select: return limit chain
  // For update: just resolve
  return { limit: mock(() => Promise.resolve(mockSelectResult)) }
})
const mockSet = mock(() => ({ where: mock(() => {
  mockUpdateCalled = true
  if (mockUpdateError) return Promise.reject(new Error("DB write error"))
  return Promise.resolve()
}) }))
const mockFrom = mock(() => ({ where: mockWhere }))
const mockSelect = mock(() => ({ from: mockFrom }))
const mockUpdate = mock(() => ({ set: mockSet }))
const mockDb = { select: mockSelect, update: mockUpdate }

mock.module(resolve(SRC, "db/index.ts"), () => ({
  db: mockDb,
  sqlite: {},
}))

mock.module(resolve(SRC, "db/schema.ts"), () => ({
  workflows: {
    id: "id",
    code: "code",
    config: "config",
    totalExecutions: "total_executions",
    successfulExecutions: "successful_executions",
  },
  executions: { id: "id" },
}))

// ── Compiler mock ──
let mockSimulateResult = {
  success: true,
  executionTrace: [
    { step: 1, action: "Cron fired", capability: "trigger", status: "success" as const },
  ],
  duration: 1234,
  errors: [],
  warnings: [],
  rawOutput: "[TRIGGER] Cron fired",
}

mock.module(resolve(SRC, "services/cre/compiler.ts"), () => ({
  simulateWorkflow: mock(() => Promise.resolve(mockSimulateResult)),
  checkCRECli: mock(() => Promise.resolve(true)),
  _getSimState: mock(() => ({ activeSimCount: 0, queueLength: 0 })),
}))

// ── Rate limiter mock (bypass for tests) ──
mock.module(resolve(SRC, "middleware/rate-limiter.ts"), () => ({
  simulateLimiter: (_req: any, _res: any, next: any) => next(),
  generateLimiter: (_req: any, _res: any, next: any) => next(),
  executeLimiter: (_req: any, _res: any, next: any) => next(),
  defaultLimiter: (_req: any, _res: any, next: any) => next(),
}))

// ── LRU Cache mock (pass-through, no actual caching in tests) ──
mock.module(resolve(SRC, "lib/lru-cache.ts"), () => ({
  LRUCache: class {
    get() { return undefined }
    set() {}
    clear() {}
  },
}))

// ── Dynamic imports ──
let router: any

beforeAll(async () => {
  const mod = await import("../routes/simulate")
  router = mod.default
})

beforeEach(() => {
  mockSelectResult = [TEST_WORKFLOW]
  mockUpdateCalled = false
  mockUpdateError = false
  mockSimulateResult = {
    success: true,
    executionTrace: [
      { step: 1, action: "Cron fired", capability: "trigger", status: "success" as const },
    ],
    duration: 1234,
    errors: [],
    warnings: [],
    rawOutput: "[TRIGGER] Cron fired",
  }
})

// ─────────────────────────────────────────────
// Helper: invoke route handler
// ─────────────────────────────────────────────

function makeReqRes(body: any): { req: any; res: any; nextErr: any } {
  let nextErr: any = null
  let jsonResult: any = null

  const req = { body }
  const res = {
    json: mock((data: any) => { jsonResult = data }),
    status: mock(function(this: any) { return this }),
  }
  // Only record errors — middleware calling next() without args means "continue"
  const next = (err?: any) => { if (err) nextErr = err }

  return { req, res: { ...res, _getJson: () => jsonResult }, nextErr: { get: () => nextErr, next } }
}

async function invokeRoute(body: any) {
  const { req, res, nextErr } = makeReqRes(body)

  // Find the POST /simulate handler
  const layer = router.stack.find(
    (l: any) => l.route?.path === "/simulate" && l.route?.methods?.post,
  )
  expect(layer).toBeTruthy()

  // The route has middleware (rate limiter) + handler
  // In our mock, rate limiter calls next(), so we invoke the last handler
  const handlers = layer.route.stack
  for (const h of handlers) {
    await h.handle(req, res, nextErr.next)
    if (nextErr.get()) break
  }

  return { json: res._getJson(), error: nextErr.get() }
}

// ─────────────────────────────────────────────
// Stored Mode
// ─────────────────────────────────────────────

describe("simulate route — stored mode", () => {
  test("fetches workflow from DB and returns SimulateResponse", async () => {
    const { json, error } = await invokeRoute({
      mode: "stored",
      workflowId: TEST_WORKFLOW_ID,
    })

    expect(error).toBeNull()
    expect(json).toBeTruthy()
    expect(json.workflowId).toBe(TEST_WORKFLOW_ID)
    expect(json.success).toBe(true)
    expect(json.trace).toBeArray()
    expect(json.duration).toBe(1234)
  })

  test("returns WORKFLOW_NOT_FOUND for missing workflow", async () => {
    mockSelectResult = []

    const { error } = await invokeRoute({
      mode: "stored",
      workflowId: TEST_WORKFLOW_ID,
    })

    expect(error).toBeTruthy()
    expect(error.code).toBe("WORKFLOW_NOT_FOUND")
    expect(error.statusCode).toBe(404)
  })

  test("returns INVALID_INPUT for corrupt config JSON", async () => {
    mockSelectResult = [{ ...TEST_WORKFLOW, config: "not-valid-json{{{" }]

    const { error } = await invokeRoute({
      mode: "stored",
      workflowId: TEST_WORKFLOW_ID,
    })

    expect(error).toBeTruthy()
    expect(error.code).toBe("INVALID_INPUT")
    expect(error.statusCode).toBe(400)
    expect(error.message).toContain("corrupt config JSON")
  })

  test("merges config overrides with stored config", async () => {
    const { json, error } = await invokeRoute({
      mode: "stored",
      workflowId: TEST_WORKFLOW_ID,
      config: { extra: "override" },
    })

    expect(error).toBeNull()
    expect(json).toBeTruthy()
    expect(json.success).toBe(true)
  })
})

// ─────────────────────────────────────────────
// Direct Mode
// ─────────────────────────────────────────────

describe("simulate route — direct mode", () => {
  test("accepts code + config and returns SimulateResponse", async () => {
    const { json, error } = await invokeRoute({
      mode: "direct",
      code: "// direct mode code",
      config: { test: true },
    })

    expect(error).toBeNull()
    expect(json).toBeTruthy()
    expect(json.workflowId).toStartWith("direct-")
    expect(json.success).toBe(true)
  })

  test("workflowId starts with 'direct-'", async () => {
    const { json } = await invokeRoute({
      mode: "direct",
      code: "// test",
      config: {},
    })

    expect(json.workflowId).toMatch(/^direct-[a-f0-9]{8}$/)
  })

  test("rejects code exceeding 50KB with validation error", async () => {
    const { error } = await invokeRoute({
      mode: "direct",
      code: "x".repeat(50_001),
      config: {},
    })

    // Zod validation error gets passed to next()
    expect(error).toBeTruthy()
  })
})

// ─────────────────────────────────────────────
// DB Persistence
// ─────────────────────────────────────────────

describe("simulate route — DB persistence", () => {
  test("updates workflow row after successful simulation", async () => {
    const { json, error } = await invokeRoute({
      mode: "stored",
      workflowId: TEST_WORKFLOW_ID,
    })

    expect(error).toBeNull()
    expect(json.success).toBe(true)
    // DB update was called (mockSet was invoked)
    expect(mockSet).toHaveBeenCalled()
  })

  test("DB error does not crash response", async () => {
    mockUpdateError = true

    const { json, error } = await invokeRoute({
      mode: "stored",
      workflowId: TEST_WORKFLOW_ID,
    })

    // Response should still succeed even though DB update failed
    expect(error).toBeNull()
    expect(json).toBeTruthy()
    expect(json.success).toBe(true)
  })
})
