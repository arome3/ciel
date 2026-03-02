import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import { CielClient } from "../client"
import { requireAuth, pipelineAuthHeaders } from "../auth"
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

const PIPELINE_RESPONSE = {
  id: "pipe-123",
  name: "ETH Monitor Pipeline",
  description: "Multi-step ETH monitoring",
  ownerAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  steps: [
    { workflowId: "wf-1", position: 0 },
    { workflowId: "wf-2", position: 1 },
  ],
  totalPriceUsdc: 20000,
  active: true,
  executionCount: 5,
  createdAt: "2026-03-01T00:00:00Z",
}

describe("pipeline commands", () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe("create", () => {
    it("sends pipeline data with auth headers", async () => {
      mockFetch(201, PIPELINE_RESPONSE)

      const config = makeConfig({ privateKey: TEST_KEY })
      const auth = requireAuth(config)
      const headers = await pipelineAuthHeaders(auth, "new-pipeline")
      const client = new CielClient(config)

      const data = await client.createPipeline(
        {
          name: "ETH Monitor Pipeline",
          description: "Multi-step ETH monitoring",
          ownerAddress: auth.address,
          steps: [
            { workflowId: "wf-1", position: 0 },
            { workflowId: "wf-2", position: 1 },
          ],
        },
        headers,
      )

      expect(data.id).toBe("pipe-123")
      expect(data.name).toBe("ETH Monitor Pipeline")

      const opts = fetchCalls()[0][1] as RequestInit
      const sentHeaders = opts.headers as Record<string, string>
      expect(sentHeaders["X-Owner-Address"]).toBeDefined()
      expect(sentHeaders["X-Owner-Signature"]).toBeDefined()
      expect(sentHeaders["X-Owner-Timestamp"]).toBeDefined()
    })
  })

  describe("execute", () => {
    it("sends execution request with auth and input", async () => {
      mockFetch(200, {
        id: "exec-456",
        pipelineId: "pipe-123",
        status: "completed",
        results: { output: "success" },
        startedAt: "2026-03-01T00:00:00Z",
        completedAt: "2026-03-01T00:00:05Z",
      })

      const config = makeConfig({ privateKey: TEST_KEY })
      const auth = requireAuth(config)
      const headers = await pipelineAuthHeaders(auth, "pipe-123")
      const client = new CielClient(config)

      const data = await client.executePipeline("pipe-123", { threshold: 2000 }, headers)

      expect(data.id).toBe("exec-456")
      expect(data.status).toBe("completed")

      expect(fetchCalls()[0][0]).toBe("http://localhost:3001/api/pipelines/pipe-123/execute")
      const body = JSON.parse((fetchCalls()[0][1] as RequestInit).body as string)
      expect(body.input.threshold).toBe(2000)
    })
  })

  describe("history", () => {
    it("fetches execution history with pagination", async () => {
      mockFetch(200, {
        executions: [
          {
            id: "exec-1",
            pipelineId: "pipe-123",
            status: "completed",
            results: {},
            startedAt: "2026-03-01T00:00:00Z",
            completedAt: "2026-03-01T00:00:05Z",
          },
        ],
        total: 1,
      })

      const client = new CielClient(makeConfig())
      const data = await client.pipelineHistory("pipe-123", { page: 1, limit: 5 })

      expect(data.total).toBe(1)
      expect(data.executions).toHaveLength(1)
      expect(data.executions[0].status).toBe("completed")

      const url = fetchCalls()[0][0] as string
      expect(url).toContain("page=1")
      expect(url).toContain("limit=5")
    })
  })

  describe("list", () => {
    it("fetches pipelines with filters", async () => {
      mockFetch(200, {
        pipelines: [PIPELINE_RESPONSE],
        total: 1,
      })

      const client = new CielClient(makeConfig())
      const data = await client.listPipelines({ active: true })

      expect(data.total).toBe(1)
      expect(data.pipelines[0].name).toBe("ETH Monitor Pipeline")

      const url = fetchCalls()[0][0] as string
      expect(url).toContain("active=true")
    })
  })
})
