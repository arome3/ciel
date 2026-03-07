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

// ── Valid CRE workflow code that passes all validation checks ──
// Uses current CRE SDK v1.1.3 patterns: cre.handler(), decodeJson(), runner.run returns handler array
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

// ── OpenAI mock — controls what the real code-generator produces ──
/** Structured self-review that passes all checks (matches SelfReviewSchema) */
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

const mockParse = mock(() =>
  Promise.resolve({
    output: [],
    output_parsed: {
      thinking: "Using CronCapability for scheduled monitoring...",
      workflow_ts: VALID_WORKFLOW_TS,
      config_json: VALID_CONFIG_JSON,
      consumer_sol: null as string | null,
      self_review: PASSING_SELF_REVIEW,
      explanation: "Monitors price via cron trigger",
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

// Context7: no mock needed — real module has bundled fallback for network failures

// ── Compile feedback mock (subprocess boundary) ──
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
  workflowRevisions: {},
  generationTraces: {},
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

// Helper: build an OpenAI Responses API response with custom workflow code
function makeOpenAIResponse(overrides: {
  workflow_ts?: string
  config_json?: string
  consumer_sol?: string | null
  self_review?: typeof PASSING_SELF_REVIEW
  explanation?: string
} = {}) {
  return {
    output: [],
    output_parsed: {
      thinking: "...",
      workflow_ts: overrides.workflow_ts ?? VALID_WORKFLOW_TS,
      config_json: overrides.config_json ?? VALID_CONFIG_JSON,
      consumer_sol: (overrides.consumer_sol ?? null) as string | null,
      self_review: overrides.self_review ?? PASSING_SELF_REVIEW,
      explanation: overrides.explanation ?? "Monitors price via cron trigger",
    },
  }
}

beforeEach(() => {
  mockParse.mockClear()
  mockInsert.mockClear()
  mockValues.mockClear()
  mockCompileCheck.mockClear()
  // Reset to default valid response
  mockParse.mockImplementation(() => Promise.resolve(makeOpenAIResponse()))
  // Reset to default successful compilation
  mockCompileCheck.mockImplementation((): Promise<{ compiled: boolean; errors: string[]; rawOutput: string }> =>
    Promise.resolve({
      compiled: true,
      errors: [] as string[],
      rawOutput: "Workflow compiled\nSimulation complete",
    }),
  )
  // Reset to default DB success (critical: mockClear doesn't reset implementation)
  mockValues.mockImplementation(() => Promise.resolve())
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
    // 3 inserts: workflow row + revision #1 bootstrap + generation trace
    expect(mockInsert).toHaveBeenCalledTimes(3)
    expect(mockValues).toHaveBeenCalledTimes(3)
  })
})

// ─────────────────────────────────────────────
// Suite 2: Wildcard (No Template Match)
// ─────────────────────────────────────────────

describe("orchestrator — wildcard (no template match)", () => {
  test("returns wildcard result for unmatchable prompt", async () => {
    const result = await generateWorkflow("xyzzy foobar gibberish quxquux random", OWNER)
    expect(result.template.templateId).toBe(0)
    expect(result.template.templateName).toContain("Wildcard")
    expect(result.template.confidence).toBeLessThan(0.3)
    expect(result.fallback).toBe(false)
  })

  test("wildcard falls back to scaffold when LLM fails", async () => {
    mockParse.mockImplementation(() => { throw new Error("boom") })
    const result = await generateWorkflow("xyzzy foobar gibberish quxquux random", OWNER)
    expect(result.template.templateId).toBe(0)
    expect(result.fallback).toBe(true)
    expect(result.code).toContain("CronCapability")
  })

  test("negated prompt still throws TEMPLATE_NOT_FOUND", async () => {
    try {
      await generateWorkflow("dont do anything with blockchain or crypto", OWNER)
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

    // 3 inserts: workflow + revision + trace. First call is the workflow.
    expect(mockValues).toHaveBeenCalled()
    const savedObj = (mockValues.mock.calls as any[][])[0][0]
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

// ─────────────────────────────────────────────
// Suite 11: Fallback state config merge
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// Suite 12: T12 Wallet Activity Monitor
// ─────────────────────────────────────────────

describe("orchestrator — T12 Wallet Activity Monitor", () => {
  test("forceTemplateId: 12 returns correct template match", async () => {
    // T12 uses evm_log trigger — provide matching code so intent alignment passes
    const T12_WORKFLOW = `
import { z } from "zod"
import { cre, Runner, type Runtime, type EVMLog, getNetwork, hexToBase64, bytesToHex } from "@chainlink/cre-sdk"
const configSchema = z.object({ chainSelectorName: z.string(), tokenContractAddress: z.string(), watchAddresses: z.string(), alertWebhookUrl: z.string() })
type Config = z.infer<typeof configSchema>
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
const onEvmLogTrigger = (runtime: Runtime<Config>, log: EVMLog): string => {
  const httpClient = new cre.capabilities.HTTPClient()
  const from = bytesToHex(log.topics[1].slice(12))
  const to = bytesToHex(log.topics[2].slice(12))
  const value = BigInt("0x" + bytesToHex(log.data))
  const alert = { type: "transfer", from, to, value: value.toString() }
  httpClient.sendRequest(runtime, { url: runtime.config.alertWebhookUrl, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(alert) }).result()
  return JSON.stringify(alert)
}
const initWorkflow = (config: Config) => {
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: config.chainSelectorName, isTestnet: true })
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)
  const logTrigger = evmClient.logTrigger({ addresses: [hexToBase64(config.tokenContractAddress)], topics: [TRANSFER_TOPIC] })
  return [cre.handler(logTrigger, onEvmLogTrigger)]
}
export async function main() { const runner = await Runner.newRunner<Config>({ configSchema }); await runner.run(initWorkflow) }
`
    const T12_CONFIG = '{"chainSelectorName":"base-sepolia","tokenContractAddress":"0x1234","watchAddresses":"0xabcd","alertWebhookUrl":"https://hooks.example.com/alert"}'
    mockParse.mockImplementation(() =>
      Promise.resolve(makeOpenAIResponse({
        workflow_ts: T12_WORKFLOW,
        config_json: T12_CONFIG,
      })),
    )

    const result = await generateWorkflow(
      "Watch wallet for large token transfers and alert",
      OWNER,
      12,
    )
    expect(result.template.templateId).toBe(12)
    expect(result.template.confidence).toBe(1.0)
    expect(result.fallback).toBe(false)
  })

  test("T12 fallback loads EVMLog template when OpenAI fails", async () => {
    mockParse.mockImplementation(() => { throw new Error("OpenAI timeout") })
    const result = await generateWorkflow(
      "Watch whale wallet for large ERC20 transfers and alert me",
      OWNER,
    )
    expect(result.fallback).toBe(true)
    // Template-12 uses EVMClient + logTrigger (not literal "EVMLogCapability")
    expect(result.code).toContain("logTrigger")
    expect(result.code).toContain("handler(")
  })
})

// ─────────────────────────────────────────────
// Suite 13: Fallback state config merge
// ─────────────────────────────────────────────

describe("orchestrator — fallback state config merge", () => {
  test("fallback with state-keyword prompt merges KV config into pre-built config", async () => {
    // Force all generation to fail → triggers fallback path
    mockParse.mockImplementation(() => {
      throw new Error("forced failure for fallback test")
    })

    // Prompt with state keyword "history" + strong T1 keywords (alert + price) for template matching
    const statePrompt = "Monitor ETH price every 5 minutes, alert when below 2000, and store history state over time"
    const result = await generateWorkflow(statePrompt, OWNER)

    expect(result.fallback).toBe(true)

    // The fallback config should have KV fields merged from intent (PLACEHOLDER_ prefix convention)
    const config = JSON.parse(result.configJson)
    expect(config.kvStoreUrl).toBe("PLACEHOLDER_KV_STORE_URL")
    expect(config.kvApiKey).toBe("PLACEHOLDER_KV_API_KEY")
    expect(typeof config.stateKey).toBe("string")
    expect(config.stateKey).toContain("ciel-")
    expect(config.stateKey).toContain("-data")
  })
})

// ─────────────────────────────────────────────
// Suite 14: Compilation Feedback Loop
// ─────────────────────────────────────────────

describe("orchestrator — compilation feedback loop", () => {
  test("compileCheck runs after validation passes", async () => {
    await generateWorkflow(VALID_PROMPT, OWNER)
    expect(mockCompileCheck).toHaveBeenCalledTimes(1)
  })

  test("compileCheck receives the fixed code (post-quickFix)", async () => {
    await generateWorkflow(VALID_PROMPT, OWNER)
    const calledWith = (mockCompileCheck.mock.calls as any[][])[0]
    // First arg is the code string
    expect(typeof calledWith[0]).toBe("string")
    expect(calledWith[0]).toContain("handler(")
  })

  test("compile failure triggers retry with compile errors in context", async () => {
    let callCount = 0
    mockCompileCheck.mockImplementation((): Promise<{ compiled: boolean; errors: string[]; rawOutput: string }> => {
      callCount++
      if (callCount === 1) {
        // First compile fails
        return Promise.resolve({
          compiled: false as boolean,
          errors: ["Cannot find name 'HTTPClient'"] as string[],
          rawOutput: "error TS2304: Cannot find name 'HTTPClient'",
        })
      }
      // Subsequent compiles succeed
      return Promise.resolve({
        compiled: true as boolean,
        errors: [] as string[],
        rawOutput: "Workflow compiled",
      })
    })

    const result = await generateWorkflow(VALID_PROMPT, OWNER)
    // Should have retried: compileCheck called at least twice
    expect(callCount).toBeGreaterThanOrEqual(2)
    // Should eventually succeed (not fallback)
    expect(result.fallback).toBe(false)
  })

  test("returns code when validation passes but compile fails on last attempt", async () => {
    // All compile checks fail
    mockCompileCheck.mockImplementation((): Promise<{ compiled: boolean; errors: string[]; rawOutput: string }> =>
      Promise.resolve({
        compiled: false as boolean,
        errors: ["Persistent type error"] as string[],
        rawOutput: "error",
      }),
    )

    const result = await generateWorkflow(VALID_PROMPT, OWNER)
    // On the last attempt, code that passes validation but fails compile
    // should still be returned (better than fallback)
    expect(result.code).toContain("handler(")
    expect(result.fallback).toBe(false)
  })

  test("compileCheck not called when validation fails", async () => {
    mockParse.mockImplementation(() =>
      Promise.resolve(makeOpenAIResponse({
        workflow_ts: "const broken = true", // fails validation
        config_json: "{}",
      })),
    )

    await generateWorkflow(VALID_PROMPT, OWNER)
    // compileCheck should NOT be called since validation never passes
    expect(mockCompileCheck).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────
// Suite 15: Pre-Seeded Fix Patterns
// ─────────────────────────────────────────────

describe("orchestrator — pre-seeded fix patterns", () => {
  test("HTTP-triggered template (T9) passes enrichedContext to first OpenAI call", async () => {
    // Force T9 — it's HTTP + multi-ai + evmWrite, so should get ALIGN + TSC + ASYNC + NONDET
    await generateWorkflow(
      "Query multiple AI models for consensus on credit events",
      OWNER,
      9,
    )

    // Check the first OpenAI call's input contains pre-seeded patterns
    expect(mockParse).toHaveBeenCalled()
    const firstCall = (mockParse.mock.calls as any[][])[0][0]
    // The user prompt (input field) should contain proactive guidance
    expect(firstCall.input).toContain("Proactive Guidance")
    expect(firstCall.input).toContain("[ALIGN]")
    expect(firstCall.input).toContain("[TSC]")
    expect(firstCall.input).toContain("[ASYNC]")
  })

  test("cron-triggered template (T1) does NOT get pre-seeded ALIGN pattern", async () => {
    await generateWorkflow(VALID_PROMPT, OWNER, 1)

    expect(mockParse).toHaveBeenCalled()
    const firstCall = (mockParse.mock.calls as any[][])[0][0]
    // T1 is cron with price-feed + alert — no ALIGN pre-seeding
    expect(firstCall.input).not.toContain("[ALIGN]")
  })
})
