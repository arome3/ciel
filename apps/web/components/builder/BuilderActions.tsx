"use client"

import { useState } from "react"
import { useWorkflowStore } from "@/lib/store"
import { ParameterEditor } from "./ParameterEditor"
import { PublishDialog } from "./PublishDialog"

export function BuilderActions() {
  const workflow = useWorkflowStore((s) => s.generatedWorkflow)
  const [publishOpen, setPublishOpen] = useState(false)

  if (!workflow) return null

  return (
    <section className="animate-fade-up" style={{ animationDelay: "200ms" }}>
      <ParameterEditor onPublish={() => setPublishOpen(true)} />
      <PublishDialog open={publishOpen} onOpenChange={setPublishOpen} />
    </section>
  )
}
