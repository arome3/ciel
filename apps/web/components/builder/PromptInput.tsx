"use client"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useWorkflowStore } from "@/lib/store"

const MIN_CHARS = 20
const MAX_CHARS = 2000

export function PromptInput() {
  const prompt = useWorkflowStore((s) => s.prompt)
  const setPrompt = useWorkflowStore((s) => s.setPrompt)
  const setTemplateHint = useWorkflowStore((s) => s.setTemplateHint)
  const isGenerating = useWorkflowStore((s) => s.isGenerating)
  const error = useWorkflowStore((s) => s.error)
  const generate = useWorkflowStore((s) => s.generate)

  const charsNeeded = MIN_CHARS - prompt.length
  const isReady = prompt.length >= MIN_CHARS && prompt.length <= MAX_CHARS

  return (
    <div className="rounded-xl border border-border bg-card p-5 transition-colors focus-within:border-ring/40">
      <label
        htmlFor="prompt-input"
        className="mb-3 block text-sm font-semibold text-foreground"
      >
        Describe your automation
      </label>
      <Textarea
        id="prompt-input"
        placeholder="e.g. Monitor ETH/USD price every 5 minutes and send an alert when it drops below $2000..."
        value={prompt}
        onChange={(e) => { setPrompt(e.target.value); setTemplateHint(null) }}
        className="min-h-[140px] resize-none border-0 bg-transparent p-0 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:ring-0"
        maxLength={MAX_CHARS}
        disabled={isGenerating}
      />
      <div className="mt-4 flex items-center justify-between gap-4 border-t border-border pt-3">
        <p
          className={`text-xs transition-colors ${
            isReady
              ? "text-green-400"
              : "text-muted-foreground"
          }`}
        >
          {charsNeeded > 0
            ? `${charsNeeded} more character${charsNeeded === 1 ? "" : "s"} needed`
            : "Ready to generate"}
        </p>
        <Button
          onClick={() => generate(prompt)}
          disabled={!isReady || isGenerating}
          className={`active:scale-[0.98] ${isGenerating ? "animate-glow-pulse disabled:opacity-90" : ""}`}
        >
          {isGenerating ? "Generating..." : "Generate"}
        </Button>
      </div>
      {error && (
        <p className="mt-3 text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
