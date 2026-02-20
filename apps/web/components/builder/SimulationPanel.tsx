"use client"

import { useCallback, useState } from "react"
import { Button } from "@/components/ui/button"
import { useWorkflowStore } from "@/lib/store"
import { api } from "@/lib/api"

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "success":
      return (
        <span className="font-mono text-xs font-bold text-green-400">
          [OK]
        </span>
      )
    case "error":
      return (
        <span className="font-mono text-xs font-bold text-red-400">
          [ERR]
        </span>
      )
    default:
      return (
        <span className="font-mono text-xs font-bold text-muted-foreground">
          [SKIP]
        </span>
      )
  }
}

function SimulationSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="space-y-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div
              className="h-4 w-8 rounded bg-muted-foreground/10 animate-skeleton"
              style={{ animationDelay: `${i * 150}ms` }}
            />
            <div
              className="h-3 rounded bg-muted-foreground/10 animate-skeleton"
              style={{ width: `${60 + i * 8}%`, animationDelay: `${i * 150 + 75}ms` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-4 border-t border-border pt-3">
        <div className="h-4 w-40 rounded bg-muted-foreground/10 animate-skeleton" />
      </div>
    </div>
  )
}

export function SimulationPanel() {
  const {
    generatedWorkflow,
    simulation,
    isSimulating,
    setIsSimulating,
    setSimulation,
    setError,
  } = useWorkflowStore()

  const [localError, setLocalError] = useState<string | null>(null)

  const handleSimulate = useCallback(async () => {
    if (!generatedWorkflow || isSimulating) return

    setLocalError(null)
    setError(null)
    setIsSimulating(true)

    try {
      const result = await api.simulate(
        generatedWorkflow.id,
        generatedWorkflow.config,
      )
      setSimulation(result)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Simulation failed"
      setLocalError(message)
      setError(message)
    } finally {
      setIsSimulating(false)
    }
  }, [
    generatedWorkflow,
    isSimulating,
    setIsSimulating,
    setSimulation,
    setError,
  ])

  if (!generatedWorkflow) {
    return (
      <div className="flex h-[400px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card">
        <span className="mb-2 font-mono text-lg text-muted-foreground/30">
          {"▶"}
        </span>
        <p className="text-sm text-muted-foreground">
          Generate a workflow first to run simulations
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Simulation</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSimulate}
          disabled={isSimulating}
          className="active:scale-[0.98]"
        >
          {isSimulating ? "Running..." : "Run Simulation"}
        </Button>
      </div>

      {localError && (
        <p className="text-sm text-red-400" role="alert">
          {localError}
        </p>
      )}

      {isSimulating && !simulation && <SimulationSkeleton />}

      {!simulation && !isSimulating && (
        <div className="flex h-[300px] items-center justify-center rounded-xl border border-dashed border-border bg-card">
          <p className="text-sm text-muted-foreground">
            Click &quot;Run Simulation&quot; to test your workflow
          </p>
        </div>
      )}

      {simulation && (
        <div className="rounded-xl border border-border bg-card p-4">
          {/* Vertical stepper */}
          <div className="space-y-0" aria-live="polite">
            {simulation.steps.map((step, i) => (
              <div key={step.name + i}>
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex-shrink-0">
                    <StatusBadge status={step.status} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">
                        {step.name}
                      </p>
                      <span className="flex-shrink-0 font-mono text-[11px] text-muted-foreground">
                        {step.durationMs}ms
                      </span>
                    </div>
                    {step.error && (
                      <p className="mt-1 text-xs text-red-400">
                        {step.error}
                      </p>
                    )}
                  </div>
                </div>
                {/* Connector line between steps */}
                {i < simulation.steps.length - 1 && (
                  <div className="ml-3 mt-1 h-6 w-px bg-border" />
                )}
              </div>
            ))}
          </div>

          {/* Summary bar */}
          <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
            <p
              className={`text-sm font-semibold ${
                simulation.success ? "text-green-400" : "text-red-400"
              }`}
            >
              {simulation.success
                ? "Simulation Passed"
                : "Simulation Failed"}
            </p>
            <span className="font-mono text-xs text-muted-foreground">
              {simulation.totalDurationMs}ms total
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
