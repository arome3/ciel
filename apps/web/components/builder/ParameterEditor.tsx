"use client"

import { Button } from "@/components/ui/button"
import { useWorkflowStore } from "@/lib/store"

interface ParameterEditorProps {
  onPublish: () => void
}

export function ParameterEditor({ onPublish }: ParameterEditorProps) {
  const workflow = useWorkflowStore((s) => s.generatedWorkflow)

  if (!workflow) return null

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Ready to deploy? Publish your workflow to the marketplace.
        </p>
        <Button onClick={onPublish}>Publish</Button>
      </div>
    </div>
  )
}
