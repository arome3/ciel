"use client"

import { useWorkflowStore } from "@/lib/store"
import {
  useGenerationProgress,
  type ProgressMode,
} from "@/hooks/useGenerationProgress"

// ─────────────────────────────────────────────
// Icons (inline SVG to avoid dep)
// ─────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg
      className="h-4 w-4 text-green-400 animate-check-pop"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 8.5L6.5 11.5L12.5 4.5" />
    </svg>
  )
}

function PendingDot() {
  return (
    <span className="flex h-4 w-4 items-center justify-center">
      <span className="h-2 w-2 rounded-full bg-muted-foreground/30" />
    </span>
  )
}

function ActiveDot() {
  return (
    <span className="flex h-4 w-4 items-center justify-center">
      <span className="h-2.5 w-2.5 rounded-full bg-primary animate-stage-glow" />
    </span>
  )
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function formatTime(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const min = Math.floor(seconds / 60)
  const sec = seconds % 60
  return `${min}m ${sec}s`
}

function formatStageDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

const LABELS: Record<ProgressMode, string> = {
  generate: "generating workflow...",
  refine: "refining workflow...",
}

// ─────────────────────────────────────────────
// Shared stage list renderer
// ─────────────────────────────────────────────

interface StageListProps {
  progress: ReturnType<typeof useGenerationProgress>
  mode: ProgressMode
  compact?: boolean
}

function StageList({ progress, mode, compact }: StageListProps) {
  return (
    <>
      <div className="space-y-0">
        {progress.stages.map((stage, i) => (
          <div key={stage.label}>
            <div
              className={`flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors duration-200 ${
                stage.status === "active"
                  ? `border-l-2 ${mode === "refine" ? "border-violet-400 bg-violet-500/5" : "border-primary bg-primary/5"}`
                  : stage.status === "complete"
                    ? "border-l-2 border-green-400/40"
                    : "border-l-2 border-transparent"
              }`}
            >
              {stage.status === "complete" && <CheckIcon />}
              {stage.status === "active" && <ActiveDot />}
              {stage.status === "pending" && <PendingDot />}

              <span
                className={`flex-1 text-sm ${
                  stage.status === "active"
                    ? "font-medium text-foreground"
                    : stage.status === "complete"
                      ? "text-muted-foreground"
                      : "text-muted-foreground/40"
                }`}
              >
                {stage.label}
              </span>

              {stage.status !== "pending" && (
                <span className="font-mono text-[11px] text-muted-foreground/50">
                  {formatStageDuration(stage.elapsedMs)}
                </span>
              )}
            </div>

            {i < progress.stages.length - 1 && (
              <div
                className={`ml-[19px] h-3 w-px ${
                  stage.status === "complete"
                    ? "bg-green-400/30"
                    : "bg-border/50"
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Contextual tip — only during the long code-gen stage */}
      {progress.currentStageIndex === progress.tipStageIndex && !progress.isComplete && (
        <div className={`mt-3 border-l-2 pl-3 ${mode === "refine" ? "border-violet-400/20" : "border-primary/20"}`}>
          <p className="animate-message-fade text-xs leading-relaxed text-muted-foreground/50 italic">
            {progress.currentTip}
          </p>
        </div>
      )}

      {/* Progress bar */}
      <div className={`${compact ? "mt-3" : "mt-4"} flex items-center gap-3`}>
        <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ease-out animate-progress-glow ${
              mode === "refine" ? "bg-violet-400" : "bg-primary"
            }`}
            style={{ width: `${Math.round(progress.overallProgress * 100)}%` }}
          />
        </div>
        <span className="font-mono text-[10px] text-muted-foreground/40 tabular-nums">
          {Math.round(progress.overallProgress * 100)}%
        </span>
      </div>

      {!progress.isComplete && progress.estimatedRemainingMs > 0 && (
        <p className="mt-2 text-right font-mono text-[10px] text-muted-foreground/30">
          ~{formatTime(progress.estimatedRemainingMs)} remaining
        </p>
      )}
    </>
  )
}

// ─────────────────────────────────────────────
// Full component — replaces editor during generation
// ─────────────────────────────────────────────

export function GenerationProgress() {
  const isGenerating = useWorkflowStore((s) => s.isGenerating)
  const progress = useGenerationProgress(isGenerating, "generate")

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-1.5">
        <span className="h-2 w-2 rounded-full bg-primary/60 animate-stage-glow" />
        <span className="font-mono text-xs text-muted-foreground/70">
          {LABELS.generate}
        </span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground/40">
          {formatTime(progress.elapsedMs)}
        </span>
      </div>
      <div className="bg-[hsl(240_20%_6%)] px-4 py-4">
        <StageList progress={progress} mode="generate" />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// Refinement overlay — floats over the editor
// ─────────────────────────────────────────────

export function RefinementProgress() {
  const isRefining = useWorkflowStore((s) => s.isRefining)
  const progress = useGenerationProgress(isRefining, "refine")

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 backdrop-blur-sm rounded-lg animate-fade-up">
      <div className="w-full max-w-sm rounded-xl border border-violet-500/30 bg-card/95 shadow-lg shadow-violet-500/5 p-4">
        {/* Header */}
        <div className="mb-3 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-violet-400 animate-stage-glow" />
          <span className="font-mono text-xs text-violet-300/80">
            {LABELS.refine}
          </span>
          <span className="ml-auto font-mono text-[10px] text-muted-foreground/40">
            {formatTime(progress.elapsedMs)}
          </span>
        </div>

        <StageList progress={progress} mode="refine" compact />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// Compact variant for SimulationPanel
// ─────────────────────────────────────────────

export function GenerationProgressMini({ mode = "generate" }: { mode?: ProgressMode }) {
  const isGenerating = useWorkflowStore((s) => s.isGenerating)
  const isRefining = useWorkflowStore((s) => s.isRefining)
  const isActive = mode === "refine" ? isRefining : isGenerating
  const progress = useGenerationProgress(isActive, mode)

  const currentStage = progress.stages[progress.currentStageIndex]
  const pct = Math.round(progress.overallProgress * 100)
  const accent = mode === "refine" ? "bg-violet-400" : "bg-primary"

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Pulsing indicator dot */}
      <span className={`h-3 w-3 rounded-full ${accent}/60 animate-stage-glow`} />

      {/* Stage label */}
      <p className="font-mono text-xs text-muted-foreground/60">
        {currentStage?.label ?? (mode === "refine" ? "refining..." : "generating...")}
      </p>

      {/* Progress bar */}
      <div className="relative h-1.5 w-40 overflow-hidden rounded-full bg-muted">
        <div className="absolute inset-0 animate-shimmer rounded-full opacity-30" />
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${accent}/70 animate-progress-glow transition-[width] duration-300 ease-out`}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      </div>

      {/* Percentage + elapsed */}
      <p className="font-mono text-[10px] text-muted-foreground/30 tabular-nums">
        {pct}% · {formatTime(progress.elapsedMs)}
      </p>
    </div>
  )
}
