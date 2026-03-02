"use client"

import { useState } from "react"
import { Brain, LayoutGrid, Code, ShieldCheck, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

const stages = [
  {
    number: "01",
    icon: Brain,
    title: "Intent Parser",
    description:
      "Deterministic NLP extracts triggers, data sources, actions, and entities from your prompt. Stemming, fuzzy matching, and synonym expansion — no hallucination.",
  },
  {
    number: "02",
    icon: LayoutGrid,
    title: "Template Matcher",
    description:
      "Scores your intent against 22 CRE templates using IDF-weighted keywords fused with semantic embeddings. Picks the highest-confidence match.",
  },
  {
    number: "03",
    icon: Code,
    title: "Code Generator",
    description:
      "LLM generates a complete CRE workflow from the matched template, filling in your parameters, API calls, and chain interactions.",
  },
  {
    number: "04",
    icon: ShieldCheck,
    title: "Validator",
    description:
      "8-point validation ensures consensus safety — no non-determinism, proper imports, handler structure, and CRE SDK compliance. Auto-fixes common issues.",
  },
]

export function PipelineSection() {
  const [active, setActive] = useState(0)

  return (
    <section id="how-it-works" className="px-6 py-24 sm:py-32">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Four stages. Zero ambiguity.
        </h2>
        <p className="mt-4 max-w-2xl text-muted-foreground">
          Every prompt passes through a deterministic pipeline that transforms
          natural language into a validated, deployable CRE workflow.
        </p>

        <div className="mt-14 grid gap-12 lg:grid-cols-2 lg:gap-16">
          {/* Left: Accordion */}
          <div className="space-y-1">
            {stages.map((stage, i) => {
              const isActive = active === i
              return (
                <button
                  key={stage.number}
                  onClick={() => setActive(i)}
                  className={cn(
                    "w-full text-left transition-colors",
                    "border-l-2 pl-5 py-4",
                    isActive
                      ? "border-primary"
                      : "border-border/30 hover:border-border/60"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs font-bold text-primary">
                        {stage.number}
                      </span>
                      <span className={cn(
                        "text-sm font-medium transition-colors",
                        isActive ? "text-foreground" : "text-muted-foreground"
                      )}>
                        {stage.title}
                      </span>
                    </div>
                    <ChevronRight className={cn(
                      "size-4 text-muted-foreground/40 transition-transform duration-200",
                      isActive && "rotate-90"
                    )} />
                  </div>

                  {/* CSS accordion content */}
                  <div
                    className="accordion-content"
                    data-open={isActive}
                  >
                    <div>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                        {stage.description}
                      </p>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Right: Flow diagram */}
          <div className="flex flex-col items-center justify-center gap-3">
            {stages.map((stage, i) => {
              const isActive = active === i
              const Icon = stage.icon
              return (
                <div key={stage.number} className="flex flex-col items-center">
                  <button
                    onClick={() => setActive(i)}
                    className={cn(
                      "flex w-56 items-center gap-3 rounded-lg border px-4 py-3 transition-all",
                      isActive
                        ? "border-primary/50 bg-primary/5"
                        : "border-border/30 bg-card/30 hover:border-border/50"
                    )}
                  >
                    <Icon className={cn(
                      "size-4 shrink-0",
                      isActive ? "text-primary" : "text-muted-foreground/50"
                    )} />
                    <span className={cn(
                      "text-sm font-medium",
                      isActive ? "text-foreground" : "text-muted-foreground/60"
                    )}>
                      {stage.title}
                    </span>
                  </button>
                  {i < stages.length - 1 && (
                    <div className="h-3 w-px bg-border/30" />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
