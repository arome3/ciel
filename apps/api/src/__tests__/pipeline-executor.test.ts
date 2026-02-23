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
const emittedEvents: any[] = []
mock.module(resolve(SRC, "services/events/emitter.ts"), () => ({
  emitEvent: (event: any) => {
    emittedEvents.push(event)
  },
}))

// ── Simulator mock ──
let simulateResult = {
  success: true,
  executionTrace: [{ step: "test", status: "success", duration: 100, output: "ok" }],
  duration: 200,
  errors: [] as string[],
  warnings: [] as string[],
  rawOutput: "",
}
let simulateCallCount = 0
let shouldSimulateFail = false
let simulateFailOnStep: Set<string> = new Set()

mock.module(resolve(SRC, "services/cre/compiler.ts"), () => ({
  simulateWorkflow: (_code: string, config: any) => {
    simulateCallCount++
    if (shouldSimulateFail) {
      return Promise.reject(new Error("Simulation failed"))
    }
    return Promise.resolve({ ...simulateResult })
  },
}))

// ── DB mock ──
const TEST_PIPELINE = {
  id: "pipe-1",
  name: "Test Pipeline",
  description: "A test pipeline",
  ownerAddress: "0xOwner",
  steps: JSON.stringify([
    { id: "s1", workflowId: "wf-1", position: 0 },
    { id: "s2", workflowId: "wf-2", position: 1 },
  ]),
  totalPrice: "70000",
  isActive: true,
  executionCount: 0,
}

const TEST_PIPELINE_DEACTIVATED = {
  ...TEST_PIPELINE,
  id: "pipe-deactivated",
  isActive: false,
}

const TEST_WORKFLOWS: Record<string, any> = {
  "wf-1": {
    id: "wf-1",
    name: "Price Feed",
    code: "// price feed code",
    config: "{}",
    inputSchema: {
      type: "object",
      properties: {
        assetPair: { type: "string", description: "Asset pair" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        price: { type: "number", description: "Current price" },
        timestamp: { type: "number", description: "Unix timestamp" },
      },
    },
  },
  "wf-2": {
    id: "wf-2",
    name: "Alert",
    code: "// alert code",
    config: "{}",
    inputSchema: {
      type: "object",
      properties: {
        value: { type: "string", description: "Value to check" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        sent: { type: "boolean", description: "Alert sent" },
        alertId: { type: "string", description: "Alert ID" },
      },
    },
  },
}

let dbPipelineResult: any = TEST_PIPELINE
let dbWorkflowResults: Record<string, any> = TEST_WORKFLOWS

// Track DB operations
let insertCalled = false
let updateCalls: any[] = []

const mockInsertValues = mock(() => {
  insertCalled = true
  return Promise.resolve()
})

const mockUpdateWhere = mock(() => {
  return Promise.resolve()
})
const mockUpdateSet = mock((...args: any[]) => {
  updateCalls.push(args)
  return { where: mockUpdateWhere }
})

// Simplified mock that tracks which table is queried
let selectCallIndex = 0
const mockSelect = mock((...args: any[]) => {
  const callIdx = selectCallIndex++
  return {
    from: mock(() => ({
      where: mock(() => ({
        get: mock(() => {
          if (callIdx === 0) return Promise.resolve(dbPipelineResult)
          // Workflow lookups
          const wfId = Object.keys(dbWorkflowResults)[callIdx - 1]
          return Promise.resolve(wfId ? dbWorkflowResults[wfId] : null)
        }),
      })),
    })),
  }
})

mock.module(resolve(SRC, "db/index.ts"), () => ({
  db: {
    select: mockSelect,
    insert: mock(() => ({
      values: mockInsertValues,
      returning: mock(() => Promise.resolve([])),
    })),
    update: mock(() => ({
      set: mockUpdateSet,
    })),
  },
}))

mock.module(resolve(SRC, "db/schema.ts"), () => ({
  workflows: { id: "id", inputSchema: "input_schema" },
  pipelines: { id: "id", executionCount: "execution_count" },
  pipelineExecutions: { id: "id" },
}))

// ─────────────────────────────────────────────
// Import after mocks
// ─────────────────────────────────────────────

const { mapStepInput, generateSyntheticOutput, executePipeline } = await import(
  "../services/pipeline/executor"
)

// ─────────────────────────────────────────────
// Unit Tests — mapStepInput
// ─────────────────────────────────────────────

describe("mapStepInput", () => {
  test("no mapping → returns trigger input", () => {
    const trigger = { price: 100, symbol: "ETH" }
    const result = mapStepInput(undefined, trigger, new Map())

    expect(result).toEqual({ price: 100, symbol: "ETH" })
  })

  test("maps from trigger source", () => {
    const mapping = {
      value: { source: "trigger", field: "price" },
    }
    const trigger = { price: 42 }
    const result = mapStepInput(mapping, trigger, new Map())

    expect(result.value).toBe(42)
  })

  test("maps from step output", () => {
    const mapping = {
      message: { source: "step-1", field: "alertText" },
    }
    const stepOutputs = new Map([
      ["step-1", { alertText: "Price alert!", severity: "high" }],
    ])
    const result = mapStepInput(mapping, {}, stepOutputs)

    expect(result.message).toBe("Price alert!")
  })

  test("missing source step → undefined value", () => {
    const mapping = {
      value: { source: "step-missing", field: "price" },
    }
    const result = mapStepInput(mapping, {}, new Map())

    expect(result.value).toBeUndefined()
  })

  test("coerces number → string when target schema specifies string", () => {
    const mapping = {
      label: { source: "step-1", field: "price" },
    }
    const stepOutputs = new Map([
      ["step-1", { price: 42 }],
    ])
    const targetSchema = {
      type: "object",
      properties: {
        label: { type: "string", description: "Label" },
      },
    }
    const result = mapStepInput(mapping, {}, stepOutputs, undefined, targetSchema)

    expect(result.label).toBe("42")
    expect(typeof result.label).toBe("string")
  })

  test("coerces string → number when target schema specifies number", () => {
    const mapping = {
      amount: { source: "trigger", field: "value" },
    }
    const targetSchema = {
      type: "object",
      properties: {
        amount: { type: "number", description: "Amount" },
      },
    }
    const result = mapStepInput(mapping, { value: "100" }, new Map(), undefined, targetSchema)

    expect(result.amount).toBe(100)
    expect(typeof result.amount).toBe("number")
  })

  test("no coercion when types already match", () => {
    const mapping = {
      price: { source: "step-1", field: "price" },
    }
    const stepOutputs = new Map([
      ["step-1", { price: 42 }],
    ])
    const targetSchema = {
      type: "object",
      properties: {
        price: { type: "number", description: "Price" },
      },
    }
    const result = mapStepInput(mapping, {}, stepOutputs, undefined, targetSchema)

    expect(result.price).toBe(42)
  })

  test("no coercion without target schema (backward compat)", () => {
    const mapping = {
      value: { source: "step-1", field: "price" },
    }
    const stepOutputs = new Map([
      ["step-1", { price: 42 }],
    ])
    const result = mapStepInput(mapping, {}, stepOutputs)

    // Without target schema, no coercion happens — value passes through as-is
    expect(result.value).toBe(42)
  })
})

// ─────────────────────────────────────────────
// Unit Tests — generateSyntheticOutput
// ─────────────────────────────────────────────

describe("generateSyntheticOutput", () => {
  test("generates values matching schema types", () => {
    const schema = {
      type: "object",
      properties: {
        price: { type: "number", description: "Current price" },
        name: { type: "string", description: "Asset name" },
        active: { type: "boolean", description: "Is active" },
      },
    }

    const output = generateSyntheticOutput(schema, true)

    expect(typeof output.price).toBe("number")
    expect(typeof output.name).toBe("string")
    expect(typeof output.active).toBe("boolean")
  })

  test("success=true → number is 42, boolean is true", () => {
    const schema = {
      type: "object",
      properties: {
        value: { type: "number" },
        flag: { type: "boolean" },
      },
    }

    const output = generateSyntheticOutput(schema, true)
    expect(output.value).toBe(42)
    expect(output.flag).toBe(true)
  })

  test("success=false → number is 0, boolean is false", () => {
    const schema = {
      type: "object",
      properties: {
        value: { type: "number" },
        flag: { type: "boolean" },
      },
    }

    const output = generateSyntheticOutput(schema, false)
    expect(output.value).toBe(0)
    expect(output.flag).toBe(false)
  })

  test("null schema → { success: simSuccess }", () => {
    const output = generateSyntheticOutput(null, true)
    expect(output).toEqual({ success: true })
  })

  test("schema without properties → { success: simSuccess }", () => {
    const output = generateSyntheticOutput({ type: "object" }, false)
    expect(output).toEqual({ success: false })
  })

  test("unknown type → null", () => {
    const schema = {
      type: "object",
      properties: {
        data: { type: "array" },
      },
    }

    const output = generateSyntheticOutput(schema, true)
    expect(output.data).toBeNull()
  })
})

// ─────────────────────────────────────────────
// SSE event emission
// ─────────────────────────────────────────────

describe("SSE events", () => {
  beforeEach(() => {
    emittedEvents.length = 0
  })

  test("emitEvent mock captures events", () => {
    const { emitEvent } = require("../services/events/emitter")
    emitEvent({ type: "pipeline_started", data: { test: true } })
    expect(emittedEvents).toHaveLength(1)
    expect(emittedEvents[0].type).toBe("pipeline_started")
  })
})

// ─────────────────────────────────────────────
// Integration Tests — executePipeline
// ─────────────────────────────────────────────

describe("executePipeline", () => {
  beforeEach(() => {
    selectCallIndex = 0
    dbPipelineResult = TEST_PIPELINE
    dbWorkflowResults = TEST_WORKFLOWS
    simulateCallCount = 0
    shouldSimulateFail = false
    insertCalled = false
    updateCalls = []
    emittedEvents.length = 0
    simulateResult = {
      success: true,
      executionTrace: [{ step: "test", status: "success", duration: 100, output: "ok" }],
      duration: 200,
      errors: [],
      warnings: [],
      rawOutput: "",
    }
  })

  test("happy path: 2-step sequential → completed", async () => {
    const result = await executePipeline("pipe-1", { assetPair: "ETH/USD" })

    expect(result.status).toBe("completed")
    expect(result.stepResults).toHaveLength(2)
    expect(result.stepResults[0].success).toBe(true)
    expect(result.stepResults[1].success).toBe(true)
    expect(result.finalOutput).toBeTruthy()
    expect(result.pipelineId).toBe("pipe-1")
    expect(result.executionId).toBeTruthy()
    expect(result.duration).toBeGreaterThanOrEqual(0)
  })

  test("emits correct SSE event sequence", async () => {
    await executePipeline("pipe-1")

    const types = emittedEvents.map((e) => e.type)

    // Should have: started, step_started×2, step_completed×2, completed
    expect(types[0]).toBe("pipeline_started")
    expect(types).toContain("pipeline_step_started")
    expect(types).toContain("pipeline_step_completed")
    expect(types[types.length - 1]).toBe("pipeline_completed")
  })

  test("all steps fail → status 'failed'", async () => {
    shouldSimulateFail = true

    const result = await executePipeline("pipe-1")

    expect(result.status).toBe("failed")
    expect(result.stepResults.every((r: any) => !r.success)).toBe(true)
    expect(result.finalOutput).toBeNull()

    // Should emit pipeline_failed (not pipeline_completed)
    const lastEvent = emittedEvents[emittedEvents.length - 1]
    expect(lastEvent.type).toBe("pipeline_failed")
    expect(lastEvent.data.status).toBe("failed")
  })

  test("pipeline not found → throws PIPELINE_NOT_FOUND", async () => {
    dbPipelineResult = null

    try {
      await executePipeline("nonexistent")
      expect(true).toBe(false) // should not reach
    } catch (err: any) {
      expect(err.code).toBe("PIPELINE_NOT_FOUND")
      expect(err.statusCode).toBe(404)
    }
  })

  test("deactivated pipeline → throws PIPELINE_DEACTIVATED", async () => {
    dbPipelineResult = TEST_PIPELINE_DEACTIVATED

    try {
      await executePipeline("pipe-deactivated")
      expect(true).toBe(false) // should not reach
    } catch (err: any) {
      expect(err.code).toBe("PIPELINE_DEACTIVATED")
      expect(err.statusCode).toBe(400)
    }
  })

  test("creates execution record on start", async () => {
    await executePipeline("pipe-1")

    expect(insertCalled).toBe(true)
  })

  test("updates execution record on completion", async () => {
    await executePipeline("pipe-1")

    // Should have update calls (execution record + pipeline count)
    expect(updateCalls.length).toBeGreaterThanOrEqual(1)
  })

  test("simulation called for each workflow step", async () => {
    await executePipeline("pipe-1")

    // 2 steps → 2 simulation calls (1 per step, no retries needed)
    expect(simulateCallCount).toBe(2)
  })
})
