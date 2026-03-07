"use client"

import { useCallback, useEffect, useState } from "react"
import dynamic from "next/dynamic"
import { Button } from "@/components/ui/button"
import { useWorkflowStore } from "@/lib/store"

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[400px] items-center justify-center rounded-lg border border-border bg-muted">
      <div className="space-y-2 text-center">
        <div className="mx-auto h-4 w-32 rounded bg-muted-foreground/10 animate-skeleton" />
        <p className="text-xs text-muted-foreground">Loading editor</p>
      </div>
    </div>
  ),
})

const EDITOR_OPTIONS = {
  readOnly: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  fontSize: 13,
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  lineHeight: 1.6,
  lineNumbers: "on" as const,
  wordWrap: "on" as const,
  padding: { top: 12 },
  renderLineHighlight: "none" as const,
  overviewRulerBorder: false,
  hideCursorInOverviewRuler: true,
  scrollbar: {
    verticalScrollbarSize: 8,
    horizontalScrollbarSize: 8,
  },
}

function CodeSkeleton() {
  const widths = [80, 55, 90, 40, 70, 85, 45, 65]
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-1.5">
        <span className="h-2 w-2 rounded-full bg-primary/30 animate-skeleton" />
        <span className="font-mono text-xs text-muted-foreground/40">
          generating...
        </span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground/30">
          {elapsed}s
        </span>
      </div>
      <div className="space-y-2.5 bg-[hsl(240_20%_6%)] p-4">
        {widths.map((w, i) => (
          <div
            key={i}
            className="h-3.5 rounded animate-shimmer"
            style={{ width: `${w}%`, animationDelay: `${i * 100}ms` }}
          />
        ))}
      </div>
    </div>
  )
}

export function CodePreview() {
  const generatedWorkflow = useWorkflowStore((s) => s.generatedWorkflow)
  const isGenerating = useWorkflowStore((s) => s.isGenerating)
  const isRefining = useWorkflowStore((s) => s.isRefining)
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    if (!generatedWorkflow?.code) return
    try {
      await navigator.clipboard.writeText(generatedWorkflow.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard API may fail in insecure contexts
    }
  }, [generatedWorkflow?.code])

  if (isGenerating && !generatedWorkflow) {
    return <CodeSkeleton />
  }

  if (!generatedWorkflow) {
    return null
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-foreground">
            Generated Code
          </h3>
          {isRefining && (
            <span className="flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              refining...
            </span>
          )}
          {generatedWorkflow.template && (
            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              Template {generatedWorkflow.template.templateId}
            </span>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleCopy}
          className="active:scale-[0.98]"
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      {generatedWorkflow.fallback && (
        <div className="rounded-md border border-yellow-500/50 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-400">
          Fallback template used — the AI could not generate custom code for
          this prompt. You can edit the code below.
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border">
        {/* File tab indicator */}
        <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-1.5">
          <span className="h-2 w-2 rounded-full bg-primary/60" />
          <span className="font-mono text-xs text-muted-foreground">
            workflow.ts
          </span>
          <span className="ml-auto font-mono text-[10px] text-muted-foreground/50">
            read-only
          </span>
        </div>
        <MonacoEditor
          height="400px"
          language="typescript"
          theme="vs-dark"
          value={generatedWorkflow.code}
          options={EDITOR_OPTIONS}
        />
      </div>

      {generatedWorkflow.explanation && (
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs font-medium text-muted-foreground">
            Explanation
          </p>
          <p className="mt-1 text-sm leading-relaxed text-foreground">
            {generatedWorkflow.explanation}
          </p>
        </div>
      )}
    </div>
  )
}
