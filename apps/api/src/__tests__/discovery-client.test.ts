import { describe, test, expect, mock, beforeAll, beforeEach } from "bun:test"
import { resolve } from "path"

// ─────────────────────────────────────────────
// Mocks — external boundaries only
// ─────────────────────────────────────────────

const SRC = resolve(import.meta.dir, "..")

// ── Config mock ──
mock.module(resolve(SRC, "config.ts"), () => ({
  config: {
    X402_FACILITATOR_URL: "https://facilitator.test",
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

// ── Retry mock ──
mock.module(resolve(SRC, "services/blockchain/retry.ts"), () => ({
  withRetry: (fn: any) => fn(),
  isRetryableRpcError: () => false,
}))

// ── Registry mock ──
const mockGetAllWorkflowIds = mock(() =>
  Promise.resolve({ data: ["0xabc1"] as any, total: 1n }),
)
const mockSearchByCategory = mock(() =>
  Promise.resolve({ data: ["0xabc1"] as any, total: 1n }),
)
const mockSearchByChain = mock(() =>
  Promise.resolve({ data: ["0xabc1"] as any, total: 1n }),
)
const mockGetWorkflow = mock(() =>
  Promise.resolve({
    creator: "0xCreator",
    name: "Test Workflow",
    description: "A test workflow",
    category: "core-defi",
    supportedChains: [10344971235874465080n],
    capabilities: ["price-feed"],
    x402Endpoint: "http://localhost:3001/api/workflows/uuid-1/execute",
    pricePerExecution: 10000n,
    totalExecutions: 5n,
    successfulExecutions: 4n,
    createdAt: 1000000n,
    active: true,
  }),
)

mock.module(resolve(SRC, "services/blockchain/registry.ts"), () => ({
  getAllWorkflowIds: mockGetAllWorkflowIds,
  searchWorkflowsByCategory: mockSearchByCategory,
  searchWorkflowsByChain: mockSearchByChain,
  getWorkflowFromRegistry: mockGetWorkflow,
  publishToRegistry: mock(() => Promise.resolve({ workflowId: "0x0", txHash: "0x0" })),
  recordExecution: mock(() => Promise.resolve()),
  updateWorkflow: mock(() => Promise.resolve()),
  deactivateWorkflow: mock(() => Promise.resolve()),
  reactivateWorkflow: mock(() => Promise.resolve()),
  addAuthorizedSender: mock(() => Promise.resolve()),
  removeAuthorizedSender: mock(() => Promise.resolve()),
  getCreatorWorkflows: mock(() => Promise.resolve({ data: [], total: 0n })),
}))

// ── Fetch mock ──
const originalFetch = globalThis.fetch
let mockFetchResponse: any = {
  ok: true,
  status: 200,
  json: () =>
    Promise.resolve({
      x402Version: 2,
      items: [
        {
          resource:
            "http://localhost:3001/api/workflows/a1b2c3d4-e5f6-4890-abcd-ef1234567890/execute",
          type: "http",
          x402Version: 2,
          accepts: [],
          lastUpdated: "2026-01-01T00:00:00Z",
          metadata: {
            name: "Bazaar Workflow",
            description: "From bazaar",
            category: "ai-powered",
            chains: ["base-sepolia"],
            capabilities: ["multi-ai"],
            priceUsdc: 5000,
          },
        },
      ],
      pagination: { limit: 50, offset: 0, total: 1 },
    }),
}

// ── Dynamic import ──
let discoverWorkflows: any
let _discoverViaRegistry: any
let _discoverViaBazaar: any
let _discoveryCache: any

beforeAll(async () => {
  globalThis.fetch = mock(() => Promise.resolve(mockFetchResponse)) as any

  const mod = await import("../services/discovery/client")
  discoverWorkflows = mod.discoverWorkflows
  _discoverViaRegistry = mod._discoverViaRegistry
  _discoverViaBazaar = mod._discoverViaBazaar
  _discoveryCache = mod._discoveryCache
})

beforeEach(() => {
  // Clear cache between tests
  _discoveryCache?.clear()

  // Reset mocks
  mockGetAllWorkflowIds.mockImplementation(() =>
    Promise.resolve({ data: ["0xabc1"] as any, total: 1n }),
  )
  mockSearchByCategory.mockImplementation(() =>
    Promise.resolve({ data: ["0xabc1"] as any, total: 1n }),
  )
  mockGetWorkflow.mockImplementation(() =>
    Promise.resolve({
      creator: "0xCreator",
      name: "Test Workflow",
      description: "A test workflow",
      category: "core-defi",
      supportedChains: [10344971235874465080n],
      capabilities: ["price-feed"],
      x402Endpoint: "http://localhost:3001/api/workflows/uuid-1/execute",
      pricePerExecution: 10000n,
      totalExecutions: 5n,
      successfulExecutions: 4n,
      createdAt: 1000000n,
      active: true,
    }),
  )

  ;(globalThis.fetch as any).mockImplementation(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          x402Version: 2,
          items: [
            {
              resource:
                "http://localhost:3001/api/workflows/a1b2c3d4-e5f6-4890-abcd-ef1234567890/execute",
              type: "http",
              x402Version: 2,
              accepts: [],
              lastUpdated: "2026-01-01T00:00:00Z",
              metadata: {
                name: "Bazaar Workflow",
                description: "From bazaar",
                category: "ai-powered",
                chains: ["base-sepolia"],
                capabilities: ["multi-ai"],
                priceUsdc: 5000,
              },
            },
          ],
          pagination: { limit: 50, offset: 0, total: 1 },
        }),
    }),
  )
})

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

describe("Discovery — registry path", () => {
  test("returns workflows from registry", async () => {
    const results = await _discoverViaRegistry({})
    expect(results.length).toBe(1)
    expect(results[0].source).toBe("registry")
    expect(results[0].name).toBe("Test Workflow")
  })

  test("uses searchByCategory when category is provided", async () => {
    await _discoverViaRegistry({ category: "core-defi" })
    expect(mockSearchByCategory).toHaveBeenCalledWith("core-defi", 0n, 50n)
  })

  test("uses searchByChain when chain is provided", async () => {
    await _discoverViaRegistry({ chain: "base-sepolia" })
    expect(mockSearchByChain).toHaveBeenCalledWith(
      10344971235874465080n,
      0n,
      50n,
    )
  })

  test("returns empty for unknown chain", async () => {
    const results = await _discoverViaRegistry({ chain: "ethereum-mainnet" })
    expect(results.length).toBe(0)
  })

  test("filters by capability client-side", async () => {
    const results = await _discoverViaRegistry({
      capability: "nonexistent",
    })
    expect(results.length).toBe(0)
  })

  test("filters out inactive workflows", async () => {
    mockGetWorkflow.mockImplementation(() =>
      Promise.resolve({
        creator: "0xCreator",
        name: "Inactive",
        description: "Deactivated",
        category: "core-defi",
        supportedChains: [10344971235874465080n],
        capabilities: ["price-feed"],
        x402Endpoint: "http://example.com/execute",
        pricePerExecution: 10000n,
        totalExecutions: 0n,
        successfulExecutions: 0n,
        createdAt: 1000000n,
        active: false,
      }),
    )

    const results = await _discoverViaRegistry({})
    expect(results.length).toBe(0)
  })
})

describe("Discovery — bazaar path", () => {
  test("returns workflows from Bazaar", async () => {
    const results = await _discoverViaBazaar({})
    expect(results.length).toBe(1)
    expect(results[0].source).toBe("bazaar")
    expect(results[0].name).toBe("Bazaar Workflow")
  })

  test("extracts workflow UUID from resource URL", async () => {
    const results = await _discoverViaBazaar({})
    expect(results[0].workflowId).toBe("a1b2c3d4-e5f6-4890-abcd-ef1234567890")
  })

  test("passes category as q param", async () => {
    await _discoverViaBazaar({ category: "core-defi" })
    const lastCall = (globalThis.fetch as any).mock.calls.at(-1)
    expect(lastCall[0]).toContain("q=core-defi")
  })

  test("handles missing items field gracefully", async () => {
    ;(globalThis.fetch as any).mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ x402Version: 2 }),
      }),
    )

    const results = await _discoverViaBazaar({})
    expect(results.length).toBe(0)
  })

  test("handles null items gracefully", async () => {
    ;(globalThis.fetch as any).mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ x402Version: 2, items: null }),
      }),
    )

    const results = await _discoverViaBazaar({})
    expect(results.length).toBe(0)
  })
})

describe("Discovery — unified entrypoint", () => {
  test("merges results from both sources", async () => {
    const results = await discoverWorkflows({})
    // uuid-1 from registry + a1b2c3d4-e5f6-4890-abcd-ef1234567890 from bazaar (different endpoints)
    expect(results.length).toBe(2)
  })

  test("deduplicates by x402Endpoint, preferring registry", async () => {
    // Make bazaar return same endpoint as registry
    ;(globalThis.fetch as any).mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            x402Version: 2,
            items: [
              {
                resource:
                  "http://localhost:3001/api/workflows/uuid-1/execute",
                type: "http",
                x402Version: 2,
                accepts: [],
                lastUpdated: "2026-01-01T00:00:00Z",
                metadata: {
                  name: "Bazaar Duplicate",
                  description: "Same endpoint",
                  category: "core-defi",
                },
              },
            ],
            pagination: { limit: 50, offset: 0, total: 1 },
          }),
      }),
    )

    const results = await discoverWorkflows({})
    expect(results.length).toBe(1)
    // Registry source preferred
    expect(results[0].source).toBe("registry")
    expect(results[0].name).toBe("Test Workflow")
  })

  test("returns bazaar results when registry fails", async () => {
    mockGetAllWorkflowIds.mockImplementation(() =>
      Promise.reject(new Error("RPC down")),
    )

    const results = await discoverWorkflows({})
    expect(results.length).toBe(1)
    expect(results[0].source).toBe("bazaar")
  })

  test("returns registry results when bazaar fails", async () => {
    ;(globalThis.fetch as any).mockImplementation(() =>
      Promise.reject(new Error("Bazaar down")),
    )

    const results = await discoverWorkflows({})
    expect(results.length).toBe(1)
    expect(results[0].source).toBe("registry")
  })

  test("throws DISCOVERY_FAILED when both sources fail", async () => {
    mockGetAllWorkflowIds.mockImplementation(() =>
      Promise.reject(new Error("RPC down")),
    )
    ;(globalThis.fetch as any).mockImplementation(() =>
      Promise.reject(new Error("Bazaar down")),
    )

    try {
      await discoverWorkflows({})
      expect(true).toBe(false) // should not reach
    } catch (err: any) {
      expect(err.code).toBe("DISCOVERY_FAILED")
      expect(err.statusCode).toBe(502)
    }
  })

  test("sorts results by totalExecutions descending", async () => {
    // Registry workflow has 5 executions, bazaar has 0
    const results = await discoverWorkflows({})
    if (results.length >= 2) {
      expect(results[0].totalExecutions).toBeGreaterThanOrEqual(
        results[1].totalExecutions,
      )
    }
  })
})

describe("Discovery — cache behavior", () => {
  test("second identical query uses cache, no additional fetch call", async () => {
    _discoveryCache.clear()
    const fetchCallsBefore = (globalThis.fetch as any).mock.calls.length
    const registryCallsBefore = mockGetAllWorkflowIds.mock.calls.length

    // First call — cache miss, both sources queried
    await discoverWorkflows({})
    const fetchCallsAfterFirst = (globalThis.fetch as any).mock.calls.length
    const registryCallsAfterFirst = mockGetAllWorkflowIds.mock.calls.length
    expect(fetchCallsAfterFirst).toBeGreaterThan(fetchCallsBefore)
    expect(registryCallsAfterFirst).toBeGreaterThan(registryCallsBefore)

    // Second call — cache hit, no new fetch or registry calls
    await discoverWorkflows({})
    expect((globalThis.fetch as any).mock.calls.length).toBe(fetchCallsAfterFirst)
    expect(mockGetAllWorkflowIds.mock.calls.length).toBe(registryCallsAfterFirst)
  })
})
