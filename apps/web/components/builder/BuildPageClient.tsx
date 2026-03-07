"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, ArrowRight, X, Github, Download } from "lucide-react"
import { useAccount } from "wagmi"
import { Button } from "@/components/ui/button"
import { useWorkflowStore } from "@/lib/store"
import { api, type WorkflowListItem } from "@/lib/api"
import { getCategoryVariant } from "@/lib/design-tokens"
import { PromptInput } from "./PromptInput"
import { TemplateGrid } from "./TemplateGrid"
import { BuildStepper } from "./BuildStepper"
import { BuilderOutput } from "./BuilderOutput"
import { BuilderActions } from "./BuilderActions"
import { RefinementInput } from "./RefinementInput"
import { ImportGitHubDialog } from "./ImportGitHubDialog"

function relativeTime(dateStr?: string) {
  if (!dateStr) return ""
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function BuildPageClient() {
  const searchParams = useSearchParams()
  const { address } = useAccount()
  const isGenerating = useWorkflowStore((s) => s.isGenerating)
  const generatedWorkflow = useWorkflowStore((s) => s.generatedWorkflow)
  const prompt = useWorkflowStore((s) => s.prompt)
  const setPrompt = useWorkflowStore((s) => s.setPrompt)
  const setTemplateHint = useWorkflowStore((s) => s.setTemplateHint)
  const resetBuilder = useWorkflowStore((s) => s.resetBuilder)

  const [importOpen, setImportOpen] = useState(false)

  const [recentWorkflows, setRecentWorkflows] = useState<WorkflowListItem[]>([])

  // Handle URL query params for template pre-fill
  useEffect(() => {
    const promptParam = searchParams.get("prompt")
    const hintParam = searchParams.get("hint")
    if (promptParam) {
      setPrompt(promptParam)
      if (hintParam) setTemplateHint(Number(hintParam))
    }
  }, [searchParams, setPrompt, setTemplateHint])

  // Fetch recent workflows
  useEffect(() => {
    if (!address) return
    api
      .listWorkflows({ owner: address, published: "all", sort: "newest", limit: 5 })
      .then((res) => setRecentWorkflows(res.workflows))
      .catch(() => {})
  }, [address])

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
        /* Compose phase: prompt + templates + recent */
        <div className="space-y-8">
          <section
            id="step-describe"
            className="animate-fade-up"
            style={{ animationDelay: "50ms" }}
          >
            <PromptInput />
            <div className="mt-3 flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">or</span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <div className="mt-3 flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setImportOpen(true)}
                className="gap-1.5"
              >
                <Github className="h-3.5 w-3.5" />
                Import from GitHub
              </Button>
            </div>
            <ImportGitHubDialog open={importOpen} onOpenChange={setImportOpen} />
          </section>
          <TemplateGrid />

          {/* Recent workflows */}
          {address && recentWorkflows.length > 0 && (
            <section className="animate-fade-up" style={{ animationDelay: "200ms" }}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Your Recent Workflows
                </h2>
                <Link
                  href="/workflows"
                  className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
                >
                  View all
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {recentWorkflows.map((w) => (
                  <Link
                    key={w.id}
                    href={`/workflow/${w.id}`}
                    className="group rounded-lg border border-border bg-card p-3 transition-all hover:border-primary/50"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-medium ${getCategoryVariant(w.category)}`}>
                        {w.category}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {w.published ? "Published" : "Draft"}
                      </span>
                    </div>
                    <p className="mt-1.5 truncate text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                      {w.name}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {relativeTime(w.updatedAt ?? w.createdAt)}
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      ) : (
        /* Result phase: summary + output + actions */
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

          <RefinementInput />

          <section id="step-configure">
            <BuilderActions />
          </section>
        </div>
      )}
    </div>
  )
}
