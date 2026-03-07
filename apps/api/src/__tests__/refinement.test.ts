import { describe, test, expect, mock, beforeEach, beforeAll } from "bun:test"
import { resolve } from "path"

// ─────────────────────────────────────────────
// Mocks — same boundary-mock pattern as orchestrator.test.ts
// ─────────────────────────────────────────────

const SRC = resolve(import.meta.dir, "..")

// ── Valid CRE workflow code that passes all validation checks ──
const VALID_WORKFLOW_TS = `
import { z } from "zod"
import { cre, Runner, type Runtime, decodeJson } from "@chainlink/cre-sdk"
const configSchema = z.object({ apiUrl: z.string(), schedule: z.string().default("0 */5 * * * *") })
type Config = z.infer<typeof configSchema>
const initWorkflow = (config: Config) => {
  const cron = new cre.capabilities.CronCapability().trigger({ schedule: config.schedule })
  const http = new cre.capabilities.HTTPClient()
  return [cre.handler(cron, (runtime: Runtime<Config>) => {
    const resp = http.sendRequest(runtime, { url: runtime.config.apiUrl, method: "GET" }).result()
    const data = decodeJson(resp.body)
    const alert = data.price < 2000
    return { price: data.price, alert }
  })]
}
export async function main() { const runner = await Runner.newRunner<Config>({ configSchema }); await runner.run(initWorkflow) }
`

const VALID_CONFIG_JSON = '{"apiUrl":"https://api.coingecko.com","schedule":"0 */5 * * * *"}'

const PASSING_SELF_REVIEW = {
  no_async_in_handlers: true,
  imports_valid: true,
  uses_runner_pattern: true,
  uses_cre_handler: true,
  config_via_runtime: true,
  no_nondeterminism: true,
  implements_user_request: true,
  issues_found: "",
}

// ── Refined workflow code (with a configurable threshold) ──
const REFINED_WORKFLOW_TS = VALID_WORKFLOW_TS.replace(
  "const alert = data.price < 2000",
  "const alert = data.price < runtime.config.threshold",
).replace(
  "apiUrl: z.string(), schedule: z.string()",
  "apiUrl: z.string(), threshold: z.number().default(2000), schedule: z.string()",
)
const REFINED_CONFIG_JSON = '{"apiUrl":"https://api.coingecko.com","threshold":2000,"schedule":"0 */5 * * * *"}'

const mockParse = mock(() =>
  Promise.resolve({
    output: [],
    output_parsed: {
      thinking: "Modifying threshold to be configurable...",
      workflow_ts: REFINED_WORKFLOW_TS,
      config_json: REFINED_CONFIG_JSON,
      consumer_sol: null as string | null,
      self_review: PASSING_SELF_REVIEW,
      explanation: "Made threshold configurable via config",
    },
  }),
)

mock.module("openai", () => ({
  default: class MockOpenAI {
    responses = {
      parse: mockParse,
    }
  },
}))

// ── Compile feedback mock ──
const mockCompileCheck = mock((): Promise<{ compiled: boolean; errors: string[]; rawOutput: string }> =>
  Promise.resolve({
    compiled: true,
    errors: [] as string[],
    rawOutput: "Workflow compiled\nSimulation complete",
  }),
)

mock.module(resolve(SRC, "services/ai-engine/compile-feedback.ts"), () => ({
  compileCheck: mockCompileCheck,
  _getCompileState: () => ({ activeCount: 0, queueLength: 0 }),
}))

// ── DB mock ──
// refineWorkflow uses: db.select().from().where().limit(),
// db.select().from().where().orderBy().limit(), db.update().set().where(),
// db.insert().values()

let mockWorkflowRow: any = null

const mockValues = mock(() => Promise.resolve())
const mockInsert = mock(() => ({ values: mockValues }))

const mockUpdateWhere = mock(() => Promise.resolve())
const mockUpdateSet = mock(() => ({ where: mockUpdateWhere }))
const mockUpdate = mock(() => ({ set: mockUpdateSet }))

// Chainable select mock — supports .from().where().limit() and .from().where().orderBy().limit()
const mockSelect = mock(() => ({
  from: mock(() => ({
    where: mock(() => ({
      limit: mock(() => Promise.resolve(mockWorkflowRow ? [mockWorkflowRow] : [])),
      orderBy: mock(() => ({
        limit: mock(() => Promise.resolve([])),
      })),
    })),
  })),
}))

const mockDb = {
  insert: mockInsert,
  select: mockSelect,
  update: mockUpdate,
}

mock.module(resolve(SRC, "db/index.ts"), () => ({
  db: mockDb,
  sqlite: {},
}))

mock.module(resolve(SRC, "db/schema.ts"), () => ({
  workflows: {},
  workflowRevisions: {},
  generationTraces: {},
}))

// ── Config mock ──
mock.module(resolve(SRC, "config.ts"), () => ({
  config: {
    DATABASE_PATH: ":memory:",
    OPENAI_API_KEY: "sk-test",
    ANTHROPIC_API_KEY: "sk-ant-test",
    GEMINI_API_KEY: "test",
    PRIVATE_KEY: "0xtest",
    BASE_SEPOLIA_RPC_URL: "http://localhost:8545",
    REGISTRY_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000000",
    CONSUMER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000000",
    WALLET_ADDRESS: "0x0000000000000000000000000000000000000000",
    X402_FACILITATOR_URL: "http://localhost:8080",
    API_PORT: 3001,
    NEXT_PUBLIC_API_URL: "http://localhost:3001",
    CRE_CLI_PATH: "cre",
    NODE_ENV: "test",
  },
}))

// ── Dynamic imports ──
let refineWorkflow: (
  workflowId: string,
  refinementPrompt: string,
  ownerAddress: string,
) => Promise<any>
let generateWorkflow: (
  prompt: string,
  ownerAddress: string,
  forceTemplateId?: number,
) => Promise<any>

beforeAll(async () => {
  const mod = await import("../services/ai-engine/orchestrator")
  refineWorkflow = mod.refineWorkflow
  generateWorkflow = mod.generateWorkflow
})

// ─────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────

const WORKFLOW_ID = "11111111-1111-1111-1111-111111111111"
const OWNER = "0x1234567890abcdef1234567890abcdef12345678"

function makeStoredWorkflow(overrides: Record<string, any> = {}) {
  return {
    id: WORKFLOW_ID,
    name: "Price Monitor — Monitor ETH price",
    description: "Monitors price via cron trigger",
    prompt: "Monitor ETH price every 5 minutes and alert when below $2000",
    templateId: 1,
    templateName: "Price Monitor",
    code: VALID_WORKFLOW_TS,
    config: VALID_CONFIG_JSON,
    consumerSol: null,
    published: false,
    ownerAddress: OWNER,
    category: "core-defi",
    capabilities: '["price-feed","evmWrite"]',
    chains: '["base-sepolia"]',
    currentRevision: 1,
    simulationSuccess: false,
    simulationTrace: null,
    simulationDuration: null,
    ...overrides,
  }
}

beforeEach(() => {
  mockParse.mockClear()
  mockInsert.mockClear()
  mockValues.mockClear()
  mockCompileCheck.mockClear()
  mockSelect.mockClear()
  mockUpdate.mockClear()
  mockUpdateSet.mockClear()

  // Reset to default responses
  mockParse.mockImplementation(() =>
    Promise.resolve({
      output: [],
      output_parsed: {
        thinking: "Modifying threshold to be configurable...",
        workflow_ts: REFINED_WORKFLOW_TS,
        config_json: REFINED_CONFIG_JSON,
        consumer_sol: null as string | null,
        self_review: PASSING_SELF_REVIEW,
        explanation: "Made threshold configurable via config",
      },
    }),
  )
  mockCompileCheck.mockImplementation((): Promise<{ compiled: boolean; errors: string[]; rawOutput: string }> =>
    Promise.resolve({
      compiled: true,
      errors: [] as string[],
      rawOutput: "Workflow compiled\nSimulation complete",
    }),
  )

  // Default: workflow found
  mockWorkflowRow = makeStoredWorkflow()
})

// ─────────────────────────────────────────────
// Suite 1: Happy Path
// ─────────────────────────────────────────────

describe("refineWorkflow — happy path", () => {
  test("returns updated code with same workflowId", async () => {
    const result = await refineWorkflow(WORKFLOW_ID, "make the threshold configurable", OWNER)

    expect(result.workflowId).toBe(WORKFLOW_ID)
    expect(result.code).toContain("threshold")
    expect(result.explanation).toBe("Made threshold configurable via config")
    expect(result.fallback).toBe(false)
  })

  test("returns revisionNumber incremented", async () => {
    const result = await refineWorkflow(WORKFLOW_ID, "make the threshold configurable", OWNER)
    expect(result.revisionNumber).toBe(2)
  })

  test("calls OpenAI with previous code in context", async () => {
    await refineWorkflow(WORKFLOW_ID, "add error handling", OWNER)
    expect(mockParse).toHaveBeenCalledTimes(1)
  })

  test("inherits template from original workflow", async () => {
    const result = await refineWorkflow(WORKFLOW_ID, "make the threshold configurable", OWNER)
    expect(result.template.templateId).toBe(1)
    expect(result.template.templateName).toBe("Price Monitor")
  })
})

// ─────────────────────────────────────────────
// Suite 2: Guard Checks
// ─────────────────────────────────────────────

describe("refineWorkflow — guards", () => {
  test("workflow not found → WORKFLOW_NOT_FOUND", async () => {
    mockWorkflowRow = null
    try {
      await refineWorkflow("nonexistent-id", "change something", OWNER)
      expect(true).toBe(false)
    } catch (err: any) {
      expect(err.code).toBe("WORKFLOW_NOT_FOUND")
      expect(err.statusCode).toBe(404)
    }
  })

  test("published workflow → WORKFLOW_PUBLISHED", async () => {
    mockWorkflowRow = makeStoredWorkflow({ published: true })
    try {
      await refineWorkflow(WORKFLOW_ID, "change something", OWNER)
      expect(true).toBe(false)
    } catch (err: any) {
      expect(err.code).toBe("WORKFLOW_PUBLISHED")
      expect(err.statusCode).toBe(400)
    }
  })

  test("owner mismatch → UNAUTHORIZED", async () => {
    try {
      await refineWorkflow(WORKFLOW_ID, "change something", "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef")
      expect(true).toBe(false)
    } catch (err: any) {
      expect(err.code).toBe("UNAUTHORIZED")
      expect(err.statusCode).toBe(403)
    }
  })

  test("unclaimed workflow (zero address) allows any owner", async () => {
    mockWorkflowRow = makeStoredWorkflow({
      ownerAddress: "0x0000000000000000000000000000000000000000",
    })
    const result = await refineWorkflow(WORKFLOW_ID, "make the threshold configurable", OWNER)
    expect(result.workflowId).toBe(WORKFLOW_ID)
  })

  test("max revisions exceeded → REFINEMENT_FAILED", async () => {
    mockWorkflowRow = makeStoredWorkflow({ currentRevision: 50 })
    try {
      await refineWorkflow(WORKFLOW_ID, "change something", OWNER)
      expect(true).toBe(false)
    } catch (err: any) {
      expect(err.code).toBe("REFINEMENT_FAILED")
      expect(err.message).toContain("50")
    }
  })
})

// ─────────────────────────────────────────────
// Suite 3: Retry + No Fallback
// ─────────────────────────────────────────────

describe("refineWorkflow — retry behavior", () => {
  test("retries on compilation failure, succeeds on second attempt", async () => {
    let compileCallCount = 0
    mockCompileCheck.mockImplementation((): Promise<{ compiled: boolean; errors: string[]; rawOutput: string }> => {
      compileCallCount++
      if (compileCallCount === 1) {
        return Promise.resolve({
          compiled: false,
          errors: ["Type 'string' is not assignable to type 'number'"],
          rawOutput: "error TS2322",
        })
      }
      return Promise.resolve({
        compiled: true,
        errors: [] as string[],
        rawOutput: "Workflow compiled\nSimulation complete",
      })
    })

    const result = await refineWorkflow(WORKFLOW_ID, "make the threshold configurable", OWNER)
    expect(result.code).toContain("threshold")
    expect(mockParse.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  test("all retries exhausted → REFINEMENT_FAILED (no fallback)", async () => {
    mockParse.mockImplementation(() => {
      throw new Error("LLM permanently broken")
    })

    try {
      await refineWorkflow(WORKFLOW_ID, "change something", OWNER)
      expect(true).toBe(false)
    } catch (err: any) {
      expect(err.code).toBe("REFINEMENT_FAILED")
      expect(err.statusCode).toBe(502)
      expect(err.message).toContain("unchanged")
    }
  })
})

// ─────────────────────────────────────────────
// Suite 4: Prompt Builder (Refinement Mode)
// ─────────────────────────────────────────────

describe("buildGenerationPrompt — refinement mode", () => {
  let buildGenerationPrompt: (input: any) => string

  beforeAll(async () => {
    const mod = await import("../services/ai-engine/prompts/generation")
    buildGenerationPrompt = mod.buildGenerationPrompt
  })

  test("includes Refinement Mode section when previousCode provided", () => {
    const result = buildGenerationPrompt({
      userPrompt: "original prompt",
      intent: {
        triggerType: "cron",
        confidence: 0.9,
        schedule: "0 */5 * * * *",
        dataSources: ["price-feed"],
        conditions: [],
        actions: ["alert"],
        chains: ["base-sepolia"],
        keywords: ["monitor", "price"],
        entities: {},
      },
      template: {
        id: 1,
        name: "Price Monitor",
        category: "core-defi",
        requiredCapabilities: ["price-feed"],
        triggerType: "cron",
        defaultPromptFill: "Monitor price",
      },
      previousCode: "const x = 1",
      previousConfig: '{"foo":"bar"}',
      refinementPrompt: "add logging",
    })

    expect(result).toContain("## Refinement Mode")
    expect(result).toContain("### Current Working Code")
    expect(result).toContain("const x = 1")
    expect(result).toContain("### Requested Change")
    expect(result).toContain("add logging")
    expect(result).toContain("## Refinement Guidelines")
    // Should NOT contain ## User Request in refinement mode
    expect(result).not.toContain("## User Request")
  })

  test("preserves intent/template sections in refinement mode", () => {
    const result = buildGenerationPrompt({
      userPrompt: "original prompt",
      intent: {
        triggerType: "cron",
        confidence: 0.9,
        schedule: "0 */5 * * * *",
        dataSources: ["price-feed"],
        conditions: [],
        actions: ["alert"],
        chains: ["base-sepolia"],
        keywords: ["monitor", "price"],
        entities: {},
      },
      template: {
        id: 1,
        name: "Price Monitor",
        category: "core-defi",
        requiredCapabilities: ["price-feed"],
        triggerType: "cron",
        defaultPromptFill: "Monitor price",
      },
      previousCode: "const x = 1",
      previousConfig: "{}",
      refinementPrompt: "add logging",
    })

    expect(result).toContain("## Parsed Intent")
    expect(result).toContain("## Matched Template")
  })

  test("includes prior refinements when provided", () => {
    const result = buildGenerationPrompt({
      userPrompt: "original",
      intent: {
        triggerType: "cron",
        confidence: 0.9,
        dataSources: [],
        conditions: [],
        actions: [],
        chains: [],
        keywords: [],
        entities: {},
      },
      template: {
        id: 1,
        name: "Test",
        category: "core-defi",
        requiredCapabilities: [],
        triggerType: "cron",
        defaultPromptFill: "",
      },
      previousCode: "const x = 1",
      previousConfig: "{}",
      refinementPrompt: "add logging",
      priorRefinements: ["added error handling", "made threshold configurable"],
    })

    expect(result).toContain("### Previous Refinements")
    expect(result).toContain("1. added error handling")
    expect(result).toContain("2. made threshold configurable")
  })
})
