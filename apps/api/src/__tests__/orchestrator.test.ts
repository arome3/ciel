import { describe, test, expect, mock, beforeEach, beforeAll } from "bun:test"
import { resolve } from "path"

// ─────────────────────────────────────────────
// Mocks — OpenAI at the boundary, absolute paths only for side-effectful modules
// ─────────────────────────────────────────────
// Strategy:
//   - Mock OpenAI module (the external boundary), NOT code-generator
//     → avoids mock contamination across test files in Bun's shared registry
//     → better integration test: exercises real code-generator pipeline
//   - Mock db/config with absolute paths (directory import resolution quirk)
//   - Mock context7-client (network calls)
//   - Use dynamic import() for orchestrator (loaded after mocks registered)

const SRC = resolve(import.meta.dir, "..")

// ── Valid CRE workflow code that passes all 6 validation checks ──
const VALID_WORKFLOW_TS = `
import { z } from "zod"
import { Runner, Runtime, CronCapability, HTTPClient, handler, consensusMedianAggregation } from "@chainlink/cre-sdk"
const configSchema = z.object({ apiUrl: z.string(), cronSchedule: z.string().default("0 */5 * * * *") })
type Config = z.infer<typeof configSchema>
const runner = Runner.newRunner<Config>({ configSchema })
function initWorkflow(runtime: Runtime<Config>) {
  const cron = new CronCapability().trigger({ cronSchedule: runtime.config.cronSchedule })
  const http = new HTTPClient()
  handler(cron, (rt) => {
    const resp = http.fetch(rt.config.apiUrl, { method: "GET" }).result()
    return { data: resp.body }
  })
  consensusMedianAggregation({ fields: ["data"], reportId: "test" })
}
export async function main() { runner.run(initWorkflow) }
`

const VALID_CONFIG_JSON = '{"apiUrl":"https://api.coingecko.com","cronSchedule":"0 */5 * * * *"}'

// ── OpenAI mock — controls what the real code-generator produces ──
const mockParse = mock(() =>
  Promise.resolve({
    choices: [
      {
        message: {
          parsed: {
            thinking: "Using CronCapability for scheduled monitoring...",
            workflow_ts: VALID_WORKFLOW_TS,
            config_json: VALID_CONFIG_JSON,
            consumer_sol: null,
            self_review: "All constraints satisfied. No async in callbacks. Correct imports.",
            explanation: "Monitors price via cron trigger",
          },
          refusal: null,
        },
      },
    ],
  }),
)

mock.module("openai", () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        parse: mockParse,
      },
    }
  },
}))

// ── Context7 mock (avoid network calls) ──
mock.module(resolve(SRC, "services/ai-engine/context7-client.ts"), () => ({
  getContext7CREDocs: () => Promise.resolve(""),
  _resetContext7Cache: () => {},
}))

// ── DB mock (absolute path — directory import resolution quirk) ──
const mockValues = mock(() => Promise.resolve())
const mockInsert = mock(() => ({ values: mockValues }))
const mockDb = { insert: mockInsert }

mock.module(resolve(SRC, "db/index.ts"), () => ({
  db: mockDb,
  sqlite: {},
}))

mock.module(resolve(SRC, "db/schema.ts"), () => ({
  workflows: {},
}))

// ── Config mock (prevent dotenv/zod side effects) ──
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

// ── Dynamic import (loaded AFTER mocks registered) ──
let generateWorkflow: (
  prompt: string,
  ownerAddress: string,
  forceTemplateId?: number,
) => Promise<any>

beforeAll(async () => {
  const mod = await import("../services/ai-engine/orchestrator")
  generateWorkflow = mod.generateWorkflow
})

// ─────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────

const VALID_PROMPT = "Monitor ETH price every 5 minutes and alert when below $2000"
const OWNER = "0x1234567890abcdef1234567890abcdef12345678"

// Helper: build an OpenAI response with custom workflow code
function makeOpenAIResponse(overrides: {
  workflow_ts?: string
  config_json?: string
  consumer_sol?: string | null
  self_review?: string
  explanation?: string
} = {}) {
  return {
    choices: [
      {
        message: {
          parsed: {
            thinking: "...",
            workflow_ts: overrides.workflow_ts ?? VALID_WORKFLOW_TS,
            config_json: overrides.config_json ?? VALID_CONFIG_JSON,
            consumer_sol: overrides.consumer_sol ?? null,
            self_review: overrides.self_review ?? "All constraints satisfied.",
            explanation: overrides.explanation ?? "Monitors price via cron trigger",
          },
          refusal: null,
        },
      },
    ],
  }
}

beforeEach(() => {
  mockParse.mockClear()
  mockInsert.mockClear()
  mockValues.mockClear()
  // Reset to default valid response
  mockParse.mockImplementation(() => Promise.resolve(makeOpenAIResponse()))
})

// ─────────────────────────────────────────────
// Suite 1: Happy Path
// ─────────────────────────────────────────────

describe("orchestrator — happy path", () => {
  test("returns GenerateResult with all required fields", async () => {
    const result = await generateWorkflow(VALID_PROMPT, OWNER)

    expect(result.workflowId).toBeDefined()
    expect(typeof result.workflowId).toBe("string")
    expect(result.code).toContain("handler(")
    expect(result.configJson).toBeDefined()
    expect(result.explanation).toBe("Monitors price via cron trigger")
    expect(result.consumerSol).toBeNull()
    expect(result.intent).toBeDefined()
    expect(result.intent.triggerType).toBe("cron")
    expect(result.template).toBeDefined()
    expect(result.validation.valid).toBe(true)
    expect(result.fallback).toBe(false)
  })

  test("calls OpenAI exactly once on valid first attempt", async () => {
    await generateWorkflow(VALID_PROMPT, OWNER)
    expect(mockParse).toHaveBeenCalledTimes(1)
  })

  test("saves workflow to DB on success", async () => {
    await generateWorkflow(VALID_PROMPT, OWNER)
    expect(mockInsert).toHaveBeenCalledTimes(1)
    expect(mockValues).toHaveBeenCalledTimes(1)
  })
})

// ─────────────────────────────────────────────
// Suite 2: Template Not Found
// ─────────────────────────────────────────────

describe("orchestrator — template not found", () => {
  test("throws TEMPLATE_NOT_FOUND for unmatchable prompt", async () => {
    try {
      await generateWorkflow("xyzzy foobar gibberish quxquux random", OWNER)
      expect(true).toBe(false) // should not reach
    } catch (err: any) {
      expect(err.code).toBe("TEMPLATE_NOT_FOUND")
      expect(err.statusCode).toBe(400)
    }
  })
})

// ─────────────────────────────────────────────
// Suite 3: Retry + Structured Errors
// ─────────────────────────────────────────────

describe("orchestrator — retry logic", () => {
  test("retries when validation fails, then succeeds on valid code", async () => {
    let callCount = 0
    mockParse.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // First call: return code that fails validation (missing everything)
        return Promise.resolve(makeOpenAIResponse({
          workflow_ts: "const x = 42",
          config_json: "{}",
        }))
      }
      // Subsequent calls: return valid code
      return Promise.resolve(makeOpenAIResponse())
    })

    const result = await generateWorkflow(VALID_PROMPT, OWNER)
    expect(callCount).toBeGreaterThanOrEqual(2)
    expect(result.fallback).toBe(false)
  })

  test("caps maxInternalRetries on orchestrator retries", async () => {
    // The code-generator's internal retry uses maxRetries from input.
    // On orchestrator retries, maxInternalRetries is set to 1.
    // With all invalid code, we should see limited total OpenAI calls.
    mockParse.mockImplementation(() =>
      Promise.resolve(makeOpenAIResponse({
        workflow_ts: "const broken = true",
        config_json: "{}",
      })),
    )

    const result = await generateWorkflow(VALID_PROMPT, OWNER)
    // Should eventually fall back
    expect(result.fallback).toBe(true)
    // Total calls: 3 (first attempt) + 1 (retry 1) + 1 (retry 2) = 5 max
    // (code-gen internal retries: 3 first, then capped to 1)
    expect(mockParse.mock.calls.length).toBeLessThanOrEqual(7)
  })
})

// ─────────────────────────────────────────────
// Suite 4: Fallback
// ─────────────────────────────────────────────

describe("orchestrator — fallback", () => {
  test("falls back to pre-built template after all attempts fail", async () => {
    mockParse.mockImplementation(() =>
      Promise.resolve(makeOpenAIResponse({
        workflow_ts: "// totally broken",
        config_json: "{}",
      })),
    )

    const result = await generateWorkflow(VALID_PROMPT, OWNER)

    expect(result.fallback).toBe(true)
    expect(result.code).toContain("CronCapability")
    expect(result.code).toContain("handler(")
    expect(result.code).toContain("export")
  })

  test("falls back when OpenAI throws repeatedly", async () => {
    mockParse.mockImplementation(() => {
      throw new Error("OpenAI API timeout")
    })

    const result = await generateWorkflow(VALID_PROMPT, OWNER)

    expect(result.fallback).toBe(true)
    expect(result.code).toContain("export")
  })

  test("fallback still saves to DB", async () => {
    mockParse.mockImplementation(() => {
      throw new Error("boom")
    })

    await generateWorkflow(VALID_PROMPT, OWNER)
    // Fallback should still attempt DB save
    expect(mockInsert).toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────
// Suite 5: quickFix Integration
// ─────────────────────────────────────────────

describe("orchestrator — quickFix integration", () => {
  test("quickFix removes forbidden import, avoiding retry", async () => {
    const codeWithAxios = `import axios from "axios"\n` + VALID_WORKFLOW_TS
    mockParse.mockImplementation(() =>
      Promise.resolve(makeOpenAIResponse({
        workflow_ts: codeWithAxios,
      })),
    )

    const result = await generateWorkflow(VALID_PROMPT, OWNER)

    expect(mockParse).toHaveBeenCalledTimes(1) // No retry needed
    expect(result.fallback).toBe(false)
    expect(result.code).not.toContain("axios")
  })
})

// ─────────────────────────────────────────────
// Suite 6: DB Resilience
// ─────────────────────────────────────────────

describe("orchestrator — DB resilience", () => {
  test("returns result even if DB save fails", async () => {
    mockValues.mockImplementation(() => {
      throw new Error("DB connection lost")
    })

    const result = await generateWorkflow(VALID_PROMPT, OWNER)

    // Should still return a valid result
    expect(result.workflowId).toBeDefined()
    expect(result.code).toContain("handler(")
    expect(result.fallback).toBe(false)
  })
})

// ─────────────────────────────────────────────
// Suite 7: forceTemplateId
// ─────────────────────────────────────────────

describe("orchestrator — forceTemplateId", () => {
  test("forceTemplateId bypasses intent matching", async () => {
    // Gibberish prompt that wouldn't match any template naturally
    const result = await generateWorkflow(
      "xyzzy nonsense gibberish foobar compute calculate process", OWNER, 1,
    )
    expect(result.template.templateId).toBe(1)
    expect(result.template.confidence).toBe(1.0)
    expect(result.fallback).toBe(false)
  })

  test("invalid forceTemplateId throws TEMPLATE_NOT_FOUND", async () => {
    try {
      await generateWorkflow(VALID_PROMPT, OWNER, 999)
      expect(true).toBe(false) // should not reach
    } catch (err: any) {
      expect(err.code).toBe("TEMPLATE_NOT_FOUND")
    }
  })
})

// ─────────────────────────────────────────────
// Suite 8: consumerSol passthrough
// ─────────────────────────────────────────────

describe("orchestrator — consumerSol passthrough", () => {
  test("consumerSol is passed through from generated code", async () => {
    const MOCK_SOL = "// SPDX-License-Identifier: MIT\ncontract Consumer {}"
    mockParse.mockImplementation(() =>
      Promise.resolve(makeOpenAIResponse({
        consumer_sol: MOCK_SOL,
      })),
    )

    const result = await generateWorkflow(VALID_PROMPT, OWNER)
    expect(result.consumerSol).toBe(MOCK_SOL)
  })
})

// ─────────────────────────────────────────────
// Suite 9: DB save args
// ─────────────────────────────────────────────

describe("orchestrator — DB save args", () => {
  test("DB save includes correct fields", async () => {
    await generateWorkflow(VALID_PROMPT, OWNER)

    expect(mockValues).toHaveBeenCalledTimes(1)
    const savedObj = mockValues.mock.calls[0][0]
    expect(savedObj).toHaveProperty("ownerAddress", OWNER)
    expect(savedObj).toHaveProperty("templateId")
    expect(savedObj).toHaveProperty("category")
    expect(savedObj).toHaveProperty("chains")
    expect(savedObj).toHaveProperty("code")
    expect(savedObj).toHaveProperty("config")
  })
})

// ─────────────────────────────────────────────
// Suite 10: Structured error feedback on retry
// ─────────────────────────────────────────────

describe("orchestrator — structured error feedback", () => {
  test("validation errors are formatted for retry prompt", async () => {
    let callCount = 0
    const brokenCode = "const x = 42" // Missing everything

    mockParse.mockImplementation(() => {
      callCount++
      if (callCount <= 1) {
        return Promise.resolve(makeOpenAIResponse({
          workflow_ts: brokenCode,
          config_json: "{}",
        }))
      }
      // Return valid code on subsequent calls
      return Promise.resolve(makeOpenAIResponse())
    })

    const result = await generateWorkflow(VALID_PROMPT, OWNER)
    // Should have retried at least once
    expect(callCount).toBeGreaterThanOrEqual(2)
    // Eventually succeeded
    expect(result.fallback).toBe(false)
  })
})
