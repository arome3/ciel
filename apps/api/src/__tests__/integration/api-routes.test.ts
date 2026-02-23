import { describe, test, expect, mock, beforeAll, beforeEach, afterAll } from "bun:test"
import { resolve } from "path"
import type { Express } from "express"

// ─────────────────────────────────────────────
// Mocks — same boundaries as simulate-route.test.ts
// Two levels up from integration/ to reach src/
// ─────────────────────────────────────────────

const SRC = resolve(import.meta.dir, "../..")

// ── Realistic workflow fixtures (as DB would return — JSON strings, not parsed) ──

const SEED_WORKFLOWS = [
  {
    id: "00000000-0000-0000-0000-000000000001",
    name: "ETH Price Alert",
    description: "Monitors ETH/USD price and alerts when below threshold",
    prompt: "Monitor ETH price and alert when below 3000",
    templateId: 1,
    templateName: "Cron Price Monitor",
    category: "core-defi",
    priceUsdc: 5000,
    capabilities: '["price-feed","alert"]',
    chains: '["base-sepolia"]',
    totalExecutions: 128,
    successfulExecutions: 125,
    ownerAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    published: true,
    code: "// workflow code",
    config: '{"schedule":"* * * * *","threshold":3000}',
    consumerSol: null,
    simulationSuccess: true,
    simulationTrace: null,
    simulationDuration: 450,
    onchainWorkflowId: null,
    publishTxHash: null,
    donWorkflowId: null,
    deployStatus: "none",
    inputSchema: null,
    outputSchema: null,
    x402Endpoint: null,
    createdAt: "2026-02-20 10:00:00",
    updatedAt: "2026-02-20 10:00:00",
  },
  {
    id: "00000000-0000-0000-0000-000000000002",
    name: "AI Consensus Oracle",
    description: "Multi-AI consensus for price feeds",
    prompt: "Build a multi-AI consensus oracle for price feeds",
    templateId: 5,
    templateName: "Multi-AI Consensus",
    category: "ai-powered",
    priceUsdc: 10000,
    capabilities: '["price-feed","multi-ai","evmWrite"]',
    chains: '["base-sepolia"]',
    totalExecutions: 42,
    successfulExecutions: 40,
    ownerAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    published: true,
    code: "// consensus code",
    config: '{"aiModels":["gpt-4o","claude"]}',
    consumerSol: null,
    simulationSuccess: true,
    simulationTrace: '["step1","step2"]',
    simulationDuration: 820,
    onchainWorkflowId: "0xabc123",
    publishTxHash: "0xdef456",
    donWorkflowId: "don-42",
    deployStatus: "deployed",
    inputSchema: '{"type":"object"}',
    outputSchema: '{"type":"number"}',
    x402Endpoint: null,
    createdAt: "2026-02-21 10:00:00",
    updatedAt: "2026-02-21 10:00:00",
  },
]

// ── Default orchestrator result (for generate route tests) ──

const DEFAULT_RESULT = {
  workflowId: "00000000-0000-0000-0000-000000000042",
  code: '// generated workflow\nimport { handler } from "@chainlink/cre-sdk"',
  configJson: '{"apiUrl":"https://api.coingecko.com"}',
  explanation: "Monitors price via cron trigger",
  consumerSol: null,
  intent: {
    triggerType: "cron",
    confidence: 0.95,
    dataSources: ["price-feed"],
    actions: ["alert"],
    chains: ["base-sepolia"],
  },
  template: {
    templateId: 1,
    templateName: "Cron Price Monitor",
    category: "core-defi",
    confidence: 0.92,
  },
  validation: { valid: true, errors: [] },
  fallback: false,
}

const FALLBACK_RESULT = {
  ...DEFAULT_RESULT,
  workflowId: "00000000-0000-0000-0000-000000000099",
  fallback: true,
  explanation: "Using fallback template",
}

let mockGenerateWorkflow = mock(() => Promise.resolve(DEFAULT_RESULT))

// ── Orchestrator mock (direct dependency of generate route) ──
mock.module(resolve(SRC, "services/ai-engine/orchestrator.ts"), () => ({
  generateWorkflow: (...args: any[]) => mockGenerateWorkflow(...args),
}))

// ── Config mock ──
mock.module(resolve(SRC, "config.ts"), () => ({
  config: {
    DATABASE_PATH: ":memory:",
    CRE_CLI_PATH: "echo",
    OPENAI_API_KEY: "sk-test",
    ANTHROPIC_API_KEY: "sk-ant-test",
    GEMINI_API_KEY: "test",
    PRIVATE_KEY: "0xtest",
    BASE_SEPOLIA_RPC_URL: "http://localhost:8545",
    REGISTRY_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000000",
    CONSUMER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000000",
    WALLET_ADDRESS: "0x0000000000000000000000000000000000000000",
    X402_FACILITATOR_URL: "http://localhost:8080",
    API_PORT: 0,
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

// ── DB mock — differentiates list/count/get query shapes ──
let mockDbThrows = false
let mockListRows: any[] = SEED_WORKFLOWS
let mockGetRow: any = undefined

const mockExec = mock((sql: string) => {
  if (mockDbThrows) throw new Error("DB unreachable")
})

const mockDb = {
  select: mock((...args: any[]) => {
    // Count query: select({ count: ... }) — has args
    if (args.length > 0) {
      return {
        from: mock(() => ({
          where: mock(() => Promise.resolve([{ count: mockListRows.length }])),
        })),
      }
    }
    // List/get query: select() — no args
    return {
      from: mock(() => ({
        where: mock(() => ({
          orderBy: mock(() => ({
            limit: mock(() => ({
              offset: mock(() => Promise.resolve(mockListRows)),
            })),
          })),
          get: mock(() => Promise.resolve(mockGetRow)),
        })),
      })),
    }
  }),
  insert: mock(() => ({ values: mock(() => Promise.resolve()) })),
  update: mock(() => ({ set: mock(() => ({ where: mock(() => Promise.resolve()) })) })),
}

mock.module(resolve(SRC, "db/index.ts"), () => ({
  db: mockDb,
  sqlite: {
    exec: (...args: unknown[]) => mockExec(args[0] as string),
    prepare: mock(() => ({
      get: mock(() => undefined),
      all: mock(() => []),
      run: mock(() => {}),
    })),
  },
}))

mock.module(resolve(SRC, "db/schema.ts"), () => ({
  workflows: {
    id: "id",
    name: "name",
    description: "description",
    category: "category",
    priceUsdc: "price_usdc",
    capabilities: "capabilities",
    chains: "chains",
    totalExecutions: "total_executions",
    successfulExecutions: "successful_executions",
    ownerAddress: "owner_address",
    published: "published",
    code: "code",
    config: "config",
    simulationTrace: "simulation_trace",
    inputSchema: "input_schema",
    outputSchema: "output_schema",
    donWorkflowId: "don_workflow_id",
    deployStatus: "deploy_status",
  },
  executions: { id: "id" },
  events: { id: "id", type: "type", data: "data" },
  pipelines: { id: "id" },
  pipelineExecutions: { id: "id" },
}))

// ── Rate limiter mock (bypass all) ──
mock.module(resolve(SRC, "middleware/rate-limiter.ts"), () => ({
  simulateLimiter: (_req: any, _res: any, next: any) => next(),
  generateLimiter: (_req: any, _res: any, next: any) => next(),
  executeLimiter: (_req: any, _res: any, next: any) => next(),
  defaultLimiter: (_req: any, _res: any, next: any) => next(),
  discoverLimiter: (_req: any, _res: any, next: any) => next(),
  publishLimiter: (_req: any, _res: any, next: any) => next(),
  eventsSseLimiter: (_req: any, _res: any, next: any) => next(),
  pipelineLimiter: (_req: any, _res: any, next: any) => next(),
}))

// ── Emitter mock ──
mock.module(resolve(SRC, "services/events/emitter.ts"), () => ({
  emitEvent: mock(() => {}),
  getAgentChannel: mock(() => ({ sessionCount: 0, register: () => {}, deregister: () => {} })),
  getConnectedClientCount: mock(() => 2),
}))

mock.module(resolve(SRC, "services/events/emitter-core.ts"), () => ({
  createEmitterFromDeps: () => ({
    emitEvent: () => {},
    getAgentChannel: () => ({ sessionCount: 0 }),
    getConnectedClientCount: () => 2,
  }),
}))

// ─────────────────────────────────────────────
// Infrastructure mocks — these modules are NOT tested here but are
// transitively imported when loading route files. Without mocks,
// real blockchain/CRE/x402/pipeline modules would fail to initialize
// in the test environment (missing RPC, CLI binary, etc.).
// ─────────────────────────────────────────────

// ── CRE / compiler / deployer mocks ──
mock.module(resolve(SRC, "services/cre/compiler.ts"), () => ({
  simulateWorkflow: mock(() => Promise.resolve({ success: true, executionTrace: [], duration: 0, errors: [], warnings: [], rawOutput: "" })),
  checkCRECli: mock(() => Promise.resolve(true)),
  _getSimState: mock(() => ({ activeSimCount: 0, queueLength: 0 })),
}))

mock.module(resolve(SRC, "services/cre/deployer.ts"), () => ({
  deployWorkflow: mock(() => Promise.resolve({ success: true, donWorkflowId: "test" })),
  handleDeployResult: mock(() => {}),
  _getDeployState: mock(() => ({ activeCount: 0, queueLength: 0 })),
  parseDonWorkflowId: mock(() => "test"),
}))

mock.module(resolve(SRC, "services/cre/dep-cache.ts"), () => ({
  warmDependencyCache: mock(() => Promise.resolve()),
  linkCachedDeps: mock(() => Promise.resolve(true)),
  cleanupDependencyCache: mock(() => Promise.resolve()),
}))

mock.module(resolve(SRC, "services/cre/deploy-sweep.ts"), () => ({
  sweepStalePendingDeploys: mock(() => Promise.resolve(0)),
}))

mock.module(resolve(SRC, "services/pipeline/execution-sweep.ts"), () => ({
  sweepStaleExecutions: mock(() => Promise.resolve(0)),
}))

// ── LRU Cache mock ──
mock.module(resolve(SRC, "lib/lru-cache.ts"), () => ({
  LRUCache: class {
    private _map = new Map()
    get(key: string) { return this._map.get(key) }
    set(key: string, value: any) { this._map.set(key, value) }
    clear() { this._map.clear() }
    get size() { return this._map.size }
  },
}))

// ── Blockchain / x402 / discovery mocks ──
mock.module(resolve(SRC, "services/blockchain/registry.ts"), () => ({
  publishToRegistry: mock(() => Promise.resolve({ txHash: "0xabc", onchainWorkflowId: "1" })),
  recordExecution: mock(() => Promise.resolve()),
  updateWorkflow: mock(() => Promise.resolve()),
  deactivateWorkflow: mock(() => Promise.resolve()),
  reactivateWorkflow: mock(() => Promise.resolve()),
  addAuthorizedSender: mock(() => Promise.resolve()),
  removeAuthorizedSender: mock(() => Promise.resolve()),
  getWorkflowFromRegistry: mock(() => Promise.resolve(null)),
  searchWorkflowsByCategory: mock(() => Promise.resolve([])),
  searchWorkflowsByChain: mock(() => Promise.resolve([])),
  getAllWorkflowIds: mock(() => Promise.resolve([])),
  getCreatorWorkflows: mock(() => Promise.resolve([])),
}))

mock.module(resolve(SRC, "services/x402/middleware.ts"), () => ({
  conditionalPayment: (_req: any, _res: any, next: any) => next(),
}))

mock.module(resolve(SRC, "services/x402/bazaar.ts"), () => ({
  registerBazaarExtension: () => {},
  getWorkflowDiscoveryExtension: () => ({}),
}))

mock.module(resolve(SRC, "services/discovery/client.ts"), () => ({
  discoverWorkflows: mock(() => Promise.resolve([])),
}))

mock.module(resolve(SRC, "middleware/owner-verify.ts"), () => ({
  ownerVerify: (_req: any, _res: any, next: any) => next(),
}))

// ── OpenAI mock (transitive dep — not tested, just prevents import errors) ──
mock.module("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { parse: mock(() => Promise.resolve({ choices: [] })) } }
  },
}))

// ── Context7 mock ──
mock.module(resolve(SRC, "services/ai-engine/context7-client.ts"), () => ({
  getContext7CREDocs: () => Promise.resolve(""),
  _resetContext7Cache: () => {},
}))

// ── Pipeline service mocks ──
mock.module(resolve(SRC, "services/pipeline/schema-checker.ts"), () => ({
  checkSchemaCompatibility: mock(() => ({ compatible: true, score: 1, issues: [] })),
  suggestFieldMappings: mock(() => []),
}))

mock.module(resolve(SRC, "services/pipeline/pricing.ts"), () => ({
  calculatePipelinePrice: mock(() => ({ totalUsdc: 0, steps: [] })),
  getPriceBreakdown: mock(() => []),
}))

mock.module(resolve(SRC, "services/pipeline/executor.ts"), () => ({
  executePipeline: mock(() => Promise.resolve({ status: "completed", steps: [] })),
  mapStepInput: mock(() => ({})),
  generateSyntheticOutput: mock(() => ({})),
}))

mock.module(resolve(SRC, "services/pipeline/metrics.ts"), () => ({
  getMetrics: mock(() => ({
    totalExecutions: 0,
    successfulExecutions: 0,
    failedExecutions: 0,
    totalSteps: 0,
    successfulSteps: 0,
    failedSteps: 0,
    avgDurationMs: 0,
    failureRate: 0,
  })),
  recordExecution: mock(() => {}),
  recordStepResult: mock(() => {}),
  _resetMetrics: mock(() => {}),
}))

// ── better-sse mock ──
mock.module("better-sse", () => ({
  createChannel: () => ({
    sessionCount: 0,
    register: () => {},
    deregister: () => {},
  }),
  createSession: () => Promise.resolve({
    lastId: null,
    push: () => {},
  }),
}))

// ── viem mock ──
mock.module("viem", () => ({
  verifyMessage: mock(() => Promise.resolve(true)),
  createPublicClient: mock(() => ({})),
  createWalletClient: mock(() => ({})),
  http: mock(() => ({})),
  parseAbi: mock(() => []),
  encodeFunctionData: mock(() => "0x"),
  decodeFunctionResult: mock(() => null),
  getAddress: mock((addr: string) => addr),
  isAddress: mock(() => true),
}))

// ─────────────────────────────────────────────
// Build test Express app (NOT importing index.ts which calls app.listen)
// ─────────────────────────────────────────────

let baseUrl: string
let server: any

beforeAll(async () => {
  const express = (await import("express")).default
  const { errorHandler } = await import("../../middleware/error-handler")
  const { requestId } = await import("../../middleware/request-id")

  const healthRouter = (await import("../../routes/health")).default
  const workflowsRouter = (await import("../../routes/workflows")).default
  const generateRouter = (await import("../../routes/generate")).default

  const app = express()
  app.use(express.json())
  app.use(requestId)
  app.use("/api", healthRouter)
  app.use("/api", workflowsRouter)
  app.use("/api", generateRouter)
  app.use(errorHandler)

  // OS-assigned random port
  server = app.listen(0)
  const addr = server.address()
  const port = typeof addr === "object" && addr ? addr.port : 0
  baseUrl = `http://127.0.0.1:${port}`
})

afterAll(() => {
  if (server) server.close()
})

beforeEach(() => {
  mockDbThrows = false
  mockListRows = [...SEED_WORKFLOWS]
  mockGetRow = undefined
  mockGenerateWorkflow = mock(() => Promise.resolve({ ...DEFAULT_RESULT }))
})

// ─────────────────────────────────────────────
// Health endpoint
// ─────────────────────────────────────────────

describe("integration — GET /api/health", () => {
  test("returns 200 with expected shape when DB is healthy", async () => {
    const res = await fetch(`${baseUrl}/api/health`)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.status).toBe("ok")
    expect(body.timestamp).toBeDefined()
    expect(body.version).toBe("0.1.0")
    expect(typeof body.uptime).toBe("number")
    expect(body.db).toBe("connected")
    expect(typeof body.sseClients).toBe("number")
  })

  test("returns 503 when DB is unreachable", async () => {
    mockDbThrows = true
    const res = await fetch(`${baseUrl}/api/health`)
    expect(res.status).toBe(503)

    const body = await res.json()
    expect(body.status).toBe("degraded")
    expect(body.db).toBe("unreachable")
  })
})

// ─────────────────────────────────────────────
// Workflows — list
// ─────────────────────────────────────────────

describe("integration — GET /api/workflows", () => {
  test("returns seeded data with parsed JSON arrays", async () => {
    const res = await fetch(`${baseUrl}/api/workflows`)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.workflows).toHaveLength(2)

    const first = body.workflows[0]
    expect(first.id).toBe(SEED_WORKFLOWS[0].id)
    expect(first.name).toBe("ETH Price Alert")
    expect(first.category).toBe("core-defi")
    // capabilities/chains should be parsed from JSON strings into arrays
    expect(Array.isArray(first.capabilities)).toBe(true)
    expect(first.capabilities).toEqual(["price-feed", "alert"])
    expect(Array.isArray(first.chains)).toBe(true)
    expect(first.chains).toEqual(["base-sepolia"])
  })

  test("response has correct pagination metadata", async () => {
    const res = await fetch(`${baseUrl}/api/workflows`)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.total).toBe(2)
    expect(body.page).toBe(1)
    expect(body.limit).toBe(20)
  })

  test("workflows ordered by totalExecutions descending", async () => {
    const res = await fetch(`${baseUrl}/api/workflows`)
    const body = await res.json()

    // Seed data: workflow 1 has 128 executions, workflow 2 has 42
    // Mock returns them in array order; route preserves order from DB
    expect(body.workflows[0].totalExecutions).toBeGreaterThanOrEqual(
      body.workflows[1].totalExecutions,
    )
  })
})

// ─────────────────────────────────────────────
// Workflows — get by ID
// ─────────────────────────────────────────────

describe("integration — GET /api/workflows/:id", () => {
  test("returns full workflow with parsed config, capabilities, chains", async () => {
    mockGetRow = SEED_WORKFLOWS[1] // has simulationTrace + inputSchema + outputSchema
    const res = await fetch(`${baseUrl}/api/workflows/${SEED_WORKFLOWS[1].id}`)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.id).toBe(SEED_WORKFLOWS[1].id)
    expect(body.name).toBe("AI Consensus Oracle")
    // JSON fields should be parsed
    expect(body.capabilities).toEqual(["price-feed", "multi-ai", "evmWrite"])
    expect(body.chains).toEqual(["base-sepolia"])
    expect(body.config).toEqual({ aiModels: ["gpt-4o", "claude"] })
    expect(body.simulationTrace).toEqual(["step1", "step2"])
    expect(body.inputSchema).toBe('{"type":"object"}')
    expect(body.outputSchema).toBe('{"type":"number"}')
  })

  test("null-coalesces simulationTrace, inputSchema, outputSchema", async () => {
    mockGetRow = SEED_WORKFLOWS[0] // all three are null
    const res = await fetch(`${baseUrl}/api/workflows/${SEED_WORKFLOWS[0].id}`)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.simulationTrace).toBeNull()
    expect(body.inputSchema).toBeNull()
    expect(body.outputSchema).toBeNull()
  })

  test("returns 404 for nonexistent workflow ID", async () => {
    // mockGetRow defaults to undefined in beforeEach
    const res = await fetch(`${baseUrl}/api/workflows/00000000-0000-0000-0000-000000000099`)
    expect(res.status).toBe(404)

    const body = await res.json()
    expect(body.error.code).toBe("WORKFLOW_NOT_FOUND")
  })
})

// ─────────────────────────────────────────────
// Generate endpoint — validation
// ─────────────────────────────────────────────

const VALID_PROMPT = "Monitor ETH price every 5 minutes and alert when below $2000"

describe("integration — POST /api/generate (validation)", () => {
  test("returns 400 for empty body", async () => {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)

    const body = await res.json()
    expect(body.error.code).toBe("INVALID_INPUT")
  })

  test("returns 400 for short prompt (<10 chars)", async () => {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "short" }),
    })
    expect(res.status).toBe(400)

    const body = await res.json()
    expect(body.error.code).toBe("INVALID_INPUT")
  })

  test("includes X-Request-Id header in response", async () => {
    const res = await fetch(`${baseUrl}/api/health`)
    expect(res.headers.get("X-Request-Id")).toBeTruthy()
  })
})

// ─────────────────────────────────────────────
// Generate endpoint — happy path
// ─────────────────────────────────────────────

describe("integration — POST /api/generate (happy path)", () => {
  test("returns 200 with all GenerateResponse fields", async () => {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: VALID_PROMPT }),
    })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.workflowId).toBeDefined()
    expect(typeof body.workflowId).toBe("string")
    expect(body.code).toBeDefined()
    expect(body.configJson).toBeDefined()
    expect(body.explanation).toBeDefined()
    expect(body).toHaveProperty("intent")
    expect(body).toHaveProperty("template")
    expect(body).toHaveProperty("validation")
    expect(typeof body.fallback).toBe("boolean")
  })

  test("passes X-Owner-Address header through to orchestrator", async () => {
    let receivedOwner: string | undefined
    mockGenerateWorkflow = mock((_prompt: any, owner: any) => {
      receivedOwner = owner
      return Promise.resolve({ ...DEFAULT_RESULT })
    })

    const ownerAddr = "0x1234567890abcdef1234567890abcdef12345678"
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Owner-Address": ownerAddr,
      },
      body: JSON.stringify({ prompt: VALID_PROMPT }),
    })
    expect(res.status).toBe(200)
    expect(receivedOwner).toBe(ownerAddr)
  })

  test("includes X-Request-Id in generate response", async () => {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: VALID_PROMPT }),
    })
    expect(res.headers.get("X-Request-Id")).toBeTruthy()
  })

  test("respects upstream X-Request-Id", async () => {
    const customId = "test-request-id-12345"
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-Id": customId,
      },
      body: JSON.stringify({ prompt: VALID_PROMPT }),
    })
    expect(res.headers.get("X-Request-Id")).toBe(customId)
  })
})

// ─────────────────────────────────────────────
// Generate endpoint — fallback path
// ─────────────────────────────────────────────

describe("integration — POST /api/generate (fallback)", () => {
  test("returns 200 with fallback=true when orchestrator falls back", async () => {
    mockGenerateWorkflow = mock(() =>
      Promise.resolve({ ...FALLBACK_RESULT }),
    )

    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: VALID_PROMPT }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.fallback).toBe(true)
    expect(body.workflowId).toBeDefined()
    expect(body.code).toBeDefined()
  })

  test("returns 500 when orchestrator throws unexpected error", async () => {
    mockGenerateWorkflow = mock(() =>
      Promise.reject(new Error("Unexpected internal failure")),
    )

    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: VALID_PROMPT }),
    })

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error.code).toBe("INTERNAL_ERROR")
  })
})
