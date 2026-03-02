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

function mockFetch(status: number, body: unknown) {
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })),
  ) as unknown as typeof fetch
}

describe("simulate command", () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("sends stored mode with workflow ID", async () => {
    mockFetch(200, {
      success: true,
      output: { ethPrice: 2500 },
      logs: ["Fetched price feed", "Report built"],
      duration: 245,
      trace: [
        { step: "fetch_price", status: "passed", duration: 100 },
        { step: "build_report", status: "passed", duration: 145 },
      ],
    })
    const client = new CielClient(makeConfig())
    const data = await client.simulate("wf-test-123")

    expect(data.success).toBe(true)
    expect(data.duration).toBe(245)
    expect(data.logs).toHaveLength(2)
    expect(data.trace).toHaveLength(2)

    expect(fetchCalls()[0][0]).toBe("http://localhost:3001/api/simulate")
    const body = JSON.parse((fetchCalls()[0][1] as RequestInit).body as string)
    expect(body.mode).toBe("stored")
    expect(body.workflowId).toBe("wf-test-123")
  })

  it("handles simulation failure", async () => {
    mockFetch(200, {
      success: false,
      output: null,
      logs: ["Error: Cannot read price feed"],
      duration: 50,
      trace: [
        { step: "fetch_price", status: "failed", detail: "Connection timeout" },
      ],
    })
    const client = new CielClient(makeConfig())
    const data = await client.simulate("wf-fail")

    expect(data.success).toBe(false)
    expect(data.trace![0].status).toBe("failed")
  })

  it("handles empty trace gracefully", async () => {
    mockFetch(200, {
      success: true,
      output: {},
      logs: [],
      duration: 10,
    })
    const client = new CielClient(makeConfig())
    const data = await client.simulate("wf-empty")

    expect(data.success).toBe(true)
    expect(data.trace).toBeUndefined()
    expect(data.logs).toHaveLength(0)
  })
})
