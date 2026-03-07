import { describe, test, expect, mock, beforeEach, beforeAll } from "bun:test"
import { resolve } from "path"

// ─────────────────────────────────────────────
// Mocks — External boundaries only
// ─────────────────────────────────────────────

const SRC = resolve(import.meta.dir, "..")

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

// ── Mock cre-utils (external process boundary) ──
const mockRunCommand = mock(() =>
  Promise.resolve({
    stdout: "Workflow compiled\nSimulation complete",
    stderr: "",
    exitCode: 0,
    timedOut: false,
  }),
)

const mockWithCREWorkspace = mock(async (options: any, callback: any) => {
  return callback("/tmp/fake-workspace", { PATH: "/usr/bin" })
})

const mockLinkCachedDeps = mock(() => Promise.resolve(true))

mock.module(resolve(SRC, "services/cre/cre-utils.ts"), () => ({
  withCREWorkspace: mockWithCREWorkspace,
  runCommand: mockRunCommand,
  WF_SUBDIR: "wf",
  buildCREEnv: () => ({ PATH: "/usr/bin" }),
  buildPackageJson: () => "{}",
  truncate: (text: string, max: number) => text.slice(0, max),
  MAX_OUTPUT_BYTES: 2 * 1024 * 1024,
  parseDonWorkflowId: () => "test-id",
}))

mock.module(resolve(SRC, "services/cre/dep-cache.ts"), () => ({
  linkCachedDeps: mockLinkCachedDeps,
}))

// ── Dynamic import (loaded AFTER mocks) ──
let compileCheck: (code: string, configJson: Record<string, unknown>) => Promise<any>
let _getCompileState: () => { activeCount: number; queueLength: number }

beforeAll(async () => {
  const mod = await import("../services/ai-engine/compile-feedback")
  compileCheck = mod.compileCheck
  _getCompileState = mod._getCompileState
})

beforeEach(() => {
  mockRunCommand.mockClear()
  mockWithCREWorkspace.mockClear()
  // Reset to successful compilation
  mockWithCREWorkspace.mockImplementation(async (options: any, callback: any) => {
    return callback("/tmp/fake-workspace", { PATH: "/usr/bin" })
  })
  mockRunCommand.mockImplementation(() =>
    Promise.resolve({
      stdout: "Workflow compiled\nSimulation complete",
      stderr: "",
      exitCode: 0,
      timedOut: false,
    }),
  )
})

// ─────────────────────────────────────────────
// Suite 1: Successful Compilation
// ─────────────────────────────────────────────

describe("compileCheck — success", () => {
  test("returns compiled: true when 'Workflow compiled' in output", async () => {
    const result = await compileCheck("const x = 1", { apiUrl: "https://example.com" })
    expect(result.compiled).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.rawOutput).toContain("Workflow compiled")
  })

  test("passes code and config to withCREWorkspace", async () => {
    const code = "export async function main() {}"
    const config = { key: "value" }
    await compileCheck(code, config)

    expect(mockWithCREWorkspace).toHaveBeenCalledTimes(1)
    const options = mockWithCREWorkspace.mock.calls[0][0]
    expect(options.prefix).toBe("ciel-compile")
    expect(options.code).toBe(code)
    expect(options.configJson).toEqual(config)
  })
})

// ─────────────────────────────────────────────
// Suite 2: Failed Compilation
// ─────────────────────────────────────────────

describe("compileCheck — failure", () => {
  test("returns compiled: false with parsed errors", async () => {
    mockRunCommand.mockImplementation(() =>
      Promise.resolve({
        stdout: "",
        stderr: "main.ts(5,10): error TS2304: Cannot find name 'HTTPClient'\n" +
                "main.ts(8,3): error TS2339: Property 'result' does not exist",
        exitCode: 1,
        timedOut: false,
      }),
    )

    const result = await compileCheck("bad code", {})
    expect(result.compiled).toBe(false)
    expect(result.errors.length).toBe(2)
    expect(result.errors[0]).toContain("Cannot find name 'HTTPClient'")
    expect(result.errors[1]).toContain("Property 'result' does not exist")
  })

  test("returns generic message when no specific errors parsed", async () => {
    mockRunCommand.mockImplementation(() =>
      Promise.resolve({
        stdout: "Something went wrong",
        stderr: "",
        exitCode: 1,
        timedOut: false,
      }),
    )

    const result = await compileCheck("bad code", {})
    expect(result.compiled).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })
})

// ─────────────────────────────────────────────
// Suite 3: Timeout Handling
// ─────────────────────────────────────────────

describe("compileCheck — timeout", () => {
  test("returns timeout error when compilation times out", async () => {
    mockRunCommand.mockImplementation(() =>
      Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 1,
        timedOut: true,
      }),
    )

    const result = await compileCheck("slow code", {})
    expect(result.compiled).toBe(false)
    expect(result.errors.some((e: string) => e.includes("timed out"))).toBe(true)
  })
})

// ─────────────────────────────────────────────
// Suite 4: Never-Throw Guarantee
// ─────────────────────────────────────────────

describe("compileCheck — never throws", () => {
  test("returns graceful error when workspace creation fails", async () => {
    mockWithCREWorkspace.mockImplementation(() => {
      throw new Error("ENOENT: CRE CLI not found")
    })

    const result = await compileCheck("some code", {})
    expect(result.compiled).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]).toContain("unavailable")
  })

  test("returns graceful error when callback throws", async () => {
    mockWithCREWorkspace.mockImplementation(async (_opts: any, callback: any) => {
      throw new Error("Disk full")
    })

    const result = await compileCheck("some code", {})
    expect(result.compiled).toBe(false)
    expect(result.errors[0]).toContain("Disk full")
  })
})

// ─────────────────────────────────────────────
// Suite 5: Semaphore State
// ─────────────────────────────────────────────

describe("compileCheck — semaphore", () => {
  test("semaphore starts at 0 active", () => {
    const state = _getCompileState()
    expect(state.activeCount).toBe(0)
    expect(state.queueLength).toBe(0)
  })
})

// ─────────────────────────────────────────────
// Suite 6: Output Truncation
// ─────────────────────────────────────────────

describe("compileCheck — output handling", () => {
  test("rawOutput is included in result", async () => {
    const result = await compileCheck("const x = 1", {})
    expect(result.rawOutput).toBeDefined()
    expect(typeof result.rawOutput).toBe("string")
  })

  test("deduplicates identical error messages", async () => {
    mockRunCommand.mockImplementation(() =>
      Promise.resolve({
        stdout: "",
        stderr: "error TS2304: Cannot find name 'foo'\nerror TS2304: Cannot find name 'foo'\n",
        exitCode: 1,
        timedOut: false,
      }),
    )

    const result = await compileCheck("bad code", {})
    expect(result.compiled).toBe(false)
    // Should deduplicate identical errors
    expect(result.errors.length).toBe(1)
  })
})
