"use client"

import { useState, useCallback } from "react"
import { ChevronDown, ChevronUp, Sparkles, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useWorkflowStore } from "@/lib/store"
import { useAccount } from "wagmi"

export function RefinementInput() {
  const generatedWorkflow = useWorkflowStore((s) => s.generatedWorkflow)
  const isRefining = useWorkflowStore((s) => s.isRefining)
  const isGenerating = useWorkflowStore((s) => s.isGenerating)
  const isSimulating = useWorkflowStore((s) => s.isSimulating)
  const refinementPrompt = useWorkflowStore((s) => s.refinementPrompt)
  const setRefinementPrompt = useWorkflowStore((s) => s.setRefinementPrompt)
  const refine = useWorkflowStore((s) => s.refine)
  const revisionHistory = useWorkflowStore((s) => s.revisionHistory)
  const error = useWorkflowStore((s) => s.error)
  const { address } = useAccount()

  const [expanded, setExpanded] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  const handleSubmit = useCallback(() => {
    if (!generatedWorkflow?.id || refinementPrompt.length < 5) return
    refine(generatedWorkflow.id, refinementPrompt, address)
  }, [generatedWorkflow?.id, refinementPrompt, refine, address])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit],
  )

  if (!generatedWorkflow) return null

  const disabled = isRefining || isGenerating || isSimulating
  const canSubmit = refinementPrompt.length >= 5 && !disabled

  if (!expanded) {
    return (
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setExpanded(true)}
          disabled={disabled}
          className="gap-1.5"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Refine
          {revisionHistory.length > 0 && (
            <span className="ml-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              {revisionHistory.length}
            </span>
          )}
        </Button>
        {isRefining && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Refining...
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium text-foreground">
            Refine Workflow
          </span>
          {revisionHistory.length > 0 && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              rev {revisionHistory.length + 1}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded(false)}
          className="h-6 w-6 p-0 text-muted-foreground"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </Button>
      </div>

      <textarea
        value={refinementPrompt}
        onChange={(e) => setRefinementPrompt(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Describe what to change..."
        disabled={disabled}
        rows={2}
        className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20 disabled:opacity-50"
      />

      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">
          {refinementPrompt.length < 5 && refinementPrompt.length > 0
            ? `${5 - refinementPrompt.length} more chars needed`
            : "Cmd+Enter to submit"}
        </span>
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="gap-1.5"
        >
          {isRefining ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Refining...
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5" />
              Refine
            </>
          )}
        </Button>
      </div>

      {error && isRefining === false && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      {revisionHistory.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setHistoryOpen(!historyOpen)}
            className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {historyOpen ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
            {revisionHistory.length} refinement{revisionHistory.length !== 1 ? "s" : ""}
          </button>
          {historyOpen && (
            <ul className="mt-2 space-y-1.5">
              {[...revisionHistory].reverse().map((rev, i) => (
                <li
                  key={i}
                  className="rounded-md border border-border/50 bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground"
                >
                  {rev.prompt}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
