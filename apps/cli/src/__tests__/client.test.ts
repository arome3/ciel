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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MockFn = ReturnType<typeof mock<(...args: any[]) => any>>

function fetchCalls(): unknown[][] {
  return (globalThis.fetch as unknown as MockFn).mock.calls
}

describe("CielClient", () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  function mockFetch(status: number, body: unknown) {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      })),
    ) as unknown as typeof fetch
  }

  it("constructs correct URL for health check", async () => {
    mockFetch(200, { status: "ok", uptime: 100, sseClients: 2, database: "ok" })
    const client = new CielClient(makeConfig())
    const data = await client.health()
    expect(data.status).toBe("ok")
    expect(fetchCalls()[0][0]).toBe("http://localhost:3001/health")
  })

  it("strips trailing slash from API URL", async () => {
    mockFetch(200, { status: "ok", uptime: 0, sseClients: 0, database: "ok" })
    const client = new CielClient(makeConfig({ apiUrl: "http://localhost:3001/" }))
    await client.health()
    expect(fetchCalls()[0][0]).toBe("http://localhost:3001/health")
  })

  it("sends POST with JSON body for generate", async () => {
    mockFetch(200, {
      workflowId: "abc-123",
      code: "// code",
      configJson: "{}",
      template: { id: "T1", name: "Test", confidence: 0.95 },
      validation: { passed: true, checks: [] },
      secretsYaml: null,
    })
    const client = new CielClient(makeConfig())
    const data = await client.generate("test prompt")
    expect(data.workflowId).toBe("abc-123")

    const call = fetchCalls()[0]
    expect(call[0]).toBe("http://localhost:3001/api/generate")
    const opts = call[1] as RequestInit
    expect(opts.method).toBe("POST")
    const body = JSON.parse(opts.body as string)
    expect(body.prompt).toBe("test prompt")
  })

  it("includes template hint when provided", async () => {
    mockFetch(200, {
      workflowId: "abc-123",
      code: "",
      configJson: "{}",
      template: { id: "T5", name: "Test", confidence: 0.9 },
      validation: { passed: true, checks: [] },
      secretsYaml: null,
    })
    const client = new CielClient(makeConfig())
    await client.generate("test", "T5")

    const body = JSON.parse((fetchCalls()[0][1] as RequestInit).body as string)
    expect(body.templateHint).toBe("T5")
  })

  it("extracts error from AppError JSON shape", async () => {
    mockFetch(400, {
      error: { code: "INVALID_INPUT", message: "Prompt too short" },
    })
    const client = new CielClient(makeConfig())
    try {
      await client.generate("hi")
      expect(true).toBe(false)
    } catch (err: unknown) {
      expect((err as Error).message).toContain("Prompt too short")
    }
  })

  it("extracts error from plain message shape", async () => {
    mockFetch(500, { message: "Internal server error" })
    const client = new CielClient(makeConfig())
    try {
      await client.health()
      expect(true).toBe(false)
    } catch (err: unknown) {
      expect((err as Error).message).toContain("Internal server error")
    }
  })

  it("builds query string for listWorkflows", async () => {
    mockFetch(200, { workflows: [], total: 0, page: 1, limit: 10 })
    const client = new CielClient(makeConfig())
    await client.listWorkflows({ page: 2, limit: 5, category: "oracle" })

    const url = fetchCalls()[0][0] as string
    expect(url).toContain("page=2")
    expect(url).toContain("limit=5")
    expect(url).toContain("category=oracle")
  })

  it("passes auth headers for publish", async () => {
    mockFetch(200, {
      workflowId: "abc",
      onchainWorkflowId: "0x123",
      publishTxHash: "0xabc",
      x402Endpoint: "http://...",
      deployStatus: "pending",
      donWorkflowId: null,
    })
    const client = new CielClient(makeConfig())
    const authHeaders = {
      "X-Owner-Address": "0xaddr",
      "X-Owner-Signature": "0xsig",
    }
    await client.publish("abc", "Test", "Description here", 10000, authHeaders)

    const opts = fetchCalls()[0][1] as RequestInit
    const headers = opts.headers as Record<string, string>
    expect(headers["X-Owner-Address"]).toBe("0xaddr")
    expect(headers["X-Owner-Signature"]).toBe("0xsig")
  })

  it("handles simulate with stored mode", async () => {
    mockFetch(200, {
      success: true,
      output: { price: 2500 },
      logs: ["step 1 done"],
      duration: 150,
    })
    const client = new CielClient(makeConfig())
    const data = await client.simulate("wf-123")
    expect(data.success).toBe(true)
    expect(data.duration).toBe(150)

    const body = JSON.parse((fetchCalls()[0][1] as RequestInit).body as string)
    expect(body.mode).toBe("stored")
    expect(body.workflowId).toBe("wf-123")
  })

  it("handles connection errors as API_UNREACHABLE", async () => {
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
