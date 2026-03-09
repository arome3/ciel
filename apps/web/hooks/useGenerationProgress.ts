"use client"

import { useEffect, useRef, useState } from "react"

// ─────────────────────────────────────────────
// Stage definitions
// ─────────────────────────────────────────────

export interface GenerationStage {
  label: string
  estimatedMs: number
  status: "pending" | "active" | "complete"
  elapsedMs: number
}

export type ProgressMode = "generate" | "refine"

interface StageDef {
  label: string
  estimatedMs: number
}

const GENERATE_STAGES: StageDef[] = [
  { label: "Parsing intent", estimatedMs: 2000 },
  { label: "Matching template", estimatedMs: 3000 },
  { label: "Generating code", estimatedMs: 25000 },
  { label: "Validating", estimatedMs: 5000 },
  { label: "Compiling", estimatedMs: 8000 },
]

const REFINE_STAGES: StageDef[] = [
  { label: "Analyzing changes", estimatedMs: 2000 },
  { label: "Re-generating code", estimatedMs: 20000 },
  { label: "Validating", estimatedMs: 5000 },
  { label: "Compiling", estimatedMs: 8000 },
]

const STAGE_MAP: Record<ProgressMode, StageDef[]> = {
  generate: GENERATE_STAGES,
  refine: REFINE_STAGES,
}

function totalEstimated(stages: StageDef[]): number {
  return stages.reduce((s, d) => s + d.estimatedMs, 0)
}

const TIPS = [
  "CRE workflows run on Chainlink DON nodes for tamperproof execution",
  "Workflows compile to WebAssembly for deterministic, sandboxed runs",
  "Each DON node executes independently — consensus ensures correctness",
  "CRE supports cron, HTTP, and EVM log triggers out of the box",
  "Generated code is validated against 8 safety checks before compilation",
  "runtime.now() returns a consensus-safe timestamp across all nodes",
  "Secrets are injected at runtime — never hardcoded in workflow code",
]

const REFINE_TIPS = [
  "Refinement preserves your workflow's existing structure where possible",
  "The AI re-validates all 8 safety checks after each code change",
  "Refinement reuses template context for faster code generation",
  "Each refinement is tracked in revision history for easy comparison",
]

const TIP_ROTATE_MS = 4000
const SNAP_DURATION_MS = 300

// ─────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────

export interface GenerationProgress {
  stages: GenerationStage[]
  currentStageIndex: number
  overallProgress: number
  elapsedMs: number
  estimatedRemainingMs: number
  currentTip: string
  isComplete: boolean
  /** Index of the "long" stage where tips are shown (code gen) */
  tipStageIndex: number
}

export function useGenerationProgress(
  isActive: boolean,
  mode: ProgressMode = "generate",
): GenerationProgress {
  const startRef = useRef<number | null>(null)
  const rafRef = useRef<number>(0)
  const wasActiveRef = useRef(false)
  const modeRef = useRef(mode)
  modeRef.current = mode

  const stageDefs = STAGE_MAP[mode]
  const total = totalEstimated(stageDefs)
  // The "long" stage where we show tips: stage index 2 for generate, index 1 for refine
  const tipStageIdx = mode === "generate" ? 2 : 1

  const [state, setState] = useState<GenerationProgress>(
    () => buildState(0, false, stageDefs, total, tipStageIdx, mode),
  )

  useEffect(() => {
    const defs = STAGE_MAP[modeRef.current]
    const tot = totalEstimated(defs)
    const tipIdx = modeRef.current === "generate" ? 2 : 1
    const m = modeRef.current

    // Transition: inactive → active (start)
    if (isActive && !wasActiveRef.current) {
      startRef.current = performance.now()

      const tick = () => {
        if (startRef.current === null) return
        const elapsed = performance.now() - startRef.current
        setState(buildState(elapsed, false, defs, tot, tipIdx, m))
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    // Transition: active → inactive (complete)
    if (!isActive && wasActiveRef.current) {
      cancelAnimationFrame(rafRef.current)
      const finalElapsed = startRef.current ? performance.now() - startRef.current : 0
      const snapStart = performance.now()

      const snapTick = () => {
        const t = Math.min((performance.now() - snapStart) / SNAP_DURATION_MS, 1)
        setState(buildState(finalElapsed, true, defs, tot, tipIdx, m, t))
        if (t < 1) {
          rafRef.current = requestAnimationFrame(snapTick)
        }
      }
      rafRef.current = requestAnimationFrame(snapTick)
    }

    wasActiveRef.current = isActive

    return () => {
      cancelAnimationFrame(rafRef.current)
    }
  }, [isActive])

  return state
}

// ─────────────────────────────────────────────
// Pure state builder
// ─────────────────────────────────────────────

function buildState(
  elapsedMs: number,
  isComplete: boolean,
  stageDefs: StageDef[],
  totalMs: number,
  tipStageIndex: number,
  mode: ProgressMode,
  snapProgress = 0,
): GenerationProgress {
  const stages: GenerationStage[] = []
  let cumulative = 0

  for (let i = 0; i < stageDefs.length; i++) {
    const def = stageDefs[i]
    const stageStart = cumulative
    const stageEnd = cumulative + def.estimatedMs
    cumulative = stageEnd

    if (isComplete) {
      stages.push({
        label: def.label,
        estimatedMs: def.estimatedMs,
        status: "complete",
        elapsedMs: def.estimatedMs,
      })
    } else if (elapsedMs >= stageEnd) {
      stages.push({
        label: def.label,
        estimatedMs: def.estimatedMs,
        status: "complete",
        elapsedMs: def.estimatedMs,
      })
    } else if (elapsedMs >= stageStart) {
      stages.push({
        label: def.label,
        estimatedMs: def.estimatedMs,
        status: "active",
        elapsedMs: elapsedMs - stageStart,
      })
    } else {
      stages.push({
        label: def.label,
        estimatedMs: def.estimatedMs,
        status: "pending",
        elapsedMs: 0,
      })
    }
  }

  const currentStageIndex = isComplete
    ? stageDefs.length - 1
    : stages.findIndex((s) => s.status === "active")

  let overallProgress: number
  if (isComplete) {
    overallProgress = snapProgress < 1 ? 0.95 + snapProgress * 0.05 : 1
  } else {
    overallProgress = 1 - Math.exp(-3 * elapsedMs / totalMs)
  }

  const estimatedRemainingMs = isComplete
    ? 0
    : Math.max(0, totalMs - elapsedMs)

  const tips = mode === "refine" ? REFINE_TIPS : TIPS
  const tipIndex = Math.floor(elapsedMs / TIP_ROTATE_MS) % tips.length

  return {
    stages,
    currentStageIndex: currentStageIndex === -1 ? 0 : currentStageIndex,
    overallProgress,
    elapsedMs,
    estimatedRemainingMs,
    currentTip: tips[tipIndex],
    isComplete,
    tipStageIndex,
  }
}
