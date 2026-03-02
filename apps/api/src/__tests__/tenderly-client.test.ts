import { describe, test, expect, mock, beforeAll, beforeEach, afterEach } from "bun:test"
import { resolve } from "path"

// ─────────────────────────────────────────────
// Mocks — external boundaries only
// ─────────────────────────────────────────────

const SRC = resolve(import.meta.dir, "..")

mock.module(resolve(SRC, "config.ts"), () => ({
  config: {
    TENDERLY_ACCESS_KEY: "test-key-123",
    TENDERLY_ACCOUNT_SLUG: "test-account",
    TENDERLY_PROJECT_SLUG: "test-project",
    TENDERLY_VIRTUAL_TESTNET_RPC: undefined,
    BASE_SEPOLIA_RPC_URL: "https://base-sepolia.test",
    PRIVATE_KEY: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    NODE_ENV: "test",
  },
}))

mock.module(resolve(SRC, "lib/logger.ts"), () => ({
  createLogger: () => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }),
}))

// ── Dynamic import ──
let createTestnet: typeof import("../services/tenderly/client").createTestnet
let deleteTestnet: typeof import("../services/tenderly/client").deleteTestnet
let listTestnets: typeof import("../services/tenderly/client").listTestnets
let fundAccount: typeof import("../services/tenderly/client").fundAccount
let snapshot: typeof import("../services/tenderly/client").snapshot
let revertToSnapshot: typeof import("../services/tenderly/client").revertToSnapshot
let ensureTenderlyConfigured: typeof import("../services/tenderly/client").ensureTenderlyConfigured

let originalFetch: typeof globalThis.fetch

beforeAll(async () => {
  const mod = await import("../services/tenderly/client")
  createTestnet = mod.createTestnet
  deleteTestnet = mod.deleteTestnet
  listTestnets = mod.listTestnets
  fundAccount = mod.fundAccount
  snapshot = mod.snapshot
  revertToSnapshot = mod.revertToSnapshot
  ensureTenderlyConfigured = mod.ensureTenderlyConfigured
})

beforeEach(() => {
  originalFetch = globalThis.fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

function mockFetch(responseBody: unknown, status = 200) {
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response(JSON.stringify(responseBody), {
      status,
      headers: { "Content-Type": "application/json" },
    })),
  ) as unknown as typeof fetch
}

function mockFetchRpc(result: unknown) {
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })),
  ) as unknown as typeof fetch
}

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

describe("ensureTenderlyConfigured", () => {
  test("does not throw when configured", () => {
    expect(() => ensureTenderlyConfigured()).not.toThrow()
  })
})

describe("createTestnet", () => {
  test("sends correct API request and parses response", async () => {
    mockFetch({
      id: "vnet-123",
      slug: "test-net",
      display_name: "Test Net",
      fork_config: { network_id: 84532 },
      virtual_network_config: { chain_config: { chain_id: 73571 } },
      rpcs: [
        { name: "Public RPC", url: "https://public.rpc" },
        { name: "Admin RPC", url: "https://admin.rpc" },
      ],
      created_at: "2026-03-01T00:00:00Z",
    })

    const result = await createTestnet({ name: "Test Net", networkId: 84532 })

    expect(result.id).toBe("vnet-123")
    expect(result.name).toBe("Test Net")
    expect(result.networkId).toBe(84532)
    expect(result.chainId).toBe(73571)
    expect(result.publicRpcUrl).toBe("https://public.rpc")
    expect(result.adminRpcUrl).toBe("https://admin.rpc")
    expect(result.explorerUrl).toContain("test-account")
    expect(result.explorerUrl).toContain("test-project")
  })

  test("uses custom chain ID when provided", async () => {
    mockFetch({
      id: "vnet-456",
      slug: "custom",
      display_name: "Custom",
      fork_config: { network_id: 1 },
      virtual_network_config: { chain_config: { chain_id: 99999 } },
      rpcs: [{ name: "Public RPC", url: "https://rpc.test" }],
      created_at: "2026-03-01T00:00:00Z",
    })

    const result = await createTestnet({ name: "Custom", networkId: 1, chainId: 99999 })
    expect(result.chainId).toBe(99999)
  })

  test("throws on API error", async () => {
    mockFetch({ error: { message: "Unauthorized" } }, 401)

    try {
      await createTestnet({ name: "fail", networkId: 84532 })
      expect(true).toBe(false) // should not reach
    } catch (err: any) {
      expect(err.code).toBe("TENDERLY_API_ERROR")
    }
  })
})

describe("deleteTestnet", () => {
  test("sends DELETE request", async () => {
    mockFetch({})

    await deleteTestnet("vnet-123")

    const call = (globalThis.fetch as any).mock.calls[0]
    expect(call[0]).toContain("/vnets/vnet-123")
    expect(call[1].method).toBe("DELETE")
  })
})

describe("listTestnets", () => {
  test("parses array of testnets", async () => {
    mockFetch([
      {
        id: "vnet-1",
        slug: "net-1",
        display_name: "Net 1",
        fork_config: { network_id: 1 },
        virtual_network_config: { chain_config: { chain_id: 73571 } },
        rpcs: [{ name: "Public RPC", url: "https://rpc1.test" }],
        created_at: "2026-03-01T00:00:00Z",
      },
      {
        id: "vnet-2",
        slug: "net-2",
        display_name: "Net 2",
        fork_config: { network_id: 84532 },
        virtual_network_config: { chain_config: { chain_id: 73572 } },
        rpcs: [{ name: "Admin RPC", url: "https://rpc2.test" }],
        created_at: "2026-03-01T00:00:00Z",
      },
    ])

    const result = await listTestnets()
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe("vnet-1")
    expect(result[1].networkId).toBe(84532)
  })
})

describe("fundAccount", () => {
  test("calls tenderly_setBalance RPC method", async () => {
    mockFetchRpc("0x1")

    await fundAccount("https://admin.rpc", "0x1234", "0x56BC75E2D63100000")

    const call = (globalThis.fetch as any).mock.calls[0]
    const body = JSON.parse(call[1].body)
    expect(body.method).toBe("tenderly_setBalance")
    expect(body.params[0]).toEqual(["0x1234"])
    expect(body.params[1]).toBe("0x56BC75E2D63100000")
  })

  test("throws TENDERLY_FUND_FAILED on RPC error", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        error: { message: "insufficient funds" },
      }), { status: 200 })),
    ) as unknown as typeof fetch

    try {
      await fundAccount("https://admin.rpc", "0x1234", "0x1")
      expect(true).toBe(false)
    } catch (err: any) {
      expect(err.code).toBe("TENDERLY_FUND_FAILED")
    }
  })
})

describe("snapshot", () => {
  test("returns snapshot ID", async () => {
    mockFetchRpc("0xabc123")

    const id = await snapshot("https://admin.rpc")
    expect(id).toBe("0xabc123")
  })
})

describe("revertToSnapshot", () => {
  test("returns true on success", async () => {
    mockFetchRpc(true)

    const result = await revertToSnapshot("https://admin.rpc", "0xabc123")
    expect(result).toBe(true)
  })

  test("returns false on failure", async () => {
    mockFetchRpc(false)

    const result = await revertToSnapshot("https://admin.rpc", "0xinvalid")
    expect(result).toBe(false)
  })
})

describe("API error handling", () => {
  test("throws on network error", async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch

    try {
      await listTestnets()
      expect(true).toBe(false)
    } catch (err: any) {
      expect(err.code).toBe("TENDERLY_API_ERROR")
      expect(err.message).toContain("ECONNREFUSED")
    }
  })

  test("throws on 500 server error", async () => {
    mockFetch({ error: { message: "Internal Server Error" } }, 500)

    try {
      await listTestnets()
      expect(true).toBe(false)
    } catch (err: any) {
      expect(err.code).toBe("TENDERLY_API_ERROR")
      expect(err.statusCode).toBe(502)
    }
  })
})
