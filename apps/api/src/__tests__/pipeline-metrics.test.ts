import { describe, test, expect, beforeEach } from "bun:test"
import {
  recordExecution,
  recordStepResult,
  getMetrics,
  _resetMetrics,
} from "../services/pipeline/metrics"

describe("PipelineMetrics", () => {
  beforeEach(() => {
    _resetMetrics()
  })

  test("starts with zeroed counters", () => {
    const m = getMetrics()
    expect(m.totalExecutions).toBe(0)
    expect(m.completedExecutions).toBe(0)
    expect(m.failedExecutions).toBe(0)
    expect(m.partialExecutions).toBe(0)
    expect(m.totalDurationMs).toBe(0)
    expect(m.stepExecutions).toBe(0)
    expect(m.stepFailures).toBe(0)
    expect(m.lastExecutionAt).toBeNull()
    expect(m.avgDurationMs).toBe(0)
    expect(m.failureRate).toBe(0)
  })

  test("recordExecution increments completed count", () => {
    recordExecution("completed", 1000)
    const m = getMetrics()
    expect(m.totalExecutions).toBe(1)
    expect(m.completedExecutions).toBe(1)
    expect(m.failedExecutions).toBe(0)
    expect(m.totalDurationMs).toBe(1000)
    expect(m.lastExecutionAt).not.toBeNull()
  })

  test("recordExecution increments failed count", () => {
    recordExecution("failed", 500)
    const m = getMetrics()
    expect(m.totalExecutions).toBe(1)
    expect(m.failedExecutions).toBe(1)
    expect(m.failureRate).toBe(1)
  })

  test("recordExecution increments partial count", () => {
    recordExecution("partial", 750)
    const m = getMetrics()
    expect(m.partialExecutions).toBe(1)
  })

  test("calculates average duration correctly", () => {
    recordExecution("completed", 1000)
    recordExecution("completed", 3000)
    const m = getMetrics()
    expect(m.avgDurationMs).toBe(2000)
  })

  test("calculates failure rate correctly", () => {
    recordExecution("completed", 100)
    recordExecution("failed", 200)
    recordExecution("completed", 100)
    recordExecution("failed", 200)
    const m = getMetrics()
    expect(m.failureRate).toBe(0.5)
  })

  test("recordStepResult tracks step success and failure", () => {
    recordStepResult(true)
    recordStepResult(true)
    recordStepResult(false)
    const m = getMetrics()
    expect(m.stepExecutions).toBe(3)
    expect(m.stepFailures).toBe(1)
  })

  test("_resetMetrics clears all counters", () => {
    recordExecution("completed", 1000)
    recordExecution("failed", 500)
    recordStepResult(true)
    recordStepResult(false)

    _resetMetrics()

    const m = getMetrics()
    expect(m.totalExecutions).toBe(0)
    expect(m.stepExecutions).toBe(0)
    expect(m.lastExecutionAt).toBeNull()
  })

  test("handles unknown status without incrementing specific counters", () => {
    recordExecution("unknown_status", 100)
    const m = getMetrics()
    expect(m.totalExecutions).toBe(1)
    expect(m.completedExecutions).toBe(0)
    expect(m.failedExecutions).toBe(0)
    expect(m.partialExecutions).toBe(0)
  })
})
