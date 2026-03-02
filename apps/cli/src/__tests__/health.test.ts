import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import { CielClient } from "../client"
import type { CliConfig } from "../config"

function makeConfig(overrides?: Partial<CliConfig>): CliConfig {
  return {
    apiUrl: "http://localhost:3001",
    privateKey: undefined,
    timeout: 5000,
    jsonMode: false,
    noColor: false,
    defaultChain: "base-sepolia",
    ...overrides,
  }
}

function mockFetch(status: number, body: unknown) {
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })),
  ) as unknown as typeof fetch
}

describe("health command", () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("returns healthy status", async () => {
    mockFetch(200, {
      status: "ok",
      uptime: 3661,
      sseClients: 3,
      database: "ok",
    })
    const client = new CielClient(makeConfig())
    const data = await client.health()

    expect(data.status).toBe("ok")
    expect(data.uptime).toBe(3661)
    expect(data.sseClients).toBe(3)
    expect(data.database).toBe("ok")
  })

  it("handles degraded status (503)", async () => {
    mockFetch(503, {
      status: "degraded",
      uptime: 100,
      sseClients: 0,
      database: "error",
    })
    const client = new CielClient(makeConfig())
    try {
      await client.health()
      expect(true).toBe(false)
    } catch (err: unknown) {
      expect((err as Error).message).toContain("503")
    }
  })

  it("handles connection refused", async () => {
    globalThis.fetch = mock(() =>
      Promise.reject(new TypeError("fetch failed")),
    ) as unknown as typeof fetch
    const client = new CielClient(makeConfig())
    try {
      await client.health()
      expect(true).toBe(false)
    } catch (err: unknown) {
      expect((err as Error).message).toContain("Cannot connect")
    }
  })
})
