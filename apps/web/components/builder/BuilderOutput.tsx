"use client"

import { CodePreview } from "./CodePreview"
import { ConfigEditor } from "./ConfigEditor"
import { SimulationPanel } from "./SimulationPanel"

export function BuilderOutput() {
  return (
    <div className="animate-fade-up rounded-2xl border border-border/50 bg-card/30 p-6 backdrop-blur-sm">
      <div className="grid gap-6 lg:grid-cols-2">
        <CodePreview />
        <div className="space-y-6">
          <ConfigEditor />
          <SimulationPanel />
        </div>
      </div>
    </div>
  )
}
