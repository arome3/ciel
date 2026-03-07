import { describe, test, expect } from "bun:test"
import { resolveErrors, extractCategory, getFixPatternsForCategories, getPreSeedCategories } from "../services/ai-engine/error-resolver"
import type { CompileFeedback } from "../services/ai-engine/compile-feedback"

// ─────────────────────────────────────────────
// Suite 1: Category Extraction
// ─────────────────────────────────────────────

describe("extractCategory", () => {
  test("extracts [IMPORT] prefix", () => {
    expect(extractCategory("[IMPORT] Forbidden import: axios")).toBe("IMPORT")
  })

  test("extracts [ASYNC] prefix", () => {
    expect(extractCategory("[ASYNC] async/await found in handler callback")).toBe("ASYNC")
  })

  test("extracts [NONDET] prefix", () => {
    expect(extractCategory("[NONDET] Date.now() used in handler block")).toBe("NONDET")
  })

  test("extracts [CONFIG_MISMATCH] multi-word prefix", () => {
    expect(extractCategory("[CONFIG_MISMATCH] Field 'apiUrl' not in config")).toBe("CONFIG_MISMATCH")
  })

  test("returns null for no prefix", () => {
    expect(extractCategory("Some error without category")).toBeNull()
  })

  test("returns null for empty string", () => {
    expect(extractCategory("")).toBeNull()
  })

  test("returns null for malformed prefix", () => {
    expect(extractCategory("[lowercase] not valid")).toBeNull()
  })
})

// ─────────────────────────────────────────────
// Suite 2: Fix Pattern Lookup
// ─────────────────────────────────────────────

describe("resolveErrors — fix pattern lookup", () => {
  test("returns fix pattern for [IMPORT] errors", () => {
    const result = resolveErrors(["[IMPORT] Forbidden import: axios"])
    expect(result.fixPatterns).toContain("[IMPORT]")
    expect(result.fixPatterns).toContain("@chainlink/cre-sdk")
  })

  test("returns fix pattern for [ASYNC] errors", () => {
    const result = resolveErrors(["[ASYNC] async keyword found in handler"])
    expect(result.fixPatterns).toContain("[ASYNC]")
    expect(result.fixPatterns).toContain(".result()")
  })

  test("returns fix pattern for [NONDET] errors", () => {
    const result = resolveErrors(["[NONDET] Date.now() in handler block"])
    expect(result.fixPatterns).toContain("runtime.now()")
  })

  test("returns fix pattern for [VIEM] errors", () => {
    const result = resolveErrors(["[VIEM] encodeFunctionData is banned"])
    expect(result.fixPatterns).toContain("encodeAbiParameters")
  })

  test("returns fix pattern for [CONFIG] errors", () => {
    const result = resolveErrors(["[CONFIG] Missing configSchema"])
    expect(result.fixPatterns).toContain("configSchema")
  })

  test("returns fix pattern for [TSC] errors", () => {
    const result = resolveErrors(["[TSC] Type error in workflow"])
    expect(result.fixPatterns).toContain("Runtime<Config>")
  })

  test("returns fix pattern for [ZOD] errors", () => {
    const result = resolveErrors(["[ZOD] Missing zod schema"])
    expect(result.fixPatterns).toContain("z.object")
  })

  test("returns fix pattern for [MAIN] errors", () => {
    const result = resolveErrors(["[MAIN] Missing export async function main"])
    expect(result.fixPatterns).toContain("export async function main")
  })

  test("returns fix pattern for [STATE] errors", () => {
    const result = resolveErrors(["[STATE] Missing ConfidentialHTTPClient"])
    expect(result.fixPatterns).toContain("ConfidentialHTTPClient")
  })

  test("deduplicates categories", () => {
    const result = resolveErrors([
      "[IMPORT] Forbidden import: axios",
      "[IMPORT] Forbidden import: ethers",
    ])
    // Should only have one [IMPORT] section
    const importCount = (result.fixPatterns.match(/### \[IMPORT\]/g) || []).length
    expect(importCount).toBe(1)
  })

  test("combines multiple category fix patterns", () => {
    const result = resolveErrors([
      "[IMPORT] Forbidden import: axios",
      "[ASYNC] async in handler",
      "[NONDET] Date.now()",
    ])
    expect(result.fixPatterns).toContain("[IMPORT]")
    expect(result.fixPatterns).toContain("[ASYNC]")
    expect(result.fixPatterns).toContain("[NONDET]")
  })

  test("returns empty fixPatterns for unknown categories", () => {
    const result = resolveErrors(["[UNKNOWN_CAT] some error"])
    expect(result.fixPatterns).toBe("")
  })

  test("returns empty fixPatterns for no-category errors", () => {
    const result = resolveErrors(["Some error without category prefix"])
    expect(result.fixPatterns).toBe("")
  })

  test("returns empty fixPatterns for empty errors array", () => {
    const result = resolveErrors([])
    expect(result.fixPatterns).toBe("")
  })
})

// ─────────────────────────────────────────────
// Suite 3: Compile Context Formatting
// ─────────────────────────────────────────────

describe("resolveErrors — compile context", () => {
  test("formats compilation errors with line numbers", () => {
    const feedback: CompileFeedback = {
      compiled: false,
      errors: ["Cannot find name 'HTTPClient'", "Property 'result' does not exist on type 'void'"],
      rawOutput: "error stuff",
    }
    const result = resolveErrors([], feedback)
    expect(result.compileContext).toContain("1. Cannot find name 'HTTPClient'")
    expect(result.compileContext).toContain("2. Property 'result' does not exist on type 'void'")
    expect(result.compileContext).toContain("REAL TypeScript compilation errors")
  })

  test("returns empty compileContext when compiled successfully", () => {
    const feedback: CompileFeedback = {
      compiled: true,
      errors: [],
      rawOutput: "Workflow compiled",
    }
    const result = resolveErrors([], feedback)
    expect(result.compileContext).toBe("")
  })

  test("returns empty compileContext when no feedback provided", () => {
    const result = resolveErrors(["[IMPORT] error"])
    expect(result.compileContext).toBe("")
  })

  test("combines fix patterns and compile context", () => {
    const feedback: CompileFeedback = {
      compiled: false,
      errors: ["Type 'string' is not assignable to type 'number'"],
      rawOutput: "error",
    }
    const result = resolveErrors(["[TSC] Type error"], feedback)
    expect(result.fixPatterns).toContain("[TSC]")
    expect(result.compileContext).toContain("Type 'string'")
  })
})

// ─────────────────────────────────────────────
// Suite 4: getFixPatternsForCategories
// ─────────────────────────────────────────────

describe("getFixPatternsForCategories", () => {
  test("returns patterns for given categories", () => {
    const result = getFixPatternsForCategories(["ALIGN", "TSC"])
    expect(result).toContain("[ALIGN]")
    expect(result).toContain("[TSC]")
    expect(result).toContain("Proactive Guidance")
  })

  test("returns empty string for no matching categories", () => {
    const result = getFixPatternsForCategories(["UNKNOWN"])
    expect(result).toBe("")
  })

  test("returns empty string for empty array", () => {
    const result = getFixPatternsForCategories([])
    expect(result).toBe("")
  })

  test("skips unknown categories but includes known ones", () => {
    const result = getFixPatternsForCategories(["UNKNOWN", "ASYNC"])
    expect(result).toContain("[ASYNC]")
    expect(result).not.toContain("UNKNOWN")
  })
})

// ─────────────────────────────────────────────
// Suite 5: getPreSeedCategories
// ─────────────────────────────────────────────

describe("getPreSeedCategories", () => {
  test("HTTP trigger returns ALIGN", () => {
    const cats = getPreSeedCategories("http", [])
    expect(cats).toContain("ALIGN")
  })

  test("evmWrite capability returns TSC", () => {
    const cats = getPreSeedCategories("cron", ["evmWrite"])
    expect(cats).toContain("TSC")
  })

  test("multi-ai capability returns ASYNC and NONDET", () => {
    const cats = getPreSeedCategories("http", ["multi-ai"])
    expect(cats).toContain("ASYNC")
    expect(cats).toContain("NONDET")
  })

  test("T9-like template (http + multi-ai + evmWrite) returns all relevant", () => {
    const cats = getPreSeedCategories("http", ["multi-ai", "evmWrite", "news-api"])
    expect(cats).toContain("ALIGN")
    expect(cats).toContain("TSC")
    expect(cats).toContain("ASYNC")
    expect(cats).toContain("NONDET")
  })

  test("cron trigger with no special capabilities returns empty", () => {
    const cats = getPreSeedCategories("cron", ["price-feed"])
    expect(cats).toHaveLength(0)
  })

  test("evm_log trigger with evmWrite returns TSC only", () => {
    const cats = getPreSeedCategories("evm_log", ["evmWrite", "wallet-api"])
    expect(cats).toContain("TSC")
    expect(cats).not.toContain("ALIGN")
  })
})
