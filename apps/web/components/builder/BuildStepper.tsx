"use client"

import { useWorkflowStore } from "@/lib/store"
import { Check } from "lucide-react"

const STEPS = [
  { id: 1, label: "Describe", anchor: "step-describe" },
  { id: 2, label: "Review", anchor: "code-result" },
  { id: 3, label: "Ship", anchor: "step-configure" },
] as const

function getActiveStep(hasWorkflow: boolean, hasSimulation: boolean): number {
  if (hasSimulation) return 3
  if (hasWorkflow) return 2
  return 1
}

export function BuildStepper() {
  const generatedWorkflow = useWorkflowStore((s) => s.generatedWorkflow)
  const simulation = useWorkflowStore((s) => s.simulation)

  const active = getActiveStep(!!generatedWorkflow, !!simulation)

  function scrollTo(anchor: string) {
    document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  return (
    <nav className="mt-5 flex items-center gap-1" aria-label="Build progress">
      {STEPS.map((step, i) => {
        const isCompleted = step.id < active
        const isCurrent = step.id === active

        return (
          <div key={step.id} className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => scrollTo(step.anchor)}
              className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium transition-all ${
                isCurrent
                  ? "bg-primary/10 text-primary ring-1 ring-primary/30"
                  : isCompleted
                    ? "text-primary/70 hover:text-primary"
                    : "text-muted-foreground/50"
              }`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full font-mono text-[10px] font-bold transition-colors ${
                  isCompleted
                    ? "bg-primary/20 text-primary"
                    : isCurrent
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground/50"
                }`}
              >
                {isCompleted ? <Check className="h-3 w-3" /> : step.id}
              </span>
              {step.label}
            </button>

            {/* Connector line */}
            {i < STEPS.length - 1 && (
              <div
                className={`h-px w-6 transition-colors ${
                  isCompleted ? "bg-primary/40" : "bg-border"
                }`}
              />
            )}
          </div>
        )
      })}
    </nav>
  )
}
