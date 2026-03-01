import { describe, test, expect } from "bun:test"
import { evaluateCondition, type StepCondition } from "../services/pipeline/executor"

// ─────────────────────────────────────────────
// Test Helpers
// ─────────────────────────────────────────────

function makeOutputs(
  entries: Array<[string, Record<string, unknown>]>,
): Map<string, Record<string, unknown>> {
  return new Map(entries)
}

// ─────────────────────────────────────────────
// Suite 1: evaluateCondition — Operator Tests
// ─────────────────────────────────────────────

describe("evaluateCondition — operators", () => {
  const outputs = makeOutputs([
    ["step-1", { result: { status: "success", price: 2500, active: true, name: "ETH" } }],
  ])

  test("eq: string equality", () => {
    const condition: StepCondition = { field: "result.status", operator: "eq", value: "success" }
    expect(evaluateCondition(condition, outputs)).toBe(true)
  })

  test("eq: string inequality returns false", () => {
    const condition: StepCondition = { field: "result.status", operator: "eq", value: "failed" }
    expect(evaluateCondition(condition, outputs)).toBe(false)
  })

  test("neq: not equal", () => {
    const condition: StepCondition = { field: "result.status", operator: "neq", value: "failed" }
    expect(evaluateCondition(condition, outputs)).toBe(true)
  })

  test("neq: equal returns false", () => {
    const condition: StepCondition = { field: "result.status", operator: "neq", value: "success" }
    expect(evaluateCondition(condition, outputs)).toBe(false)
  })

  test("gt: greater than", () => {
    const condition: StepCondition = { field: "result.price", operator: "gt", value: 2000 }
    expect(evaluateCondition(condition, outputs)).toBe(true)
  })

  test("gt: equal returns false", () => {
    const condition: StepCondition = { field: "result.price", operator: "gt", value: 2500 }
    expect(evaluateCondition(condition, outputs)).toBe(false)
  })

  test("lt: less than", () => {
    const condition: StepCondition = { field: "result.price", operator: "lt", value: 3000 }
    expect(evaluateCondition(condition, outputs)).toBe(true)
  })

  test("lt: equal returns false", () => {
    const condition: StepCondition = { field: "result.price", operator: "lt", value: 2500 }
    expect(evaluateCondition(condition, outputs)).toBe(false)
  })

  test("gte: greater than or equal", () => {
    const condition: StepCondition = { field: "result.price", operator: "gte", value: 2500 }
    expect(evaluateCondition(condition, outputs)).toBe(true)
  })

  test("gte: less than returns false", () => {
    const condition: StepCondition = { field: "result.price", operator: "gte", value: 3000 }
    expect(evaluateCondition(condition, outputs)).toBe(false)
  })

  test("lte: less than or equal", () => {
    const condition: StepCondition = { field: "result.price", operator: "lte", value: 2500 }
    expect(evaluateCondition(condition, outputs)).toBe(true)
  })

  test("lte: greater than returns false", () => {
    const condition: StepCondition = { field: "result.price", operator: "lte", value: 2000 }
    expect(evaluateCondition(condition, outputs)).toBe(false)
  })

  test("contains: substring match", () => {
    const condition: StepCondition = { field: "result.name", operator: "contains", value: "ET" }
    expect(evaluateCondition(condition, outputs)).toBe(true)
  })

  test("contains: no match returns false", () => {
    const condition: StepCondition = { field: "result.name", operator: "contains", value: "BTC" }
    expect(evaluateCondition(condition, outputs)).toBe(false)
  })
})

// ─────────────────────────────────────────────
// Suite 2: evaluateCondition — Edge Cases
// ─────────────────────────────────────────────

describe("evaluateCondition — edge cases", () => {
  test("missing field returns false", () => {
    const outputs = makeOutputs([
      ["step-1", { result: { status: "success" } }],
    ])
    const condition: StepCondition = { field: "result.nonexistent", operator: "eq", value: "x" }
    expect(evaluateCondition(condition, outputs)).toBe(false)
  })

  test("empty outputs returns false", () => {
    const outputs = makeOutputs([])
    const condition: StepCondition = { field: "result.status", operator: "eq", value: "success" }
    expect(evaluateCondition(condition, outputs)).toBe(false)
  })

  test("dot-path traversal through nested objects", () => {
    const outputs = makeOutputs([
      ["step-1", { data: { metrics: { count: 42 } } }],
    ])
    const condition: StepCondition = { field: "data.metrics.count", operator: "eq", value: 42 }
    expect(evaluateCondition(condition, outputs)).toBe(true)
  })

  test("resolves from most recent step output", () => {
    const outputs = makeOutputs([
      ["step-1", { result: { status: "old" } }],
      ["step-2", { result: { status: "new" } }],
    ])
    const condition: StepCondition = { field: "result.status", operator: "eq", value: "new" }
    expect(evaluateCondition(condition, outputs)).toBe(true)
  })

  test("falls back to earlier step if recent step lacks the field", () => {
    const outputs = makeOutputs([
      ["step-1", { result: { price: 3000 } }],
      ["step-2", { other: { data: "xyz" } }],
    ])
    const condition: StepCondition = { field: "result.price", operator: "gt", value: 2000 }
    expect(evaluateCondition(condition, outputs)).toBe(true)
  })

  test("boolean comparison via string coercion", () => {
    const outputs = makeOutputs([
      ["step-1", { result: { active: true } }],
    ])
    const condition: StepCondition = { field: "result.active", operator: "eq", value: true }
    expect(evaluateCondition(condition, outputs)).toBe(true)
  })

  test("top-level field without dot-path", () => {
    const outputs = makeOutputs([
      ["step-1", { status: "ready" }],
    ])
    const condition: StepCondition = { field: "status", operator: "eq", value: "ready" }
    expect(evaluateCondition(condition, outputs)).toBe(true)
  })

  test("null field value returns false (no silent coercion)", () => {
    const outputs = makeOutputs([
      ["step-1", { result: { price: null } }],
    ])
    const condition: StepCondition = { field: "result.price", operator: "gt", value: 0 }
    expect(evaluateCondition(condition, outputs)).toBe(false)
  })

  test("null field value with eq returns false", () => {
    const outputs = makeOutputs([
      ["step-1", { result: { status: null } }],
    ])
    const condition: StepCondition = { field: "result.status", operator: "eq", value: "success" }
    expect(evaluateCondition(condition, outputs)).toBe(false)
  })

  test("__proto__ dot-path is blocked", () => {
    const outputs = makeOutputs([
      ["step-1", { __proto__: { evil: true } }],
    ])
    const condition: StepCondition = { field: "__proto__.evil", operator: "eq", value: true }
    expect(evaluateCondition(condition, outputs)).toBe(false)
  })

  test("constructor dot-path is blocked", () => {
    const outputs = makeOutputs([
      ["step-1", { data: { constructor: { name: "Object" } } }],
    ])
    const condition: StepCondition = { field: "data.constructor.name", operator: "eq", value: "Object" }
    expect(evaluateCondition(condition, outputs)).toBe(false)
  })

  test("prototype dot-path is blocked", () => {
    const outputs = makeOutputs([
      ["step-1", { prototype: { method: "test" } }],
    ])
    const condition: StepCondition = { field: "prototype.method", operator: "eq", value: "test" }
    expect(evaluateCondition(condition, outputs)).toBe(false)
  })
})
