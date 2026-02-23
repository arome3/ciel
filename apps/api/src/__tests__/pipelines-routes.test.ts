import { describe, test, expect, mock, beforeEach } from "bun:test"
import { resolve } from "path"

// ─────────────────────────────────────────────
// Mocks — external boundaries only
// ─────────────────────────────────────────────

const SRC = resolve(import.meta.dir, "..")

// ── Config mock ──
mock.module(resolve(SRC, "config.ts"), () => ({
  config: {
    DATABASE_PATH: ":memory:",
    NODE_ENV: "test",
    WALLET_ADDRESS: "0xTestWallet",
    CONSUMER_CONTRACT_ADDRESS: "0xConsumer",
    API_PORT: 3001,
    NEXT_PUBLIC_API_URL: "http://localhost:3001",
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

// ── Emitter mock ──
mock.module(resolve(SRC, "services/events/emitter.ts"), () => ({
  emitEvent: () => {},
}))

// ── Simulator mock ──
mock.module(resolve(SRC, "services/cre/compiler.ts"), () => ({
  simulateWorkflow: () =>
    Promise.resolve({
      success: true,
      executionTrace: [],
      duration: 100,
      errors: [],
      warnings: [],
      rawOutput: "",
    }),
}))

// ── viem mock ──
// Track the address to conditionally verify
let viemVerifyResult = true
mock.module("viem", () => ({
  verifyMessage: () => Promise.resolve(viemVerifyResult),
}))

// ── DB mock ──
const TEST_UUID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"
const TEST_OWNER = "0x1234567890abcdef1234567890abcdef12345678"
const WRONG_OWNER = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"

const TEST_PIPELINE = {
  id: TEST_UUID,
  name: "Test Pipeline",
  description: "A test pipeline description",
  ownerAddress: TEST_OWNER,
  steps: JSON.stringify([
    { id: "s1", workflowId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5e", position: 0 },
  ]),
  totalPrice: "50000",
  isActive: true,
  executionCount: 0,
  createdAt: "2026-02-23T00:00:00.000Z",
  updatedAt: "2026-02-23T00:00:00.000Z",
}

const TEST_EXECUTION = {
  id: "exec-1",
  pipelineId: TEST_UUID,
  agentAddress: null,
  totalPaid: null,
  status: "completed",
  stepResults: "[]",
  triggerInput: "{}",
  finalOutput: "{}",
  duration: 500,
  createdAt: "2026-02-23T00:00:00.000Z",
}

let mockPipelineSelectResult: any = TEST_PIPELINE
let mockPipelineListResult: any[] = [TEST_PIPELINE]
let mockExecutionListResult: any[] = [TEST_EXECUTION]
let mockWorkflowSelectResult: any = null
let mockWorkflowListResult: any[] = []
let lastInsertValues: any = null

// Drizzle's .where() returns a thenable (Promise-like) array result when awaited directly,
// and also exposes .get() for single-row queries. We mock both paths.
function createWhereResult(arrayResult: any[], singleResult: any) {
  const promise = Promise.resolve(arrayResult)
  return Object.assign(promise, {
    get: mock(() => Promise.resolve(singleResult)),
    orderBy: mock(() => ({
      limit: mock(() => ({
        offset: mock(() => Promise.resolve(arrayResult)),
      })),
    })),
  })
}

const mockDb = {
  select: mock((...args: any[]) => ({
    from: mock((table: any) => ({
      where: mock((...whereArgs: any[]) =>
        createWhereResult(mockWorkflowListResult, mockPipelineSelectResult),
      ),
      orderBy: mock(() => ({
        limit: mock(() => ({
          offset: mock(() => Promise.resolve(mockPipelineListResult)),
        })),
      })),
    })),
  })),
  insert: mock(() => ({
    values: mock((vals: any) => {
      lastInsertValues = vals
      return {
        returning: mock(() => Promise.resolve([{ ...vals, id: TEST_UUID }])),
      }
    }),
  })),
  update: mock(() => ({
    set: mock(() => ({
      where: mock(() => Promise.resolve()),
    })),
  })),
}

mock.module(resolve(SRC, "db/index.ts"), () => ({
  db: mockDb,
}))

mock.module(resolve(SRC, "db/schema.ts"), () => {
  return {
    workflows: {
      id: "id",
      name: "name",
      description: "description",
      category: "category",
      priceUsdc: "price_usdc",
      published: "published",
      inputSchema: "input_schema",
      outputSchema: "output_schema",
      totalExecutions: "total_executions",
      ownerAddress: "owner_address",
    },
    pipelines: {
      id: "id",
      name: "name",
      ownerAddress: "owner_address",
      isActive: "is_active",
      executionCount: "execution_count",
      createdAt: "created_at",
    },
    pipelineExecutions: {
      id: "id",
      pipelineId: "pipeline_id",
      createdAt: "created_at",
    },
    executions: {},
  }
})

// ── Rate limiter passthrough ──
mock.module(resolve(SRC, "middleware/rate-limiter.ts"), () => {
  const passthrough = (_req: any, _res: any, next: any) => next()
  return {
    pipelineLimiter: passthrough,
    generateLimiter: passthrough,
    executeLimiter: passthrough,
    simulateLimiter: passthrough,
    defaultLimiter: passthrough,
    discoverLimiter: passthrough,
    publishLimiter: passthrough,
    eventsSseLimiter: passthrough,
  }
})

// ── Schema checker mock ──
mock.module(resolve(SRC, "services/pipeline/schema-checker.ts"), () => ({
  checkSchemaCompatibility: () => ({
    compatible: true,
    score: 0.9,
    matchedFields: [{ sourceField: "price", targetField: "value", confidence: 1.0 }],
    unmatchedRequired: [],
    suggestions: [{ sourceField: "price", targetField: "value", confidence: 1.0 }],
  }),
  suggestFieldMappings: () => [
    { sourceField: "price", targetField: "value", confidence: 1.0 },
  ],
}))

// ── Pricing mock ──
mock.module(resolve(SRC, "services/pipeline/pricing.ts"), () => ({
  calculatePipelinePrice: () => Promise.resolve("50000"),
  getPriceBreakdown: () =>
    Promise.resolve([
      {
        stepId: "s1",
        workflowId: "wf-1",
        workflowName: "Price Feed",
        priceUsdc: 50000,
        creatorAddress: "0xOwner1",
        position: 0,
      },
    ]),
}))

// ── Metrics mock ──
mock.module(resolve(SRC, "services/pipeline/metrics.ts"), () => ({
  getMetrics: () => ({
    totalExecutions: 0,
    completedExecutions: 0,
    failedExecutions: 0,
    partialExecutions: 0,
    totalDurationMs: 0,
    stepExecutions: 0,
    stepFailures: 0,
    lastExecutionAt: null,
    avgDurationMs: 0,
    failureRate: 0,
  }),
  recordExecution: () => {},
  recordStepResult: () => {},
}))

// ── Executor mock ──
mock.module(resolve(SRC, "services/pipeline/executor.ts"), () => ({
  executePipeline: () =>
    Promise.resolve({
      executionId: "exec-new",
      pipelineId: TEST_UUID,
      status: "completed",
      stepResults: [],
      finalOutput: { result: 42 },
      duration: 500,
    }),
}))

// ─────────────────────────────────────────────
// Import Express app pieces after mocks
// ─────────────────────────────────────────────

const express = (await import("express")).default
const pipelinesRouter = (await import("../routes/pipelines")).default

// Build minimal test app
const app = express()
app.use(express.json())
app.use("/api", pipelinesRouter)

// Simple error handler for tests
app.use((err: any, _req: any, res: any, _next: any) => {
  const status = err.statusCode ?? 500
  res.status(status).json({
    error: { code: err.code ?? "INTERNAL_ERROR", message: err.message },
  })
})

// ─────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────

async function req(method: string, path: string, body?: any, headers?: Record<string, string>) {
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", ...headers },
  }
  if (body) init.body = JSON.stringify(body)

  // Use Bun's built-in fetch against express
  const server = Bun.serve({
    port: 0,
    fetch: (request) =>
      new Promise<Response>((resolve) => {
        const url = new URL(request.url)

        // Convert to express-compatible request
        const incoming = new (require("http").IncomingMessage)(null as any)
        incoming.method = request.method
        incoming.url = url.pathname + url.search
        incoming.headers = Object.fromEntries(request.headers.entries())

        const outgoing = new (require("http").ServerResponse)(incoming)
        outgoing.writeHead = (statusCode: number, headers?: any) => {
          outgoing.statusCode = statusCode
          if (headers) {
            for (const [k, v] of Object.entries(headers)) {
              outgoing.setHeader(k, v as string)
            }
          }
          return outgoing
        }

        let responseBody = ""
        const origEnd = outgoing.end.bind(outgoing)
        outgoing.end = (chunk?: any) => {
          if (chunk) responseBody += chunk.toString()
          resolve(
            new Response(responseBody, {
              status: outgoing.statusCode,
              headers: { "Content-Type": "application/json" },
            }),
          )
          return outgoing
        }

        outgoing.write = (chunk: any) => {
          responseBody += chunk.toString()
          return true
        }

        // Feed body to express
        request.text().then((text) => {
          incoming.push(text)
          incoming.push(null)
          app(incoming, outgoing)
        })
      }),
  })

  try {
    const res = await fetch(`http://localhost:${server.port}${path}`, init)
    const json = await res.json().catch(() => null)
    return { status: res.status, body: json }
  } finally {
    server.stop()
  }
}

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

describe("Pipeline Routes", () => {
  beforeEach(() => {
    mockPipelineSelectResult = TEST_PIPELINE
    mockPipelineListResult = [TEST_PIPELINE]
    lastInsertValues = null
    viemVerifyResult = true
  })

  describe("POST /api/pipelines", () => {
    test("creates pipeline with valid body", async () => {
      const res = await req("POST", "/api/pipelines", {
        name: "My Pipeline",
        description: "A composable workflow pipeline",
        ownerAddress: TEST_OWNER,
        steps: [
          {
            id: "s1",
            workflowId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5e",
            position: 0,
          },
        ],
      })

      expect(res.status).toBe(201)
      expect(res.body).toBeTruthy()
    })

    test("rejects invalid body (missing name)", async () => {
      const res = await req("POST", "/api/pipelines", {
        description: "Missing name field",
        ownerAddress: TEST_OWNER,
        steps: [
          { id: "s1", workflowId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5e", position: 0 },
        ],
      })

      // Zod should reject — 400 or 500 depending on error handler
      expect(res.status).toBeGreaterThanOrEqual(400)
    })

    test("rejects empty steps", async () => {
      const res = await req("POST", "/api/pipelines", {
        name: "My Pipeline",
        description: "A composable workflow pipeline",
        ownerAddress: TEST_OWNER,
        steps: [],
      })

      expect(res.status).toBeGreaterThanOrEqual(400)
    })

    test("rejects invalid ownerAddress (not Ethereum format)", async () => {
      const res = await req("POST", "/api/pipelines", {
        name: "My Pipeline",
        description: "A composable workflow pipeline",
        ownerAddress: "not-an-eth-address",
        steps: [
          { id: "s1", workflowId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5e", position: 0 },
        ],
      })

      expect(res.status).toBeGreaterThanOrEqual(400)
    })

    test("rejects ownerAddress that is too short", async () => {
      const res = await req("POST", "/api/pipelines", {
        name: "My Pipeline",
        description: "A composable workflow pipeline",
        ownerAddress: "0x1234",
        steps: [
          { id: "s1", workflowId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5e", position: 0 },
        ],
      })

      expect(res.status).toBeGreaterThanOrEqual(400)
    })
  })

  describe("GET /api/pipelines", () => {
    test("returns paginated list", async () => {
      const res = await req("GET", "/api/pipelines")

      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty("pipelines")
      expect(res.body).toHaveProperty("total")
      expect(res.body).toHaveProperty("page")
    })
  })

  describe("GET /api/pipelines/suggest", () => {
    test("returns suggestions array", async () => {
      const res = await req("GET", "/api/pipelines/suggest")

      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty("suggestions")
    })
  })

  describe("GET /api/pipelines/metrics", () => {
    test("returns metrics object", async () => {
      const res = await req("GET", "/api/pipelines/metrics")

      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty("totalExecutions")
      expect(res.body).toHaveProperty("avgDurationMs")
      expect(res.body).toHaveProperty("failureRate")
    })
  })

  describe("POST /api/pipelines/check-compatibility", () => {
    test("returns compatibility result", async () => {
      const res = await req("POST", "/api/pipelines/check-compatibility", {
        sourceWorkflowId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5e",
        targetWorkflowId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5f",
      })

      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty("compatible")
      expect(res.body).toHaveProperty("score")
    })

    test("rejects invalid workflow IDs", async () => {
      const res = await req("POST", "/api/pipelines/check-compatibility", {
        sourceWorkflowId: "not-a-uuid",
        targetWorkflowId: "also-not-uuid",
      })

      expect(res.status).toBeGreaterThanOrEqual(400)
    })
  })

  describe("GET /api/pipelines/:id", () => {
    test("returns pipeline with price breakdown", async () => {
      const res = await req("GET", `/api/pipelines/${TEST_UUID}`)

      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty("priceBreakdown")
    })

    test("rejects invalid UUID format", async () => {
      const res = await req("GET", "/api/pipelines/not-a-uuid")

      expect(res.status).toBe(400)
    })
  })

  describe("PUT /api/pipelines/:id", () => {
    test("rejects without auth headers → 401", async () => {
      const res = await req("PUT", `/api/pipelines/${TEST_UUID}`, {
        name: "Updated Pipeline Name",
      })

      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe("UNAUTHORIZED")
    })

    test("rejects without timestamp → 401", async () => {
      const res = await req(
        "PUT",
        `/api/pipelines/${TEST_UUID}`,
        { name: "Updated Pipeline Name" },
        {
          "x-owner-address": TEST_OWNER,
          "x-owner-signature": "0xvalidsig",
        },
      )

      expect(res.status).toBe(401)
    })

    test("rejects expired timestamp → 401", async () => {
      const expiredTs = String(Date.now() - 10 * 60 * 1000) // 10 min ago
      const res = await req(
        "PUT",
        `/api/pipelines/${TEST_UUID}`,
        { name: "Updated Pipeline Name" },
        {
          "x-owner-address": TEST_OWNER,
          "x-owner-signature": "0xvalidsig",
          "x-owner-timestamp": expiredTs,
        },
      )

      expect(res.status).toBe(401)
    })

    test("rejects wrong owner → 403", async () => {
      const res = await req(
        "PUT",
        `/api/pipelines/${TEST_UUID}`,
        { name: "Updated Pipeline Name" },
        {
          "x-owner-address": WRONG_OWNER,
          "x-owner-signature": "0xfakesig",
          "x-owner-timestamp": String(Date.now()),
        },
      )

      expect(res.status).toBe(403)
    })

    test("allows update with valid owner auth and timestamp", async () => {
      const res = await req(
        "PUT",
        `/api/pipelines/${TEST_UUID}`,
        { name: "Updated Pipeline Name" },
        {
          "x-owner-address": TEST_OWNER,
          "x-owner-signature": "0xvalidsig",
          "x-owner-timestamp": String(Date.now()),
        },
      )

      expect(res.status).toBe(200)
    })
  })

  describe("DELETE /api/pipelines/:id", () => {
    test("rejects without auth headers → 401", async () => {
      const res = await req("DELETE", `/api/pipelines/${TEST_UUID}`)

      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe("UNAUTHORIZED")
    })

    test("rejects without timestamp → 401", async () => {
      const res = await req(
        "DELETE",
        `/api/pipelines/${TEST_UUID}`,
        undefined,
        {
          "x-owner-address": TEST_OWNER,
          "x-owner-signature": "0xvalidsig",
        },
      )

      expect(res.status).toBe(401)
    })

    test("rejects wrong owner → 403", async () => {
      const res = await req(
        "DELETE",
        `/api/pipelines/${TEST_UUID}`,
        undefined,
        {
          "x-owner-address": WRONG_OWNER,
          "x-owner-signature": "0xfakesig",
          "x-owner-timestamp": String(Date.now()),
        },
      )

      expect(res.status).toBe(403)
    })

    test("allows delete with valid owner auth and timestamp", async () => {
      const res = await req(
        "DELETE",
        `/api/pipelines/${TEST_UUID}`,
        undefined,
        {
          "x-owner-address": TEST_OWNER,
          "x-owner-signature": "0xvalidsig",
          "x-owner-timestamp": String(Date.now()),
        },
      )

      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty("message")
    })

    test("rejects invalid UUID", async () => {
      const res = await req(
        "DELETE",
        "/api/pipelines/bad-id",
        undefined,
        {
          "x-owner-address": TEST_OWNER,
          "x-owner-signature": "0xvalidsig",
          "x-owner-timestamp": String(Date.now()),
        },
      )

      expect(res.status).toBe(400)
    })
  })

  describe("POST /api/pipelines/:id/execute", () => {
    test("executes pipeline and returns result", async () => {
      const res = await req("POST", `/api/pipelines/${TEST_UUID}/execute`, {
        triggerInput: { price: 100 },
      })

      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty("executionId")
      expect(res.body).toHaveProperty("status")
    })
  })

  describe("GET /api/pipelines/:id/history", () => {
    test("returns paginated execution history", async () => {
      const res = await req("GET", `/api/pipelines/${TEST_UUID}/history`)

      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty("executions")
      expect(res.body).toHaveProperty("total")
    })
  })
})
