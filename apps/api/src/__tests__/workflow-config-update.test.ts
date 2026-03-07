import { describe, test, expect, mock, beforeAll, beforeEach } from "bun:test"
import { resolve } from "path"

// ─────────────────────────────────────────────
// Mocks — external boundaries only
// ─────────────────────────────────────────────

const SRC = resolve(import.meta.dir, "..")

// ── viem mock (controls signature verification) ──
let mockVerifyResult = true

mock.module("viem", () => ({
  verifyMessage: () => Promise.resolve(mockVerifyResult),
}))

// ── Config mock ──
mock.module(resolve(SRC, "config.ts"), () => ({
  config: {
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

// ── Rate limiter mock ──
mock.module(resolve(SRC, "middleware/rate-limiter.ts"), () => ({
  defaultLimiter: (_req: any, _res: any, next: any) => next(),
  executeLimiter: (_req: any, _res: any, next: any) => next(),
  generateLimiter: (_req: any, _res: any, next: any) => next(),
  simulateLimiter: (_req: any, _res: any, next: any) => next(),
  discoverLimiter: (_req: any, _res: any, next: any) => next(),
  publishLimiter: (_req: any, _res: any, next: any) => next(),
  eventsSseLimiter: (_req: any, _res: any, next: any) => next(),
}))

// ── DB mock ──
const TEST_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"
const OWNER_ADDRESS = "0xOwner1234567890abcdef1234567890abcdef1234"

let mockSelectResult: any = {
  ownerAddress: OWNER_ADDRESS,
}
let updateSetArgs: any = null

const mockUpdateWhere = mock(() => Promise.resolve())
const mockUpdateSet = mock((args: any) => {
  updateSetArgs = args
  return { where: mockUpdateWhere }
})
const mockUpdate = mock(() => ({ set: mockUpdateSet }))

const mockSelectGet = mock(() => Promise.resolve(mockSelectResult))
const mockSelectWhere = mock(() => ({ get: mockSelectGet }))
const mockSelectFrom = mock(() => ({ where: mockSelectWhere }))
const mockSelect = mock(() => ({ from: mockSelectFrom }))

const mockDb = {
  select: mockSelect,
  insert: mock(() => ({ values: mock(() => Promise.resolve()) })),
  update: mockUpdate,
}

mock.module(resolve(SRC, "db/index.ts"), () => ({
  db: mockDb,
  sqlite: {},
}))

mock.module(resolve(SRC, "db/schema.ts"), () => ({
  workflows: {
    id: "id",
    ownerAddress: "owner_address",
    config: "config",
    updatedAt: "updated_at",
  },
}))

// ── Emitter mock ──
mock.module(resolve(SRC, "services/events/emitter.ts"), () => ({
  emitEvent: mock(() => {}),
  getAgentChannel: mock(() => ({})),
  getConnectedClientCount: mock(() => 0),
}))

// ─────────────────────────────────────────────
// Dynamic import
// ─────────────────────────────────────────────

let router: any

beforeAll(async () => {
  const mod = await import("../routes/workflows")
  router = mod.default
})

beforeEach(() => {
  mockSelectResult = { ownerAddress: OWNER_ADDRESS }
  mockVerifyResult = true
  updateSetArgs = null
})

// ─────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────

async function invokePatch(opts: {
  id?: string
  body?: any
  address?: string
  signature?: string
} = {}) {
  let nextErr: any = null
  let jsonResult: any = null

  const headers: Record<string, string> = {}
  const addr = "address" in opts ? opts.address : OWNER_ADDRESS
  const sig = "signature" in opts ? opts.signature : "0xvalidsig"
  if (addr) headers["x-owner-address"] = addr
  if (sig) headers["x-owner-signature"] = sig

  const req = {
    params: { id: opts.id ?? TEST_ID },
    body: opts.body ?? { config: { recipientAddress: "0xNew" } },
    headers,
  } as any

  const res = {
    json: mock((data: any) => { jsonResult = data }),
    status: mock(function(this: any) { return this }),
  } as any

  const next = (err?: any) => { if (err) nextErr = err }

  const layer = router.stack.find(
    (l: any) => l.route?.path === "/workflows/:id/config" && l.route?.methods?.patch,
  )
  expect(layer).toBeTruthy()

  const handlers = layer.route.stack
  for (const h of handlers) {
    await h.handle(req, res, next)
    if (nextErr) break
  }

  return { json: jsonResult, error: nextErr }
}

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

describe("PATCH /workflows/:id/config", () => {
  test("owner can update config — returns updated config", async () => {
    const newConfig = { recipientAddress: "0xNew", threshold: 100 }
    const { json, error } = await invokePatch({ body: { config: newConfig } })

    expect(error).toBeNull()
    expect(json).toEqual({ config: newConfig })
    expect(updateSetArgs).toBeTruthy()
    expect(updateSetArgs.config).toBe(JSON.stringify(newConfig))
  })

  test("non-owner gets 403 UNAUTHORIZED", async () => {
    const { error } = await invokePatch({
      address: "0xNotTheOwner000000000000000000000000000000",
    })

    expect(error).toBeTruthy()
    expect(error.code).toBe("UNAUTHORIZED")
    expect(error.statusCode).toBe(403)
  })

  test("invalid signature gets 403", async () => {
    mockVerifyResult = false

    const { error } = await invokePatch()

    expect(error).toBeTruthy()
    expect(error.code).toBe("UNAUTHORIZED")
    expect(error.statusCode).toBe(403)
  })

  test("missing auth headers gets 403", async () => {
    const { error } = await invokePatch({
      address: undefined,
      signature: undefined,
    })

    expect(error).toBeTruthy()
    expect(error.code).toBe("UNAUTHORIZED")
    expect(error.statusCode).toBe(403)
  })

  test("missing/invalid config body gets 400", async () => {
    const { error: err1 } = await invokePatch({ body: {} })
    expect(err1).toBeTruthy()
    expect(err1.code).toBe("INVALID_INPUT")
    expect(err1.statusCode).toBe(400)

    const { error: err2 } = await invokePatch({ body: { config: null } })
    expect(err2).toBeTruthy()
    expect(err2.code).toBe("INVALID_INPUT")

    const { error: err3 } = await invokePatch({ body: { config: [1, 2] } })
    expect(err3).toBeTruthy()
    expect(err3.code).toBe("INVALID_INPUT")
  })

  test("non-existent workflow gets 404", async () => {
    mockSelectResult = null

    const { error } = await invokePatch()

    expect(error).toBeTruthy()
    expect(error.code).toBe("WORKFLOW_NOT_FOUND")
    expect(error.statusCode).toBe(404)
  })

  test("updated config persists via db.update", async () => {
    const newConfig = { amount: 500 }
    await invokePatch({ body: { config: newConfig } })

    expect(mockUpdate).toHaveBeenCalled()
    expect(mockUpdateSet).toHaveBeenCalled()
    expect(updateSetArgs.config).toBe(JSON.stringify(newConfig))
    expect(updateSetArgs.updatedAt).toBeString()
  })
})
