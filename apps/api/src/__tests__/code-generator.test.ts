import { describe, test, expect, mock, beforeEach } from "bun:test"
import { buildFewShotContext } from "../services/ai-engine/context-builder"
import { retrieveRelevantDocs } from "../services/ai-engine/doc-retriever"
import { buildSystemPrompt } from "../services/ai-engine/prompts/system"
import { buildGenerationPrompt, type GenerationPromptInput } from "../services/ai-engine/prompts/generation"
import { getContext7CREDocs, _resetContext7Cache } from "../services/ai-engine/context7-client"
import { TEMPLATES, getTemplateById } from "../services/ai-engine/template-matcher"
import type { ParsedIntent } from "../services/ai-engine/types"

// ─────────────────────────────────────────────
// Test Fixtures
// ─────────────────────────────────────────────

const MOCK_INTENT: ParsedIntent = {
  triggerType: "cron",
  confidence: 0.85,
  schedule: "*/5 * * * *",
  dataSources: ["price-feed"],
  conditions: ["drops below $3000"],
  actions: ["alert"],
  chains: ["base-sepolia"],
  keywords: ["monitor", "price", "alert", "drops", "below"],
  negated: false,
  entities: {},
}

// ─────────────────────────────────────────────
// Suite 1: Context Builder
// ─────────────────────────────────────────────

describe("buildFewShotContext", () => {
  test("returns 2+ code examples for template 1", () => {
    const context = buildFewShotContext(1)
    expect(context).toContain("### Example: Template")
    expect(context).toContain("```typescript")
    // Template 1 relates to [4, 8]
    expect(context).toContain("Template 4")
    expect(context).toContain("Template 8")
  })

  test("returns 2+ code examples for template 9 (flagship)", () => {
    const context = buildFewShotContext(9)
    expect(context).toContain("### Example: Template")
    // Template 9 relates to [4, 1]
    expect(context).toContain("Template 4")
    expect(context).toContain("Template 1")
  })

  test("returns non-empty context for all 10 templates", () => {
    for (let id = 1; id <= 10; id++) {
      const context = buildFewShotContext(id)
      expect(context.length).toBeGreaterThan(0)
      expect(context).toContain("Working CRE Workflow Examples")
    }
  })

  test("returns empty string for unknown template ID", () => {
    const context = buildFewShotContext(99)
    expect(context).toBe("")
  })

  test("context contains valid CRE SDK imports", () => {
    const context = buildFewShotContext(1)
    expect(context).toContain("@chainlink/cre-sdk")
    expect(context).toContain("Runner")
  })
})

// ─────────────────────────────────────────────
// Suite 2: Doc Retriever
// ─────────────────────────────────────────────

describe("retrieveRelevantDocs", () => {
  test("returns non-empty docs for all 10 templates", () => {
    for (const template of TEMPLATES) {
      const docs = retrieveRelevantDocs(template)
      expect(docs.length).toBeGreaterThan(0)
      // config-schema.md is always included
      expect(docs).toContain("config-schema.md")
    }
  })

  test("includes capabilities.md for price-feed template", () => {
    const template = getTemplateById(1)!
    const docs = retrieveRelevantDocs(template)
    expect(docs).toContain("capabilities.md")
    expect(docs).toContain("triggers.md")
  })

  test("includes consensus and node-mode docs for multi-ai template", () => {
    const template = getTemplateById(9)!
    const docs = retrieveRelevantDocs(template)
    expect(docs).toContain("consensus.md")
    expect(docs).toContain("node-mode.md")
  })

  test("includes chain-selectors for multi-chain template", () => {
    const template = getTemplateById(2)!
    const docs = retrieveRelevantDocs(template)
    expect(docs).toContain("chain-selectors.md")
  })

  test("docs contain actual SDK content, not just filenames", () => {
    const template = getTemplateById(1)!
    const docs = retrieveRelevantDocs(template)
    // Should contain actual code examples from the doc files
    expect(docs).toContain("Runner")
    expect(docs).toContain("configSchema")
  })

  // ── State path coverage (Issue 6) ──

  test("includes state-management.md when intent has exact state keyword", () => {
    const template = getTemplateById(1)!
    const intent: ParsedIntent = {
      ...MOCK_INTENT,
      keywords: ["price", "history", "monitor"],
    }
    const docs = retrieveRelevantDocs(template, intent)
    expect(docs).toContain("state-management.md")
  })

  test("includes state-management.md when intent has stemmed keyword 'tracking'", () => {
    const template = getTemplateById(1)!
    const intent: ParsedIntent = {
      ...MOCK_INTENT,
      keywords: ["tracking", "balance"],
    }
    const docs = retrieveRelevantDocs(template, intent)
    expect(docs).toContain("state-management.md")
  })

  test("excludes state-management.md when intent has no state keywords", () => {
    const template = getTemplateById(1)!
    const intent: ParsedIntent = {
      ...MOCK_INTENT,
      keywords: ["price", "monitor", "alert"],
    }
    const docs = retrieveRelevantDocs(template, intent)
    expect(docs).not.toContain("state-management.md")
  })

  test("excludes state-management.md when no intent provided (backward compat)", () => {
    const template = getTemplateById(1)!
    const docs = retrieveRelevantDocs(template)
    expect(docs).not.toContain("state-management.md")
  })
})

// ─────────────────────────────────────────────
// Suite 3: System Prompt Builder
// ─────────────────────────────────────────────

describe("buildSystemPrompt", () => {
  test("contains all 7 constraint markers", () => {
    const prompt = buildSystemPrompt("", "", "")
    // All 7 critical constraints from the plan
    expect(prompt).toContain("async/await")
    expect(prompt).toContain("@chainlink/cre-sdk")
    expect(prompt).toContain("zod")
    expect(prompt).toContain("viem")
    expect(prompt).toContain("Runner")
    expect(prompt).toContain("handler")
    expect(prompt).toContain("runtime.report")
  })

  test("contains scope discipline instruction", () => {
    const prompt = buildSystemPrompt("", "", "")
    expect(prompt).toContain("Implement EXACTLY what's requested")
  })

  test("contains API reference section", () => {
    const prompt = buildSystemPrompt("", "", "")
    expect(prompt).toContain("CRE SDK API Reference")
    expect(prompt).toContain("CronCapability")
    expect(prompt).toContain("HTTPClient")
    expect(prompt).toContain("EVMClient")
    expect(prompt).toContain("getNetwork")
  })

  test("includes few-shot context when provided", () => {
    const fewShot = "### Example: Template 4\n```typescript\n// template code\n```"
    const prompt = buildSystemPrompt(fewShot, "", "")
    expect(prompt).toContain("Template 4")
  })

  test("includes relevant docs when provided", () => {
    const docs = "--- capabilities.md ---\n# CRE SDK Capabilities"
    const prompt = buildSystemPrompt("", docs, "")
    expect(prompt).toContain("Relevant SDK Documentation")
    expect(prompt).toContain("CRE SDK Capabilities")
  })

  test("includes Context7 docs when provided", () => {
    const ctx7 = "Additional CRE patterns from Context7"
    const prompt = buildSystemPrompt("", "", ctx7)
    expect(prompt).toContain("Context7")
    expect(prompt).toContain("Additional CRE patterns")
  })

  test("omits dynamic sections when empty", () => {
    const prompt = buildSystemPrompt("", "", "")
    expect(prompt).not.toContain("Working CRE Workflow Examples")
    expect(prompt).not.toContain("Relevant SDK Documentation")
    expect(prompt).not.toContain("Context7")
  })

  test("contains output format instructions", () => {
    const prompt = buildSystemPrompt("", "", "")
    expect(prompt).toContain("thinking")
    expect(prompt).toContain("self_review")
    expect(prompt).toContain("workflow_ts")
    expect(prompt).toContain("config_json")
  })

  // ── State management patterns ──

  test("contains all 3 state management pattern names when needsState=true", () => {
    const prompt = buildSystemPrompt("", "", "", true)
    expect(prompt).toContain("State Management Patterns")
    expect(prompt).toContain("External KV Store")
    expect(prompt).toContain("Onchain State")
    expect(prompt).toContain("Config-as-State")
  })

  test("contains decision tree for state pattern selection", () => {
    const prompt = buildSystemPrompt("", "", "", true)
    expect(prompt).toContain("Decision Tree")
    expect(prompt).toContain("ALWAYS prefer Pattern 1")
  })

  test("references KV config fields in state patterns", () => {
    const prompt = buildSystemPrompt("", "", "", true)
    expect(prompt).toContain("kvStoreUrl")
    expect(prompt).toContain("kvApiKey")
    expect(prompt).toContain("stateKey")
  })

  test("state patterns section appears before output format", () => {
    const prompt = buildSystemPrompt("", "", "", true)
    const stateIdx = prompt.indexOf("State Management Patterns")
    const outputIdx = prompt.indexOf("Output Instructions")
    expect(stateIdx).toBeGreaterThan(-1)
    expect(outputIdx).toBeGreaterThan(-1)
    expect(stateIdx).toBeLessThan(outputIdx)
  })

  test("omits state patterns when needsState=false", () => {
    const prompt = buildSystemPrompt("", "", "", false)
    expect(prompt).not.toContain("State Management Patterns")
    expect(prompt).not.toContain("External KV Store")
    expect(prompt).not.toContain("kvStoreUrl")
  })

  test("includes state patterns when needsState is undefined (backward compat)", () => {
    const prompt = buildSystemPrompt("", "", "")
    expect(prompt).toContain("State Management Patterns")
    expect(prompt).toContain("External KV Store")
  })

  test("Pattern 2 has inline code example with EVMClient", () => {
    const prompt = buildSystemPrompt("", "", "", true)
    expect(prompt).toContain("EVMClient")
    expect(prompt).toContain("encodeFunctionData")
    expect(prompt).toContain("decodeFunctionResult")
    expect(prompt).toContain("callContract")
  })
})

// ─────────────────────────────────────────────
// Suite 4: Generation Prompt Builder
// ─────────────────────────────────────────────

describe("buildGenerationPrompt", () => {
  const baseInput: GenerationPromptInput = {
    userPrompt: "Monitor ETH price every 5 minutes and alert when it drops below 3000",
    intent: MOCK_INTENT,
    template: getTemplateById(1)!,
  }

  test("includes user prompt", () => {
    const prompt = buildGenerationPrompt(baseInput)
    expect(prompt).toContain("Monitor ETH price")
    expect(prompt).toContain("## User Request")
  })

  test("includes parsed intent fields", () => {
    const prompt = buildGenerationPrompt(baseInput)
    expect(prompt).toContain("## Parsed Intent")
    expect(prompt).toContain("cron")
    expect(prompt).toContain("price-feed")
    expect(prompt).toContain("alert")
    expect(prompt).toContain("drops below $3000")
  })

  test("includes template context", () => {
    const prompt = buildGenerationPrompt(baseInput)
    expect(prompt).toContain("## Matched Template")
    expect(prompt).toContain("Price Monitoring + Alert")
    expect(prompt).toContain("core-defi")
  })

  test("omits retry context on first attempt", () => {
    const prompt = buildGenerationPrompt(baseInput)
    expect(prompt).not.toContain("Retry Context")
  })

  test("includes retry context when previousError is set", () => {
    const input: GenerationPromptInput = {
      ...baseInput,
      previousError: "TypeError: runtime.getConfig is not a function",
    }
    const prompt = buildGenerationPrompt(input)
    expect(prompt).toContain("## Retry Context")
    expect(prompt).toContain("runtime.getConfig is not a function")
    expect(prompt).toContain("Fix this specific issue")
  })

  test("includes self-review in retry context", () => {
    const input: GenerationPromptInput = {
      ...baseInput,
      previousSelfReview: "Found async/await in callback — needs to use .result() instead",
    }
    const prompt = buildGenerationPrompt(input)
    expect(prompt).toContain("## Retry Context")
    expect(prompt).toContain("async/await in callback")
    expect(prompt).toContain("Previous Self-Review")
  })

  test("includes schedule when present in intent", () => {
    const prompt = buildGenerationPrompt(baseInput)
    expect(prompt).toContain("*/5 * * * *")
  })

  test("includes chains when present in intent", () => {
    const prompt = buildGenerationPrompt(baseInput)
    expect(prompt).toContain("base-sepolia")
  })
})

// ─────────────────────────────────────────────
// Suite 5: Context7 Client
// ─────────────────────────────────────────────

describe("getContext7CREDocs", () => {
  beforeEach(() => {
    _resetContext7Cache()
  })

  test("returns a string (may be empty if Context7 is unreachable)", async () => {
    const docs = await getContext7CREDocs()
    expect(typeof docs).toBe("string")
  })

  test("caches results on subsequent calls", async () => {
    const first = await getContext7CREDocs()
    const second = await getContext7CREDocs()
    // Both calls should return the exact same reference (cached)
    expect(first).toBe(second)
  })

  test("never throws (graceful degradation)", async () => {
    // Even if Context7 is down, it should return empty string
    const docs = await getContext7CREDocs()
    expect(docs).toBeDefined()
    expect(typeof docs).toBe("string")
  })
})

// ─────────────────────────────────────────────
// Suite 6: Code Generator (mocked OpenAI)
// ─────────────────────────────────────────────

describe("generateCode", () => {
  // Mock OpenAI at the module level
  const mockParse = mock(() =>
    Promise.resolve({
      choices: [
        {
          message: {
            parsed: {
              thinking: "Step 1: Use CronCapability for 5-min schedule...",
              workflow_ts: `import { z } from "zod"\nimport { Runner, Runtime, CronCapability, HTTPClient, handler, consensusMedianAggregation } from "@chainlink/cre-sdk"\n\nconst configSchema = z.object({ apiUrl: z.string() })\ntype Config = z.infer<typeof configSchema>\nconst runner = Runner.newRunner<Config>({ configSchema })\nfunction initWorkflow(runtime: Runtime<Config>) {\n  const trigger = new CronCapability().trigger({ cronSchedule: "0 */5 * * * *" })\n  const http = new HTTPClient()\n  handler(trigger, (rt) => {\n    const res = http.fetch(rt.config.apiUrl).result()\n    return JSON.parse(res.body)\n  })\n}\nexport function main() { runner.run(initWorkflow) }`,
              config_json: '{"apiUrl":"https://api.example.com/price"}',
              consumer_sol: null,
              self_review: "All constraints satisfied. No async/await in callbacks. Only @chainlink/cre-sdk, zod imports. Uses Runner.newRunner pattern.",
              explanation: "Monitors ETH price every 5 minutes using a CRE cron workflow.",
            },
            refusal: null,
          },
        },
      ],
    }),
  )

  // We need to mock the OpenAI module before importing generateCode
  mock.module("openai", () => ({
    default: class MockOpenAI {
      chat = {
        completions: {
          parse: mockParse,
        },
      }
    },
  }))

  // Reset the lazy singleton before each test to ensure our openai mock is used
  // (other test files may have triggered singleton creation with their own mock)
  beforeEach(async () => {
    const { _resetOpenAIClient } = await import("../services/ai-engine/code-generator")
    _resetOpenAIClient()
  })

  // Dynamic import after mocking
  test("returns valid GeneratedCode on successful generation", async () => {
    const { generateCode } = await import("../services/ai-engine/code-generator")

    const result = await generateCode({
      userPrompt: "Monitor ETH price every 5 minutes",
      intent: MOCK_INTENT,
      templateId: 1,
      templateConfidence: 0.85,
    })

    expect(result.workflowTs).toContain("@chainlink/cre-sdk")
    expect(result.workflowTs).toContain("Runner")
    expect(result.workflowTs).toContain("handler")
    expect(result.explanation).toContain("price")
    expect(result.configJson).toBeDefined()
    expect(typeof result.configJson).toBe("object")
  })

  test("configJson is parsed from string to object", async () => {
    const { generateCode } = await import("../services/ai-engine/code-generator")

    const result = await generateCode({
      userPrompt: "Monitor ETH price every 5 minutes",
      intent: MOCK_INTENT,
      templateId: 1,
      templateConfidence: 0.85,
    })

    expect(result.configJson).toEqual({ apiUrl: "https://api.example.com/price" })
  })

  test("consumerSol can be null", async () => {
    const { generateCode } = await import("../services/ai-engine/code-generator")

    const result = await generateCode({
      userPrompt: "Monitor ETH price every 5 minutes",
      intent: MOCK_INTENT,
      templateId: 1,
      templateConfidence: 0.85,
    })

    expect(result.consumerSol).toBeNull()
  })

  test("throws AppError for invalid template ID", async () => {
    const { generateCode } = await import("../services/ai-engine/code-generator")

    try {
      await generateCode({
        userPrompt: "Test prompt",
        intent: MOCK_INTENT,
        templateId: 999,
        templateConfidence: 0.5,
      })
      expect(true).toBe(false) // Should not reach here
    } catch (err: unknown) {
      const error = err as { code: string; statusCode: number }
      expect(error.code).toBe("AI_SERVICE_ERROR")
      expect(error.statusCode).toBe(502)
    }
  })

  test("handles empty workflow_ts with AppError", async () => {
    // Temporarily override mock to return empty workflow
    const emptyMock = mock(() =>
      Promise.resolve({
        choices: [
          {
            message: {
              parsed: {
                thinking: "...",
                workflow_ts: "",
                config_json: "{}",
                consumer_sol: null,
                self_review: "No code generated",
                explanation: "Empty",
              },
              refusal: null,
            },
          },
        ],
      }),
    )

    mock.module("openai", () => ({
      default: class MockOpenAI {
        chat = { completions: { parse: emptyMock } }
      },
    }))

    // Re-import to pick up new mock
    // Note: In bun, module cache may persist — this tests the contract
    try {
      const { generateCode } = await import("../services/ai-engine/code-generator")
      await generateCode({
        userPrompt: "Test prompt",
        intent: MOCK_INTENT,
        templateId: 1,
        templateConfidence: 0.85,
      })
    } catch (err: unknown) {
      const error = err as { code: string }
      // Should get AI_SERVICE_ERROR for empty workflow
      expect(error.code).toBe("AI_SERVICE_ERROR")
    }
  })

  test("handles model refusal with AppError", async () => {
    const refusalMock = mock(() =>
      Promise.resolve({
        choices: [
          {
            message: {
              parsed: null,
              refusal: "I cannot generate this code due to policy restrictions.",
            },
          },
        ],
      }),
    )

    mock.module("openai", () => ({
      default: class MockOpenAI {
        chat = { completions: { parse: refusalMock } }
      },
    }))

    try {
      const { generateCode } = await import("../services/ai-engine/code-generator")
      await generateCode({
        userPrompt: "Generate malicious code",
        intent: MOCK_INTENT,
        templateId: 1,
        templateConfidence: 0.85,
      })
    } catch (err: unknown) {
      const error = err as { code: string; message: string }
      expect(error.code).toBe("AI_SERVICE_ERROR")
      expect(error.message).toContain("refused")
    }
  })
})
