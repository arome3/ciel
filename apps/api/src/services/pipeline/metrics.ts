// apps/api/src/services/pipeline/metrics.ts
// In-memory pipeline execution metrics.
// Zero external dependencies — suitable for beta observability.

interface PipelineMetrics {
  totalExecutions: number
  completedExecutions: number
  failedExecutions: number
  partialExecutions: number
  totalDurationMs: number
  stepExecutions: number
  stepFailures: number
  lastExecutionAt: number | null
}

const metrics: PipelineMetrics = {
  totalExecutions: 0,
  completedExecutions: 0,
  failedExecutions: 0,
  partialExecutions: 0,
  totalDurationMs: 0,
  stepExecutions: 0,
  stepFailures: 0,
  lastExecutionAt: null,
}

export function recordExecution(status: string, durationMs: number): void {
  metrics.totalExecutions++
  metrics.totalDurationMs += durationMs
  metrics.lastExecutionAt = Date.now()
  if (status === "completed") metrics.completedExecutions++
  else if (status === "failed") metrics.failedExecutions++
  else if (status === "partial") metrics.partialExecutions++
}

export function recordStepResult(success: boolean): void {
  metrics.stepExecutions++
  if (!success) metrics.stepFailures++
}

export function getMetrics(): PipelineMetrics & { avgDurationMs: number; failureRate: number } {
  const avg = metrics.totalExecutions > 0
    ? metrics.totalDurationMs / metrics.totalExecutions : 0
  const failRate = metrics.totalExecutions > 0
    ? metrics.failedExecutions / metrics.totalExecutions : 0
  return { ...metrics, avgDurationMs: avg, failureRate: failRate }
}

// For testing — follows codebase _ prefix convention for test-only exports
export function _resetMetrics(): void {
  Object.assign(metrics, {
    totalExecutions: 0,
    completedExecutions: 0,
    failedExecutions: 0,
    partialExecutions: 0,
    totalDurationMs: 0,
    stepExecutions: 0,
    stepFailures: 0,
    lastExecutionAt: null,
  })
}
