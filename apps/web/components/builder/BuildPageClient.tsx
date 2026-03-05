"use client"

import { ArrowLeft, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useWorkflowStore } from "@/lib/store"
import { PromptInput } from "./PromptInput"
import { TemplateGrid } from "./TemplateGrid"
import { BuildStepper } from "./BuildStepper"
import { BuilderOutput } from "./BuilderOutput"
import { BuilderActions } from "./BuilderActions"

export function BuildPageClient() {
  const isGenerating = useWorkflowStore((s) => s.isGenerating)
  const generatedWorkflow = useWorkflowStore((s) => s.generatedWorkflow)
  const prompt = useWorkflowStore((s) => s.prompt)
  const resetBuilder = useWorkflowStore((s) => s.resetBuilder)

  const inResultPhase = isGenerating || !!generatedWorkflow

  return (
    <div className="container mx-auto max-w-7xl px-4 py-8">
      <header className="mb-10 animate-fade-up">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Workflow Builder
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Describe an automation in plain language and get production-ready CRE
          code
        </p>
        {inResultPhase && <BuildStepper />}
      </header>

      {!inResultPhase ? (
        /* ── Compose phase: prompt + templates ── */
        <div className="space-y-8">
          <section
            id="step-describe"
            className="animate-fade-up"
            style={{ animationDelay: "50ms" }}
          >
            <PromptInput />
          </section>
          <TemplateGrid />
        </div>
      ) : (
        /* ── Result phase: summary + output + actions ── */
        <div className="space-y-8 animate-fade-up">
          {/* Compact prompt summary */}
          <div className="flex items-start gap-4 rounded-xl border border-border bg-card/50 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-muted-foreground">
                Prompt
              </p>
              <p className="mt-0.5 text-sm text-foreground line-clamp-2">
                {prompt}
              </p>
            </div>
            {isGenerating ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={resetBuilder}
                className="flex-shrink-0 gap-1.5 text-muted-foreground hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" />
                Cancel
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={resetBuilder}
                className="flex-shrink-0 gap-1.5 text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Edit
              </Button>
            )}
          </div>

          <section id="code-result">
            <BuilderOutput />
          </section>

          <section id="step-configure">
            <BuilderActions />
          </section>
        </div>
      )}
    </div>
  )
}
