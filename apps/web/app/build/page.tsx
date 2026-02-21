import { PromptInput } from "@/components/builder/PromptInput"
import { TemplateGrid } from "@/components/builder/TemplateGrid"
import { CodePreview } from "@/components/builder/CodePreview"
import { SimulationPanel } from "@/components/builder/SimulationPanel"
import { BuilderActions } from "@/components/builder/BuilderActions"

export const metadata = {
  title: "Build — Ciel",
  description: "Build AI-powered CRE workflows with natural language",
}

export default function BuildPage() {
  return (
    <div className="container mx-auto max-w-7xl px-4 py-8">
      {/* Page header */}
      <header className="mb-10 animate-fade-up">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Workflow Builder
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Describe an automation in plain language and get production-ready CRE
          code
        </p>
      </header>

      <div className="space-y-10">
        <section className="animate-fade-up" style={{ animationDelay: "50ms" }}>
          <PromptInput />
        </section>

        <section className="animate-fade-up" style={{ animationDelay: "100ms" }}>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Or start from a template
          </h2>
          <TemplateGrid />
        </section>

        <section
          className="grid gap-6 animate-fade-up lg:grid-cols-2"
          style={{ animationDelay: "150ms" }}
        >
          <CodePreview />
          <SimulationPanel />
        </section>

        <BuilderActions />
      </div>
    </div>
  )
}
