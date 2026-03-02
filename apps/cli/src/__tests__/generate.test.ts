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

const GENERATE_RESPONSE = {
  workflowId: "abc-123-def-456",
  code: 'import { cre } from "@chainlink/cre-sdk"',
  configJson: '{"schedule":"*/5 * * * *"}',
  template: { id: "T1", name: "Price Monitor", confidence: 0.92 },
  validation: { passed: true, checks: [{ name: "syntax", passed: true }] },
  secretsYaml: null,
}

describe("generate command", () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("sends correct API request shape", async () => {
    mockFetch(200, GENERATE_RESPONSE)
    const client = new CielClient(makeConfig())
    const data = await client.generate("Monitor ETH price every 5 minutes")

    expect(data.workflowId).toBe("abc-123-def-456")
    expect(data.template.id).toBe("T1")
    expect(data.template.confidence).toBe(0.92)
    expect(data.validation.passed).toBe(true)

    const body = JSON.parse((fetchCalls()[0][1] as RequestInit).body as string)
    expect(body.prompt).toBe("Monitor ETH price every 5 minutes")
    expect(body.templateHint).toBeUndefined()
  })

  it("includes template hint when provided", async () => {
    mockFetch(200, GENERATE_RESPONSE)
    const client = new CielClient(makeConfig())
    await client.generate("test prompt", "T5")

    const body = JSON.parse((fetchCalls()[0][1] as RequestInit).body as string)
    expect(body.templateHint).toBe("T5")
  })

  it("returns raw API response for json mode consumption", async () => {
    mockFetch(200, GENERATE_RESPONSE)
    const client = new CielClient(makeConfig({ jsonMode: true }))
    const data = await client.generate("test prompt")

    expect(data.workflowId).toBe("abc-123-def-456")
    expect(data.code).toBeDefined()
    expect(data.configJson).toBeDefined()
  })

  it("handles validation failure response", async () => {
    mockFetch(200, {
      ...GENERATE_RESPONSE,
      validation: {
        passed: false,
        checks: [
          { name: "syntax", passed: true },
          { name: "imports", passed: false, message: "Disallowed import: fs" },
        ],
      },
    })
    const client = new CielClient(makeConfig())
    const data = await client.generate("test")

    expect(data.validation.passed).toBe(false)
    expect(data.validation.checks).toHaveLength(2)
    expect(data.validation.checks[1].passed).toBe(false)
  })
})
