import { describe, test, expect, mock, beforeAll, beforeEach } from "bun:test"
import { resolve } from "path"

// ─────────────────────────────────────────────
// Mocks — external boundaries only
// ─────────────────────────────────────────────

const SRC = resolve(import.meta.dir, "..")

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
  executeLimiter: (_req: any, _res: any, next: any) => next(),
  generateLimiter: (_req: any, _res: any, next: any) => next(),
  simulateLimiter: (_req: any, _res: any, next: any) => next(),
  defaultLimiter: (_req: any, _res: any, next: any) => next(),
  discoverLimiter: (_req: any, _res: any, next: any) => next(),
  publishLimiter: (_req: any, _res: any, next: any) => next(),
  eventsSseLimiter: (_req: any, _res: any, next: any) => next(),
}))

// ── DB mock (sqlite for replay query) ──
let mockReplayRows: any[] = []
const mockPrepare = mock(() => ({
  all: mock((..._args: any[]) => mockReplayRows),
}))

mock.module(resolve(SRC, "db/index.ts"), () => ({
  db: {},
  sqlite: {
    prepare: mockPrepare,
  },
}))

// ── better-sse mock ──
let mockSessionCount = 0
const mockSessionPush = mock((..._args: any[]) => {})
const mockSession = {
  push: mockSessionPush,
  lastId: "",
}
const mockChannelRegister = mock(() => {})
const mockChannelDeregister = mock(() => {})
const mockChannel = {
  register: mockChannelRegister,
  deregister: mockChannelDeregister,
  get sessionCount() { return mockSessionCount },
}

// ── Emitter mock ──
mock.module(resolve(SRC, "services/events/emitter.ts"), () => ({
  emitEvent: mock(() => {}),
  getAgentChannel: mock(() => mockChannel),
  getConnectedClientCount: mock(() => mockSessionCount),
}))

// ── better-sse mock ──
mock.module("better-sse", () => ({
  createSession: mock(async () => mockSession),
  createChannel: mock(() => mockChannel),
}))

// ── Dynamic import ──
let eventsRouter: any

beforeAll(async () => {
  const mod = await import("../routes/events")
  eventsRouter = mod.default
})

beforeEach(() => {
  mockSessionCount = 0
  mockSession.lastId = ""
  mockSessionPush.mockClear()
  mockChannelRegister.mockClear()
  mockChannelDeregister.mockClear()
  mockReplayRows = []
})

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function getRouteHandler(path: string, method = "get") {
  const layer = eventsRouter.stack.find(
    (l: any) => l.route?.path === path,
  )
  if (!layer) throw new Error(`No ${path} route found`)
  const handlers = layer.route.stack.filter((s: any) => s.method === method)
  return handlers[handlers.length - 1].handle
}

function mockReq(headers: Record<string, string> = {}) {
  const listeners: Record<string, Function[]> = {}
  return {
    headers,
    on(event: string, fn: Function) {
      listeners[event] = listeners[event] || []
      listeners[event].push(fn)
    },
    _emit(event: string) {
      listeners[event]?.forEach((fn) => fn())
    },
  } as any
}

function mockRes() {
  const res: any = {}
  res.json = mock((data: any) => data)
  res.status = mock(function (this: any, code: number) {
    res._statusCode = code
    return this
  })
  res.writeHead = mock(() => res)
  res.write = mock(() => true)
  res.end = mock(() => {})
  return res
}

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

describe("GET /events — SSE endpoint", () => {
  test("returns 503 when client cap reached", async () => {
    mockSessionCount = 50 // MAX_SSE_CLIENTS

    const handler = getRouteHandler("/events")
    const req = mockReq()
    const res = mockRes()
    let nextErr: any = null
    const next = (err?: any) => { if (err) nextErr = err }

    await handler(req, res, next)

    expect(nextErr).toBeTruthy()
    expect(nextErr.code).toBe("SSE_CAPACITY_FULL")
    expect(nextErr.statusCode).toBe(503)
  })

  test("registers session and sends greeting when under cap", async () => {
    mockSessionCount = 5

    const handler = getRouteHandler("/events")
    const req = mockReq()
    const res = mockRes()
    const next = mock()

    await handler(req, res, next)

    expect(mockChannelRegister).toHaveBeenCalledTimes(1)
    // Greeting event
    const pushCalls = mockSessionPush.mock.calls
    const greetingCall = pushCalls.find((c: any[]) => c[1] === "system")
    expect(greetingCall).toBeTruthy()
    expect(greetingCall![0]).toHaveProperty("connectedAt")
  })

  test("replays missed events when Last-Event-ID is present", async () => {
    mockSessionCount = 0
    mockSession.lastId = "5"
    mockReplayRows = [
      { id: 6, type: "execution", data: '{"workflowId":"wf-1","timestamp":1000}' },
      { id: 7, type: "publish", data: '{"workflowId":"wf-2","timestamp":2000}' },
    ]

    const handler = getRouteHandler("/events")
    const req = mockReq()
    const res = mockRes()
    const next = mock()

    await handler(req, res, next)

    // Should replay 2 events + send greeting = 3 push calls
    expect(mockSessionPush.mock.calls.length).toBe(3)

    // First two are replayed events
    const [data1, type1, id1] = mockSessionPush.mock.calls[0]
    expect(type1).toBe("execution")
    expect(id1).toBe("6")
    expect(data1.workflowId).toBe("wf-1")

    const [data2, type2, id2] = mockSessionPush.mock.calls[1]
    expect(type2).toBe("publish")
    expect(id2).toBe("7")

    // Third is greeting
    expect(mockSessionPush.mock.calls[2][1]).toBe("system")
  })

  test("skips replay for non-numeric Last-Event-ID", async () => {
    mockSessionCount = 0
    mockSession.lastId = "not-a-number"

    const handler = getRouteHandler("/events")
    const req = mockReq()
    const res = mockRes()
    const next = mock()

    await handler(req, res, next)

    // Only greeting, no replay
    expect(mockSessionPush.mock.calls.length).toBe(1)
    expect(mockSessionPush.mock.calls[0][1]).toBe("system")
  })

  test("deregisters session on close", async () => {
    mockSessionCount = 0

    const handler = getRouteHandler("/events")
    const req = mockReq()
    const res = mockRes()
    const next = mock()

    await handler(req, res, next)

    // Simulate client disconnect
    req._emit("close")

    expect(mockChannelDeregister).toHaveBeenCalledTimes(1)
  })
})

describe("GET /events/health", () => {
  test("returns correct shape", () => {
    mockSessionCount = 3

    const handler = getRouteHandler("/events/health")
    const res = mockRes()

    handler({}, res)

    expect(res.json).toHaveBeenCalledTimes(1)
    const data = res.json.mock.calls[0][0]
    expect(data.status).toBe("ok")
    expect(data.connectedClients).toBe(3)
    expect(data.timestamp).toBeNumber()
  })
})
