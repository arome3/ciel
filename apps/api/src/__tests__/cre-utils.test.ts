import { describe, test, expect, mock, beforeAll } from "bun:test"
import { resolve } from "path"

// ─────────────────────────────────────────────
// Mocks — external boundaries only
// ─────────────────────────────────────────────

const SRC = resolve(import.meta.dir, "..")

mock.module(resolve(SRC, "config.ts"), () => ({
  config: {
    CRE_CLI_PATH: "echo",
    OPENAI_API_KEY: "sk-test",
    ANTHROPIC_API_KEY: "sk-ant-test",
    GEMINI_API_KEY: "test",
    NODE_ENV: "test",
  },
}))

mock.module(resolve(SRC, "lib/logger.ts"), () => ({
  createLogger: () => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }),
}))

// Return true to skip bun install
mock.module(resolve(SRC, "services/cre/dep-cache.ts"), () => ({
  linkCachedDeps: () => Promise.resolve(true),
}))

// ── Dynamic import ──
let truncate: (text: string, maxBytes: number) => string
let buildPackageJson: (prefix: string) => string
let buildCREEnv: () => Record<string, string | undefined>
let runCommand: (...args: any[]) => Promise<any>
let withCREWorkspace: (options: any, callback: any) => Promise<any>
let MAX_OUTPUT_BYTES: number
let parseDonWorkflowId: (output: string) => string

beforeAll(async () => {
  const mod = await import("../services/cre/cre-utils")
  truncate = mod.truncate
  buildPackageJson = mod.buildPackageJson
  buildCREEnv = mod.buildCREEnv
  runCommand = mod.runCommand
  withCREWorkspace = mod.withCREWorkspace
  MAX_OUTPUT_BYTES = mod.MAX_OUTPUT_BYTES
  parseDonWorkflowId = mod.parseDonWorkflowId
})

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

describe("truncate", () => {
  test("short text returned unchanged", () => {
    expect(truncate("hello", 100)).toBe("hello")
  })

  test("long text truncated with marker", () => {
    const result = truncate("abcdef", 3)
    expect(result).toBe("abc\n[truncated]")
  })

  test("exact-length text returned unchanged", () => {
    expect(truncate("abc", 3)).toBe("abc")
  })
})

describe("buildPackageJson", () => {
  test("returns valid JSON", () => {
    const json = buildPackageJson("ciel-sim")
    expect(() => JSON.parse(json)).not.toThrow()
  })

  test("uses correct prefix in name", () => {
    const parsed = JSON.parse(buildPackageJson("ciel-deploy"))
    expect(parsed.name).toStartWith("ciel-deploy-")
  })

  test("includes required dependencies", () => {
    const parsed = JSON.parse(buildPackageJson("test"))
    expect(parsed.dependencies).toHaveProperty("@chainlink/cre-sdk")
    expect(parsed.dependencies).toHaveProperty("zod")
  })

  test("marked as private", () => {
    const parsed = JSON.parse(buildPackageJson("test"))
    expect(parsed.private).toBe(true)
  })
})

describe("buildCREEnv", () => {
  test("includes CRE secret keys", () => {
    const env = buildCREEnv()
    expect(env.CRE_SECRET_OPENAI_API_KEY).toBe("sk-test")
    expect(env.CRE_SECRET_ANTHROPIC_API_KEY).toBe("sk-ant-test")
    expect(env.CRE_SECRET_GEMINI_API_KEY).toBe("test")
  })

  test("includes PATH", () => {
    const env = buildCREEnv()
    expect(env.PATH).toBeDefined()
  })
})

describe("MAX_OUTPUT_BYTES", () => {
  test("is 2 MB", () => {
    expect(MAX_OUTPUT_BYTES).toBe(2 * 1024 * 1024)
  })
})

describe("runCommand", () => {
  test("success with echo", async () => {
    const result = await runCommand(
      ["echo", "hello"],
      "/tmp",
      { PATH: process.env.PATH },
      5000,
      "test echo",
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe("hello")
  })

  test("non-zero exit with false", async () => {
    const result = await runCommand(
      ["false"],
      "/tmp",
      { PATH: process.env.PATH },
      5000,
      "test false",
    )
    expect(result.exitCode).not.toBe(0)
  })
})

describe("parseDonWorkflowId", () => {
  test("parses workflow_id: format", () => {
    const id = parseDonWorkflowId("workflow_id: a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d")
    expect(id).toBe("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d")
  })

  test("parses workflow-id: format", () => {
    const id = parseDonWorkflowId("workflow-id: a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d")
    expect(id).toBe("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d")
  })

  test("parses workflowId: format", () => {
    const id = parseDonWorkflowId("workflowId: a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d")
    expect(id).toBe("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d")
  })

  test("falls back to bare UUID when no keyword", () => {
    const id = parseDonWorkflowId("Deploy complete. ID=a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d done")
    expect(id).toBe("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d")
  })

  test("prefers keyword match over bare UUID", () => {
    const output = [
      "random thing 11111111-2222-3333-4444-555555555555",
      "workflow_id: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    ].join("\n")

    const id = parseDonWorkflowId(output)
    expect(id).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
  })

  test("throws when no UUID found in output", () => {
    expect(() => parseDonWorkflowId("no uuid here at all")).toThrow()
  })
})

describe("withCREWorkspace", () => {
  test("callback receives valid cwd", async () => {
    let receivedCwd = ""

    await withCREWorkspace(
      {
        prefix: "ciel-test",
        code: "// test",
        configJson: { test: true },
      },
      async (cwd: string) => {
        receivedCwd = cwd
        return "ok"
      },
    )

    expect(receivedCwd).toContain("ciel-test")
  })

  test("returns callback result", async () => {
    const result = await withCREWorkspace(
      {
        prefix: "ciel-test",
        code: "// test",
        configJson: {},
      },
      async () => ({ answer: 42 }),
    )

    expect(result).toEqual({ answer: 42 })
  })

  test("temp dir cleaned up after success", async () => {
    const { existsSync } = await import("node:fs")

    let capturedDir = ""
    await withCREWorkspace(
      {
        prefix: "ciel-test",
        code: "// test",
        configJson: {},
      },
      async (cwd: string) => {
        capturedDir = cwd
        return null
      },
    )

    expect(existsSync(capturedDir)).toBe(false)
  })

  test("temp dir cleaned up on callback throw", async () => {
    const { existsSync } = await import("node:fs")

    let capturedDir = ""
    try {
      await withCREWorkspace(
        {
          prefix: "ciel-test",
          code: "// test",
          configJson: {},
        },
        async (cwd: string) => {
          capturedDir = cwd
          throw new Error("callback failed")
        },
      )
    } catch {
      // expected
    }

    expect(existsSync(capturedDir)).toBe(false)
  })

  test("semaphore released when callback throws", async () => {
    const { Semaphore } = await import("../lib/semaphore")
    const sem = new Semaphore(1)

    try {
      await withCREWorkspace(
        {
          prefix: "ciel-test",
          code: "// test",
          configJson: {},
          semaphore: sem,
        },
        async () => { throw new Error("boom") },
      )
    } catch { /* expected */ }

    expect(sem._getState().activeCount).toBe(0)
  })

  test("semaphore acquired and released", async () => {
    const { Semaphore } = await import("../lib/semaphore")
    const sem = new Semaphore(1)

    await withCREWorkspace(
      {
        prefix: "ciel-test",
        code: "// test",
        configJson: {},
        semaphore: sem,
      },
      async () => {
        // During callback, semaphore should be acquired
        expect(sem._getState().activeCount).toBe(1)
        return null
      },
    )

    // After completion, semaphore should be released
    expect(sem._getState().activeCount).toBe(0)
  })
})
