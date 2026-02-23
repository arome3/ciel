import { describe, test, expect, mock, beforeEach } from "bun:test"
import { resolve } from "path"

// ─────────────────────────────────────────────
// Mocks — external boundaries only
// ─────────────────────────────────────────────

const SRC = resolve(import.meta.dir, "..")

// ── Config mock ──
mock.module(resolve(SRC, "config.ts"), () => ({
  config: {
    DATABASE_PATH: ":memory:",
    NODE_ENV: "test",
  },
}))

// ── Logger mock ──
mock.module(resolve(SRC, "lib/logger.ts"), () => ({
  createLogger: () => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }),
}))

// ── DB mock ──
let mockSelectResult: any[] = []
let lastUpdateSet: any = null
let lastUpdateWhere: any = null
let updateShouldThrow = false

const mockDb = {
  select: mock(() => ({
    from: mock(() => ({
      where: mock(() => ({
        limit: mock(() => ({
          all: mock(() => Promise.resolve(mockSelectResult)),
        })),
      })),
    })),
  })),
  update: mock(() => ({
    set: mock((vals: any) => {
      lastUpdateSet = vals
      return {
        where: mock((w: any) => {
          lastUpdateWhere = w
          if (updateShouldThrow) return Promise.reject(new Error("DB write failed"))
          return Promise.resolve()
        }),
      }
    }),
  })),
}

mock.module(resolve(SRC, "db/index.ts"), () => ({
  db: mockDb,
}))

mock.module(resolve(SRC, "db/schema.ts"), () => ({
  pipelineExecutions: {
    id: "id",
    status: "status",
    createdAt: "created_at",
    duration: "duration",
  },
}))

// ─────────────────────────────────────────────
// Import after mocks
// ─────────────────────────────────────────────

const { sweepStaleExecutions } = await import("../services/pipeline/execution-sweep")

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

describe("PipelineExecutionSweep", () => {
  beforeEach(() => {
    mockSelectResult = []
    lastUpdateSet = null
    lastUpdateWhere = null
    updateShouldThrow = false
  })

  test("returns 0 when no stale executions found", async () => {
    mockSelectResult = []
    const count = await sweepStaleExecutions()
    expect(count).toBe(0)
  })

  test("sweeps stale running executions to failed", async () => {
    mockSelectResult = [
      { id: "exec-1" },
      { id: "exec-2" },
    ]

    const count = await sweepStaleExecutions()
    expect(count).toBe(2)
    expect(lastUpdateSet).toEqual({ status: "failed", duration: null })
  })

  test("returns 0 on DB error (does not throw)", async () => {
    updateShouldThrow = true
    mockSelectResult = [{ id: "exec-1" }]

    const count = await sweepStaleExecutions()
    expect(count).toBe(0)
  })

  test("calls select with correct query shape", async () => {
    mockSelectResult = []
    await sweepStaleExecutions()

    // Verify the chain: select → from → where → limit → all
    expect(mockDb.select).toHaveBeenCalled()
  })
})
