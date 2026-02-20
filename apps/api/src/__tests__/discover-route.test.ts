import { describe, test, expect, mock, beforeAll } from "bun:test"
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
}))

// ── Discovery client mock ──
const mockDiscoverWorkflows = mock(() =>
  Promise.resolve([
    {
      workflowId: "uuid-1",
      name: "Test Workflow",
      description: "A test",
      category: "core-defi",
      chains: ["base-sepolia"],
      capabilities: ["price-feed"],
      priceUsdc: 10000,
      x402Endpoint: "http://localhost:3001/api/workflows/uuid-1/execute",
      totalExecutions: 5,
      successfulExecutions: 4,
      source: "registry",
    },
  ]),
)

mock.module(resolve(SRC, "services/discovery/client.ts"), () => ({
  discoverWorkflows: mockDiscoverWorkflows,
}))

// ── Dynamic import ──
let discoverRouter: any

beforeAll(async () => {
  const mod = await import("../routes/discover")
  discoverRouter = mod.default
})

// ── Express-like request/response helpers ──
function mockReq(query: Record<string, string> = {}) {
  return { query } as any
}

function mockRes() {
  const res: any = {}
  res.json = mock((data: any) => data)
  res.status = mock(function (this: any) {
    return this
  })
  return res
}

function getRouteHandler() {
  // Express Router stores routes in router.stack
  const layer = discoverRouter.stack.find(
    (l: any) => l.route?.path === "/discover",
  )
  if (!layer) throw new Error("No /discover route found")
  // GET handler is the last in the route stack (after middleware like rate limiter)
  const handlers = layer.route.stack.filter((s: any) => s.method === "get")
  return handlers[handlers.length - 1].handle
}

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

describe("GET /discover — route handler", () => {
  test("returns discovered workflows as JSON", async () => {
    const handler = getRouteHandler()
    const req = mockReq({})
    const res = mockRes()
    const next = mock()

    await handler(req, res, next)

    expect(res.json).toHaveBeenCalledTimes(1)
    const data = res.json.mock.calls[0][0]
    expect(Array.isArray(data)).toBe(true)
    expect(data[0].workflowId).toBe("uuid-1")
  })

  test("passes query params to discoverWorkflows", async () => {
    const handler = getRouteHandler()
    const req = mockReq({ category: "core-defi", chain: "base-sepolia" })
    const res = mockRes()
    const next = mock()

    await handler(req, res, next)

    expect(mockDiscoverWorkflows).toHaveBeenCalledWith({
      category: "core-defi",
      chain: "base-sepolia",
    })
  })

  test("passes capability query param", async () => {
    const handler = getRouteHandler()
    const req = mockReq({ capability: "price-feed" })
    const res = mockRes()
    const next = mock()

    await handler(req, res, next)

    expect(mockDiscoverWorkflows).toHaveBeenCalledWith({
      capability: "price-feed",
    })
  })

  test("calls next with AppError when discoverWorkflows throws AppError", async () => {
    const { AppError, ErrorCodes } = await import("../types/errors")

    mockDiscoverWorkflows.mockImplementationOnce(() =>
      Promise.reject(
        new AppError(ErrorCodes.DISCOVERY_FAILED, 502, "Both sources down"),
      ),
    )

    const handler = getRouteHandler()
    const req = mockReq({})
    const res = mockRes()
    const next = mock()

    await handler(req, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    const err = next.mock.calls[0][0]
    expect(err.code).toBe("DISCOVERY_FAILED")
    expect(err.statusCode).toBe(502)
  })

  test("wraps unknown errors in DISCOVERY_FAILED AppError", async () => {
    mockDiscoverWorkflows.mockImplementationOnce(() =>
      Promise.reject(new Error("Unexpected")),
    )

    const handler = getRouteHandler()
    const req = mockReq({})
    const res = mockRes()
    const next = mock()

    await handler(req, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    const err = next.mock.calls[0][0]
    expect(err.code).toBe("DISCOVERY_FAILED")
    expect(err.statusCode).toBe(500)
  })

  test("handles empty query params gracefully", async () => {
    const handler = getRouteHandler()
    const req = mockReq({})
    const res = mockRes()
    const next = mock()

    await handler(req, res, next)

    expect(res.json).toHaveBeenCalledTimes(1)
  })
})
