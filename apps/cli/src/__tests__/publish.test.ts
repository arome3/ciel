import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import { CielClient } from "../client"
import { requireAuth, workflowAuthHeaders } from "../auth"
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

function mockFetch(status: number, body: unknown) {
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })),
  ) as unknown as typeof fetch
}

const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

describe("publish command", () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("throws when no private key is configured", () => {
    expect(() => requireAuth(makeConfig())).toThrow("authentication")
  })

  it("sends auth headers with publish request", async () => {
    mockFetch(200, {
      workflowId: "wf-123",
      onchainWorkflowId: "0x456",
      publishTxHash: "0xabc",
      x402Endpoint: "http://localhost:3001/api/workflows/wf-123/execute",
      deployStatus: "pending",
      donWorkflowId: null,
    })

    const config = makeConfig({ privateKey: TEST_KEY })
    const auth = requireAuth(config)
    const headers = await workflowAuthHeaders(auth, "wf-123")
    const client = new CielClient(config)

    const data = await client.publish("wf-123", "My Workflow", "A great workflow", 10000, headers)

    expect(data.workflowId).toBe("wf-123")
    expect(data.deployStatus).toBe("pending")

    const opts = fetchCalls()[0][1] as RequestInit
    const sentHeaders = opts.headers as Record<string, string>
    expect(sentHeaders["X-Owner-Address"]).toBeDefined()
    expect(sentHeaders["X-Owner-Signature"]).toBeDefined()
    expect(sentHeaders["X-Owner-Signature"].startsWith("0x")).toBe(true)
  })

  it("sends correct request body", async () => {
    mockFetch(200, {
      workflowId: "wf-123",
      onchainWorkflowId: "0x456",
      publishTxHash: "0xabc",
      x402Endpoint: "http://...",
      deployStatus: "pending",
      donWorkflowId: null,
    })

    const config = makeConfig({ privateKey: TEST_KEY })
    const auth = requireAuth(config)
    const headers = await workflowAuthHeaders(auth, "wf-123")
    const client = new CielClient(config)

    await client.publish("wf-123", "Test Name", "Test Description Text", 50000, headers)

    const body = JSON.parse((fetchCalls()[0][1] as RequestInit).body as string)
    expect(body.workflowId).toBe("wf-123")
    expect(body.name).toBe("Test Name")
    expect(body.description).toBe("Test Description Text")
    expect(body.priceUsdc).toBe(50000)
  })

  it("handles 403 forbidden error", async () => {
    mockFetch(403, {
      error: { code: "PUBLISH_FAILED", message: "Not authorized to publish this workflow" },
    })

    const config = makeConfig({ privateKey: TEST_KEY })
    const auth = requireAuth(config)
    const headers = await workflowAuthHeaders(auth, "wf-wrong")
    const client = new CielClient(config)

    try {
      await client.publish("wf-wrong", "X", "XXXXXXXXXXXX", 10000, headers)
      expect(true).toBe(false)
    } catch (err: unknown) {
      expect((err as Error).message).toContain("Not authorized")
    }
  })
})
