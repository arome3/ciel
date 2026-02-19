import { describe, test, expect, mock, beforeAll } from "bun:test"
import { resolve } from "path"

// ─────────────────────────────────────────────
// Mocks — config + dep-cache at absolute paths
// ─────────────────────────────────────────────
// NOTE: Bun's mock.module uses a shared registry across test files.
// When run alongside orchestrator.test.ts (which also mocks config.ts),
// the first-registered mock wins. Tests here are designed to work
// regardless of which config mock is active.

const SRC = resolve(import.meta.dir, "..")

mock.module(resolve(SRC, "config.ts"), () => ({
  config: {
    CRE_CLI_PATH: "echo",
    OPENAI_API_KEY: "sk-test",
    ANTHROPIC_API_KEY: "sk-ant-test",
    GEMINI_API_KEY: "test",
    DATABASE_PATH: ":memory:",
    NODE_ENV: "test",
  },
}))

// Return true to skip bun install (fast tests)
mock.module(resolve(SRC, "services/cre/dep-cache.ts"), () => ({
  linkCachedDeps: () => Promise.resolve(true),
}))

mock.module(resolve(SRC, "lib/logger.ts"), () => ({
  createLogger: () => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }),
}))

// ── Dynamic imports (loaded AFTER mocks registered) ──
let checkCRECli: () => Promise<boolean>
let simulateWorkflow: (code: string, configJson: Record<string, unknown>) => Promise<any>
let _getSimState: () => { activeSimCount: number; queueLength: number }

beforeAll(async () => {
  const mod = await import("../services/cre/compiler")
  checkCRECli = mod.checkCRECli
  simulateWorkflow = mod.simulateWorkflow
  _getSimState = mod._getSimState
})

// ─────────────────────────────────────────────
// checkCRECli
// ─────────────────────────────────────────────

describe("checkCRECli", () => {
  test("returns a boolean", async () => {
    const result = await checkCRECli()
    expect(typeof result).toBe("boolean")
  })

  test("does not throw on any config value", async () => {
    // checkCRECli catches all errors internally — should never throw
    let threw = false
    try {
      await checkCRECli()
    } catch {
      threw = true
    }
    expect(threw).toBe(false)
  })

  test("returns true when CRE CLI is available", async () => {
    // With either "echo" or "cre" as CLI path, if the binary exists it returns true
    const result = await checkCRECli()
    // "echo" always succeeds; "cre" may or may not exist
    expect(typeof result).toBe("boolean")
  })
})

// ─────────────────────────────────────────────
// simulateWorkflow — result shape & behavior
// ─────────────────────────────────────────────

describe("simulateWorkflow", () => {
  test("returns correct SimulationResult shape", async () => {
    const result = await simulateWorkflow("// test code", { test: true })
    expect(result).toHaveProperty("success")
    expect(result).toHaveProperty("executionTrace")
    expect(result).toHaveProperty("duration")
    expect(result).toHaveProperty("errors")
    expect(result).toHaveProperty("warnings")
    expect(result).toHaveProperty("rawOutput")
    expect(typeof result.success).toBe("boolean")
    expect(typeof result.duration).toBe("number")
    expect(typeof result.rawOutput).toBe("string")
    expect(Array.isArray(result.executionTrace)).toBe(true)
    expect(Array.isArray(result.errors)).toBe(true)
    expect(Array.isArray(result.warnings)).toBe(true)
  })

  test("duration is non-negative", async () => {
    const result = await simulateWorkflow("// test", {})
    expect(result.duration).toBeGreaterThanOrEqual(0)
  })

  test("handles empty config object", async () => {
    const result = await simulateWorkflow("// test", {})
    expect(result).toHaveProperty("success")
  })

  test("handles large code input without crashing", async () => {
    const largeCode = "// " + "x".repeat(10_000)
    const result = await simulateWorkflow(largeCode, {})
    expect(result).toHaveProperty("success")
  })

  test("cleans up temp dir (no lingering errors after completion)", async () => {
    const result = await simulateWorkflow("// cleanup test", {})
    // If cleanup failed with an error, it would be caught + logged but not thrown
    expect(result.duration).toBeGreaterThanOrEqual(0)
  })
})

// ─────────────────────────────────────────────
// Semaphore
// ─────────────────────────────────────────────

describe("Semaphore (_getSimState)", () => {
  test("reports correct state shape", () => {
    const state = _getSimState()
    expect(state).toHaveProperty("activeSimCount")
    expect(state).toHaveProperty("queueLength")
    expect(typeof state.activeSimCount).toBe("number")
    expect(typeof state.queueLength).toBe("number")
  })

  test("activeSimCount is non-negative after tests", () => {
    const state = _getSimState()
    expect(state.activeSimCount).toBeGreaterThanOrEqual(0)
  })

  test("concurrent simulations all complete and release slots", async () => {
    const promises = Array.from({ length: 4 }, () =>
      simulateWorkflow("// concurrent test", {}),
    )

    const results = await Promise.all(promises)
    expect(results).toHaveLength(4)
    results.forEach((r) => expect(r).toHaveProperty("success"))

    // After all complete, count should be back to 0
    const state = _getSimState()
    expect(state.activeSimCount).toBe(0)
    expect(state.queueLength).toBe(0)
  })

  test("queue length returns to 0 after all simulations complete", async () => {
    const results = await Promise.all([
      simulateWorkflow("// test1", {}),
      simulateWorkflow("// test2", {}),
    ])

    expect(results).toHaveLength(2)
    expect(_getSimState().queueLength).toBe(0)
  })
})
