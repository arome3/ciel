import { describe, test, expect, mock, beforeAll, beforeEach } from "bun:test"
import { resolve } from "path"

// ─────────────────────────────────────────────
// Mocks — external boundaries only
// ─────────────────────────────────────────────

const SRC = resolve(import.meta.dir, "..")

mock.module(resolve(SRC, "config.ts"), () => ({
  config: {
    NODE_ENV: "test",
    DATABASE_PATH: ":memory:",
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

// ── DB mock ──
let mockSelectAll: any[] = []
let mockUpdateError = false
let updateCalls: any[] = []

const mockUpdateWhere = mock(() => {
  if (mockUpdateError) return Promise.reject(new Error("DB error"))
  return Promise.resolve()
})
const mockUpdateSet = mock((vals: any) => {
  updateCalls.push(vals)
  return { where: mockUpdateWhere }
})
const mockUpdate = mock(() => ({ set: mockUpdateSet }))

const mockSelectAll_fn = mock(() => Promise.resolve(mockSelectAll))
const mockSelectLimit = mock(() => ({ all: mockSelectAll_fn }))
const mockSelectWhere = mock(() => ({ limit: mockSelectLimit }))
const mockSelectFrom = mock(() => ({ where: mockSelectWhere }))
const mockSelect = mock(() => ({ from: mockSelectFrom }))

const mockDb = {
  select: mockSelect,
  update: mockUpdate,
}

mock.module(resolve(SRC, "db/index.ts"), () => ({
  db: mockDb,
  sqlite: {},
}))

mock.module(resolve(SRC, "db/schema.ts"), () => ({
  workflows: {
    id: "id",
    deployStatus: "deploy_status",
    updatedAt: "updated_at",
  },
}))

// ── Dynamic import ──
let sweepStalePendingDeploys: () => Promise<number>

beforeAll(async () => {
  const mod = await import("../services/cre/deploy-sweep")
  sweepStalePendingDeploys = mod.sweepStalePendingDeploys
})

beforeEach(() => {
  mockSelectAll = []
  mockUpdateError = false
  updateCalls = []
})

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

describe("sweepStalePendingDeploys", () => {
  test("returns 0 when no stale deploys", async () => {
    mockSelectAll = []

    const count = await sweepStalePendingDeploys()
    expect(count).toBe(0)
  })

  test("marks stale pending deploys as failed", async () => {
    mockSelectAll = [
      { id: "workflow-1" },
      { id: "workflow-2" },
    ]

    const count = await sweepStalePendingDeploys()
    expect(count).toBe(2)
  })

  test("calls batched update with correct deployStatus and updatedAt", async () => {
    mockSelectAll = [{ id: "workflow-1" }, { id: "workflow-2" }]

    await sweepStalePendingDeploys()

    expect(updateCalls.length).toBe(1)
    expect(updateCalls[0]).toHaveProperty("deployStatus", "failed")
    expect(updateCalls[0]).toHaveProperty("updatedAt")
    // Verify updatedAt is in SQLite format (space-separated, no Z)
    expect(updateCalls[0].updatedAt).not.toContain("T")
    expect(updateCalls[0].updatedAt).not.toContain("Z")
  })

  test("DB error caught, returns 0", async () => {
    // Make select throw
    mockSelectAll_fn.mockImplementationOnce(() =>
      Promise.reject(new Error("DB connection lost")),
    )

    const count = await sweepStalePendingDeploys()
    expect(count).toBe(0)
  })

  test("update error does not crash sweep", async () => {
    mockSelectAll = [{ id: "workflow-1" }]
    mockUpdateError = true

    const count = await sweepStalePendingDeploys()
    // Error is caught at the outer try/catch level
    expect(count).toBe(0)
  })
})
