"use client"

import type { PipelineStep, Connection } from "@/lib/pipeline-builder-store"

interface ConnectionLineProps {
  connection: Connection
  sourceStep: PipelineStep
  targetStep: PipelineStep
  onClick: (connectionId: string) => void
}

const STEP_WIDTH = 200
const STEP_HEIGHT = 80

function getStrokeColor(compatibility: number): string {
  if (compatibility >= 0.8) return "#22c55e" // green-500
  if (compatibility >= 0.5) return "#eab308" // yellow-500
  return "#ef4444" // red-500
}

export function ConnectionLine({
  connection,
  sourceStep,
  targetStep,
  onClick,
}: ConnectionLineProps) {
  const x1 = sourceStep.x + STEP_WIDTH
  const y1 = sourceStep.y + STEP_HEIGHT / 2
  const x2 = targetStep.x
  const y2 = targetStep.y + STEP_HEIGHT / 2

  const dx = Math.abs(x2 - x1) * 0.5
  const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`

  const color = getStrokeColor(connection.compatibility)
  const markerId = `arrow-${connection.id}`

  return (
    <g>
      <defs>
        <marker
          id={markerId}
          markerWidth="8"
          markerHeight="6"
          refX="8"
          refY="3"
          orient="auto"
        >
          <polygon points="0 0, 8 3, 0 6" fill={color} />
        </marker>
      </defs>
      {/* Invisible wider hit area */}
      <path
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth="12"
        className="cursor-pointer"
        onClick={() => onClick(connection.id)}
      />
      {/* Visible line */}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="2"
        markerEnd={`url(#${markerId})`}
        className="pointer-events-none"
      />
      {/* Compatibility label */}
      <text
        x={(x1 + x2) / 2}
        y={(y1 + y2) / 2 - 8}
        textAnchor="middle"
        className="pointer-events-none fill-muted-foreground text-[10px]"
      >
        {Math.round(connection.compatibility * 100)}%
      </text>
    </g>
  )
}
