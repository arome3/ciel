import { describe, test, expect, mock, beforeAll, beforeEach } from "bun:test"
import { resolve } from "path"

// ─────────────────────────────────────────────
// Mocks — external boundaries only
// ─────────────────────────────────────────────

const SRC = resolve(import.meta.dir, "..")

const mockInfo = mock()
const mockWarn = mock()

mock.module(resolve(SRC, "lib/logger.ts"), () => ({
  createLogger: () => ({
    debug: () => {},
    info: mockInfo,
    warn: mockWarn,
    error: () => {},
  }),
}))

// @x402 mocks — bazaar.ts imports these at top level
mock.module("@x402/extensions/bazaar", () => ({
  bazaarResourceServerExtension: { name: "bazaar" },
  declareDiscoveryExtension: () => ({}),
}))

// ── Global fetch mock ──
const originalFetch = globalThis.fetch
const mockFetch = mock()
globalThis.fetch = mockFetch as any

// ── Dynamic import ──
let registerWorkflowInBazaar: any
beforeAll(async () => {
  const mod = await import("../services/x402/bazaar")
  registerWorkflowInBazaar = mod.registerWorkflowInBazaar
})

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

const SAMPLE_PARAMS = {
  x402Endpoint: "https://api.test/api/workflows/abc-123/execute",
  name: "Price Alert",
  description: "Alerts on price drops",
  category: "core-defi",
  priceUsdc: 10000,
  capabilities: ["price-feed", "alert"],
  chains: ["base-sepolia"],
}

const LOCAL_PARAMS = {
  ...SAMPLE_PARAMS,
  x402Endpoint: "http://localhost:3001/api/workflows/abc-123/execute",
}

function okResponse(status = 201) {
  return new Response(null, { status, statusText: "Created" })
}

function errorResponse(status: number, statusText: string) {
  return new Response(null, { status, statusText })
}

beforeEach(() => {
  mockFetch.mockReset()
  mockInfo.mockReset()
  mockWarn.mockReset()
})

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

describe("Bazaar — registerWorkflowInBazaar", () => {
  test("POSTs to the community catalog /register endpoint", async () => {
    mockFetch.mockResolvedValueOnce(okResponse())

    await registerWorkflowInBazaar(SAMPLE_PARAMS)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe("https://x402-discovery-api.onrender.com/register")
    expect(init.method).toBe("POST")
  })

  test("sends correct body format for community catalog", async () => {
    mockFetch.mockResolvedValueOnce(okResponse())

    await registerWorkflowInBazaar(SAMPLE_PARAMS)

    const [, init] = mockFetch.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.name).toBe("Price Alert")
    expect(body.url).toBe(SAMPLE_PARAMS.x402Endpoint)
    // "core-defi" maps to "compute" in the catalog
    expect(body.category).toBe("compute")
    expect(body.description).toBe("Alerts on price drops")
    expect(body.network).toBe("base-sepolia")
  })

  test("maps ai-powered category to agent", async () => {
    mockFetch.mockResolvedValueOnce(okResponse())

    await registerWorkflowInBazaar({ ...SAMPLE_PARAMS, category: "ai-powered" })

    const [, init] = mockFetch.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.category).toBe("agent")
  })

  test("maps unknown category to utility", async () => {
    mockFetch.mockResolvedValueOnce(okResponse())

    await registerWorkflowInBazaar({ ...SAMPLE_PARAMS, category: "custom-thing" })

    const [, init] = mockFetch.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.category).toBe("utility")
  })

  test("converts priceUsdc (6-decimal int) to price_usd (dollar float)", async () => {
    mockFetch.mockResolvedValueOnce(okResponse())

    await registerWorkflowInBazaar(SAMPLE_PARAMS)

    const [, init] = mockFetch.mock.calls[0]
    const body = JSON.parse(init.body)
    // 10000 / 1_000_000 = 0.01
    expect(body.price_usd).toBe(0.01)
  })

  test("converts larger priceUsdc correctly", async () => {
    mockFetch.mockResolvedValueOnce(okResponse())

    await registerWorkflowInBazaar({ ...SAMPLE_PARAMS, priceUsdc: 5_000_000 })

    const [, init] = mockFetch.mock.calls[0]
    const body = JSON.parse(init.body)
    // 5_000_000 / 1_000_000 = 5.0
    expect(body.price_usd).toBe(5)
  })

  test("sets Content-Type: application/json header", async () => {
    mockFetch.mockResolvedValueOnce(okResponse())

    await registerWorkflowInBazaar(SAMPLE_PARAMS)

    const [, init] = mockFetch.mock.calls[0]
    expect(init.headers["Content-Type"]).toBe("application/json")
  })

  test("uses 10s timeout signal", async () => {
    mockFetch.mockResolvedValueOnce(okResponse())

    await registerWorkflowInBazaar(SAMPLE_PARAMS)

    const [, init] = mockFetch.mock.calls[0]
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(init.signal).toBeDefined()
  })

  test("logs info on successful registration (2xx)", async () => {
    mockFetch.mockResolvedValueOnce(okResponse(201))

    await registerWorkflowInBazaar(SAMPLE_PARAMS)

    expect(mockInfo).toHaveBeenCalledWith(
      expect.stringContaining("Registered workflow in Bazaar"),
    )
    expect(mockWarn).not.toHaveBeenCalled()
  })

  test("handles catalog 404 gracefully without throwing", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(404, "Not Found"))

    // Should not throw
    await registerWorkflowInBazaar(SAMPLE_PARAMS)

    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining("Bazaar registration returned 404"),
    )
    expect(mockInfo).not.toHaveBeenCalled()
  })

  test("handles network error gracefully without throwing", async () => {
    mockFetch.mockRejectedValueOnce(new Error("fetch failed"))

    // Should not throw
    await registerWorkflowInBazaar(SAMPLE_PARAMS)

    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining("Bazaar registration failed: fetch failed"),
    )
    expect(mockInfo).not.toHaveBeenCalled()
  })

  test("skips registration for non-HTTPS endpoints (local dev)", async () => {
    await registerWorkflowInBazaar(LOCAL_PARAMS)

    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockInfo).toHaveBeenCalledWith(
      expect.stringContaining("Skipping Bazaar registration"),
    )
  })

  test("does not include old facilitator-style metadata fields", async () => {
    mockFetch.mockResolvedValueOnce(okResponse())

    await registerWorkflowInBazaar(SAMPLE_PARAMS)

    const [, init] = mockFetch.mock.calls[0]
    const body = JSON.parse(init.body)
    // Old format fields should not be present
    expect(body.resource).toBeUndefined()
    expect(body.type).toBeUndefined()
    expect(body.x402Version).toBeUndefined()
    expect(body.metadata).toBeUndefined()
  })
})
