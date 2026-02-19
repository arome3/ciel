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

// ── DB mock (used by dynamic pricing + onAfterSettle) ──
let mockPriceLookupResult: any = { priceUsdc: 50000 } // $0.05
let mockPendingExecution: any = { id: "exec-001" }
let mockSettleUpdateCalled = false

const mockSelectGet = mock(() => Promise.resolve(mockPriceLookupResult))
const mockSelectLimit = mock(() => ({ get: mockSelectGet }))
const mockSelectOrderBy = mock(() => ({ limit: mockSelectLimit }))
const mockSelectWhere = mock(() => ({
  get: mockSelectGet,
  orderBy: mockSelectOrderBy,
}))
const mockSelectFrom = mock(() => ({ where: mockSelectWhere }))
const mockSelect = mock(() => ({ from: mockSelectFrom }))

const mockUpdateWhere = mock(() => {
  mockSettleUpdateCalled = true
  return Promise.resolve()
})
const mockUpdateSet = mock(() => ({ where: mockUpdateWhere }))
const mockUpdate = mock(() => ({ set: mockUpdateSet }))

mock.module(resolve(SRC, "db/index.ts"), () => ({
  db: { select: mockSelect, update: mockUpdate },
  sqlite: {},
}))

mock.module(resolve(SRC, "db/schema.ts"), () => ({
  workflows: { id: "id", priceUsdc: "price_usdc" },
  executions: {
    id: "id",
    paymentTxHash: "payment_tx_hash",
    amountUsdc: "amount_usdc",
    agentAddress: "agent_address",
    createdAt: "created_at",
  },
}))

// ── x402 external mocks ──
let capturedOnAfterSettle: any = null

const mockX402Handler = mock((req: any, res: any, next: any) => {
  next()
})

const mockPaymentMiddleware = mock(
  (routes: any, server: any) => {
    return mockX402Handler
  },
)

const mockResourceServerInstance = {
  register: mock(function(this: any) { return this }),
  registerExtension: mock(function(this: any) { return this }),
  initialize: mock(() => Promise.resolve()),
  onAfterSettle: mock(function(this: any, hook: any) {
    capturedOnAfterSettle = hook
    return this
  }),
}
const mockX402ResourceServer = mock(() => mockResourceServerInstance)

mock.module("@x402/express", () => ({
  paymentMiddleware: mockPaymentMiddleware,
  x402ResourceServer: mockX402ResourceServer,
}))

const mockHTTPFacilitatorClient = mock(() => ({
  verify: mock(() => Promise.resolve({})),
  settle: mock(() => Promise.resolve({})),
}))

mock.module("@x402/core/server", () => ({
  HTTPFacilitatorClient: mockHTTPFacilitatorClient,
}))

const mockRegisterExactEvmScheme = mock((server: any) => server)

mock.module("@x402/evm/exact/server", () => ({
  registerExactEvmScheme: mockRegisterExactEvmScheme,
}))

// ── Dynamic import ──
let conditionalPayment: any
let _routes: any
let _resourceServer: any
let _lookupWorkflowPrice: any

beforeAll(async () => {
  const mod = await import("../services/x402/middleware")
  conditionalPayment = mod.conditionalPayment
  _routes = mod._routes
  _resourceServer = mod._resourceServer
  _lookupWorkflowPrice = mod._lookupWorkflowPrice
})

beforeEach(() => {
  mockPriceLookupResult = { priceUsdc: 50000 }
  mockPendingExecution = { id: "exec-001" }
  mockSettleUpdateCalled = false
  // Reset the selectGet mock to return the right data per test
  mockSelectGet.mockImplementation(() => Promise.resolve(mockPriceLookupResult))
})

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

describe("x402 middleware — setup", () => {
  test("HTTPFacilitatorClient constructed with facilitator URL", () => {
    expect(mockHTTPFacilitatorClient).toHaveBeenCalledWith({
      url: "https://facilitator.test",
    })
  })

  test("x402ResourceServer constructed with facilitator client", () => {
    expect(mockX402ResourceServer).toHaveBeenCalledTimes(1)
  })

  test("registerExactEvmScheme called with resource server", () => {
    expect(mockRegisterExactEvmScheme).toHaveBeenCalledWith(
      _resourceServer,
    )
  })

  test("paymentMiddleware called with routes and resource server", () => {
    expect(mockPaymentMiddleware).toHaveBeenCalledTimes(1)
    expect(mockPaymentMiddleware.mock.calls[0].length).toBe(2)
  })

  test("onAfterSettle hook registered", () => {
    expect(mockResourceServerInstance.onAfterSettle).toHaveBeenCalledTimes(1)
    expect(capturedOnAfterSettle).toBeFunction()
  })
})

describe("x402 middleware — route config", () => {
  test("route key uses correct path without /api prefix", () => {
    expect(_routes).toHaveProperty("GET /workflows/:id/execute")
  })

  test("accepts uses exact scheme on base-sepolia", () => {
    const routeConfig = _routes["GET /workflows/:id/execute"]
    const accept = routeConfig.accepts[0]
    expect(accept.scheme).toBe("exact")
    expect(accept.network).toBe("eip155:84532")
  })

  test("payTo uses configured WALLET_ADDRESS", () => {
    const accept = _routes["GET /workflows/:id/execute"].accepts[0]
    expect(accept.payTo).toBe("0xTestWallet")
  })

  test("price is a dynamic function, not a static string", () => {
    const accept = _routes["GET /workflows/:id/execute"].accepts[0]
    expect(accept.price).toBeFunction()
  })
})

describe("x402 middleware — dynamic pricing", () => {
  test("returns workflow price from DB in dollar format", async () => {
    mockPriceLookupResult = { priceUsdc: 50000 } // 50000 / 1_000_000 = $0.05
    mockSelectGet.mockImplementation(() => Promise.resolve(mockPriceLookupResult))

    const price = await _lookupWorkflowPrice({
      path: "/workflows/abc-123/execute",
    })

    expect(price).toBe("0.05")
  })

  test("returns $0.01 fallback when workflow not found", async () => {
    mockSelectGet.mockImplementation(() => Promise.resolve(null))

    const price = await _lookupWorkflowPrice({
      path: "/workflows/missing-id/execute",
    })

    expect(price).toBe("0.01")
  })

  test("returns $0.01 fallback when path has no workflow ID", async () => {
    const price = await _lookupWorkflowPrice({ path: "/" })
    expect(price).toBe("0.01")
  })

  test("returns $0.01 fallback on DB error", async () => {
    mockSelectGet.mockImplementation(() => Promise.reject(new Error("DB down")))

    const price = await _lookupWorkflowPrice({
      path: "/workflows/abc-123/execute",
    })

    expect(price).toBe("0.01")
  })

  test("converts 1000000 priceUsdc to $1", async () => {
    mockPriceLookupResult = { priceUsdc: 1000000 }
    mockSelectGet.mockImplementation(() => Promise.resolve(mockPriceLookupResult))

    const price = await _lookupWorkflowPrice({
      path: "/workflows/abc-123/execute",
    })

    expect(price).toBe("1")
  })
})

describe("x402 middleware — onAfterSettle hook", () => {
  test("updates execution with tx hash on successful settlement", async () => {
    mockSelectGet.mockImplementation(() => Promise.resolve({ id: "exec-001" }))

    await capturedOnAfterSettle({
      result: { success: true, transaction: "0xtx123", payer: "0xPayer", network: "eip155:84532" },
      paymentPayload: {},
      requirements: {},
    })

    expect(mockSettleUpdateCalled).toBe(true)
  })

  test("skips update when settlement failed", async () => {
    await capturedOnAfterSettle({
      result: { success: false, transaction: "0xtx123" },
      paymentPayload: {},
      requirements: {},
    })

    expect(mockSettleUpdateCalled).toBe(false)
  })

  test("does not crash when no pending execution found", async () => {
    mockSelectGet.mockImplementation(() => Promise.resolve(null))

    // Should not throw
    await capturedOnAfterSettle({
      result: { success: true, transaction: "0xtx456", network: "eip155:84532" },
      paymentPayload: {},
      requirements: {},
    })

    expect(mockSettleUpdateCalled).toBe(false)
  })

  test("does not crash on DB error", async () => {
    mockSelectGet.mockImplementation(() => Promise.reject(new Error("DB error")))

    // Should not throw
    await capturedOnAfterSettle({
      result: { success: true, transaction: "0xtx789", network: "eip155:84532" },
      paymentPayload: {},
      requirements: {},
    })
  })
})

describe("x402 middleware — conditionalPayment", () => {
  test("calls next() immediately when req.skipPayment is true", () => {
    const req = { skipPayment: true } as any
    const res = { status: mock(function(this: any) { return this }), json: mock() } as any
    let called = false
    const next = () => { called = true }

    conditionalPayment(req, res, next)

    expect(called).toBe(true)
  })

  test("delegates to x402Handler when skipPayment is false", () => {
    const callsBefore = mockX402Handler.mock.calls.length
    const req = { skipPayment: false } as any
    const res = { status: mock(function(this: any) { return this }), json: mock() } as any
    const next = () => {}

    conditionalPayment(req, res, next)

    expect(mockX402Handler.mock.calls.length).toBe(callsBefore + 1)
  })

  test("delegates to x402Handler when skipPayment is undefined", () => {
    const callsBefore = mockX402Handler.mock.calls.length
    const req = {} as any
    const res = { status: mock(function(this: any) { return this }), json: mock() } as any
    const next = () => {}

    conditionalPayment(req, res, next)

    expect(mockX402Handler.mock.calls.length).toBe(callsBefore + 1)
  })
})
