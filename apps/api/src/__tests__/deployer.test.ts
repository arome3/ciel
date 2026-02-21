import { describe, test, expect, mock, beforeAll } from "bun:test"
import { resolve } from "path"
import { writeFileSync, chmodSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

// ─────────────────────────────────────────────
// Create a fake CRE CLI that outputs a workflow ID
// ─────────────────────────────────────────────

const FAKE_CRE = join(tmpdir(), "fake-cre-deployer-test.sh")
writeFileSync(
  FAKE_CRE,
  '#!/bin/sh\necho "workflow_id: a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"\n',
)
chmodSync(FAKE_CRE, 0o755)

// ─────────────────────────────────────────────
// Mocks — external boundaries only
// ─────────────────────────────────────────────

const SRC = resolve(import.meta.dir, "..")

mock.module(resolve(SRC, "config.ts"), () => ({
  config: {
    CRE_CLI_PATH: FAKE_CRE,
    OPENAI_API_KEY: "sk-test",
    ANTHROPIC_API_KEY: "sk-ant-test",
    GEMINI_API_KEY: "test",
    CONSUMER_CONTRACT_ADDRESS: "0xTestConsumer",
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

// ── Dynamic import (loaded AFTER mocks registered) ──
let deployWorkflow: (input: any) => Promise<any>
let _getDeployState: (() => { activeCount: number; queueLength: number }) | undefined

beforeAll(async () => {
  const mod = await import("../services/cre/deployer")
  deployWorkflow = mod.deployWorkflow
  // May be undefined when mock.module leaks from other test files
  _getDeployState = mod._getDeployState
})

// ─────────────────────────────────────────────
// deployWorkflow — success paths
// ─────────────────────────────────────────────

describe("deployWorkflow", () => {
  test("returns DeployResult shape on success", async () => {
    const result = await deployWorkflow({
      code: "// test workflow code",
      configJson: { test: true },
      consumerAddress: "0xTestConsumer",
    })

    expect(result).toHaveProperty("donWorkflowId")
    expect(result).toHaveProperty("success")
    expect(result.success).toBe(true)
    expect(typeof result.donWorkflowId).toBe("string")
    expect(result.donWorkflowId.length).toBeGreaterThan(0)
  })

  test("handles empty config without crashing", async () => {
    const result = await deployWorkflow({
      code: "// minimal workflow",
      configJson: {},
      consumerAddress: "0xTestConsumer",
    })

    expect(result).toHaveProperty("success")
    expect(result.success).toBe(true)
  })

  test("handles large code input", async () => {
    const largeCode = "// " + "x".repeat(10_000)
    const result = await deployWorkflow({
      code: largeCode,
      configJson: { large: true },
      consumerAddress: "0xTestConsumer",
    })

    expect(result).toHaveProperty("success")
    expect(result.success).toBe(true)
  })
})

// ─────────────────────────────────────────────
// Concurrency — _getDeployState
// NOTE: Tests guard against mock.module leaking from
// publish.test.ts/redeploy.test.ts which mock deployer.ts.
// Run `bun test deployer.test.ts` individually for full coverage.
// ─────────────────────────────────────────────

describe("deployer concurrency", () => {
  test("_getDeployState returns correct shape", () => {
    if (!_getDeployState) return // Skip when mocked by other tests

    const state = _getDeployState()
    expect(state).toHaveProperty("activeCount")
    expect(state).toHaveProperty("queueLength")
    expect(typeof state.activeCount).toBe("number")
    expect(typeof state.queueLength).toBe("number")
  })

  test("concurrent deploys all complete and release slots", async () => {
    if (!_getDeployState) return // Skip when mocked by other tests

    const promises = Array.from({ length: 4 }, () =>
      deployWorkflow({
        code: "// concurrent deploy test",
        configJson: {},
        consumerAddress: "0xTestConsumer",
      }),
    )

    const results = await Promise.all(promises)
    expect(results).toHaveLength(4)
    results.forEach((r) => expect(r.success).toBe(true))

    const state = _getDeployState()
    expect(state.activeCount).toBe(0)
    expect(state.queueLength).toBe(0)
  })
})
