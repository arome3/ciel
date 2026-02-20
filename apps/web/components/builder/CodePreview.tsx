"use client"

import { useCallback, useState } from "react"
import dynamic from "next/dynamic"
import { Button } from "@/components/ui/button"
import { useBuilderStore } from "@/lib/store"

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

export function CodePreview() {
  const generatedWorkflow = useBuilderStore((s) => s.generatedWorkflow)
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

  if (!generatedWorkflow) {
    return (
      <div className="flex h-[400px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card">
        <span className="mb-2 font-mono text-lg text-muted-foreground/30">
          {"{ }"}
        </span>
        <p className="text-sm text-muted-foreground">
          Generated code will appear here
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-foreground">
            Generated Code
          </h3>
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
