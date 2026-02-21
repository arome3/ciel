import { describe, test, expect, mock, beforeAll } from "bun:test"
import { resolve } from "path"

// ─────────────────────────────────────────────
// Mocks — separate file because mock.module can't
// be re-registered. This uses CRE_CLI_PATH: "false"
// (always exits non-zero) to test error paths.
//
// NOTE: When run in full suite, publish.test.ts may
// leak its deployer mock (which always succeeds).
// Run `bun test deployer-error.test.ts` individually
// for full coverage of error paths.
// ─────────────────────────────────────────────

const SRC = resolve(import.meta.dir, "..")

mock.module(resolve(SRC, "config.ts"), () => ({
  config: {
    CRE_CLI_PATH: "false",
    OPENAI_API_KEY: "sk-test",
    ANTHROPIC_API_KEY: "sk-ant-test",
    GEMINI_API_KEY: "test",
    CONSUMER_CONTRACT_ADDRESS: "0xTestConsumer",
    NODE_ENV: "test",
  },
}))

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

// ── DB mock (deployer.ts imports db for handleDeployResult) ──
mock.module(resolve(SRC, "db/index.ts"), () => ({
  db: {
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  },
  sqlite: {},
}))

mock.module(resolve(SRC, "db/schema.ts"), () => ({
  workflows: {
    id: "id",
    donWorkflowId: "don_workflow_id",
    deployStatus: "deploy_status",
    updatedAt: "updated_at",
  },
}))

// ── Emitter mock ──
mock.module(resolve(SRC, "services/events/emitter.ts"), () => ({
  emitEvent: () => {},
}))

let deployWorkflow: (input: any) => Promise<any>
let isRealModule = false

beforeAll(async () => {
  const mod = await import("../services/cre/deployer")
  deployWorkflow = mod.deployWorkflow
  // Detect if we got the real module or a mock from another test
  isRealModule = typeof mod._getDeployState === "function"
})

// ─────────────────────────────────────────────
// Tests — error paths
// ─────────────────────────────────────────────

describe("deployWorkflow — error paths", () => {
  test("non-zero exit code throws AppError with DEPLOY_FAILED", async () => {
    if (!isRealModule) return // Skip when mocked by other tests

    try {
      await deployWorkflow({
        code: "// test",
        configJson: {},
        consumerAddress: "0x0",
      })
      // Should not reach here
      expect(true).toBe(false)
    } catch (err: any) {
      // CRE_CLI_PATH is "false" which exits non-zero but may throw
      // DEPLOY_FAILED if no workflow ID found in output (parseDonWorkflowId)
      expect(err.code).toBe("DEPLOY_FAILED")
      expect(err.statusCode).toBe(500)
    }
  })

  test("AppError is re-thrown as-is", async () => {
    if (!isRealModule) return // Skip when mocked by other tests

    // The "false" command exits 1, which triggers an AppError with DEPLOY_FAILED
    // This verifies the re-throw path: `if (err instanceof AppError) throw err`
    try {
      await deployWorkflow({
        code: "// test",
        configJson: {},
        consumerAddress: "0x0",
      })
      expect(true).toBe(false)
    } catch (err: any) {
      // Verify it's a proper AppError, not wrapped in another
      expect(err.constructor.name).toBe("AppError")
      expect(typeof err.code).toBe("string")
      expect(typeof err.statusCode).toBe("number")
    }
  })
})
