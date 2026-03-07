"use client"

import { useState } from "react"
import { useWorkflowStore } from "@/lib/store"
import { ParameterEditor } from "./ParameterEditor"
import { PublishDialog } from "./PublishDialog"
import { ExportGitHubDialog } from "./ExportGitHubDialog"
import { ImportGitHubDialog } from "./ImportGitHubDialog"
import { Button } from "@/components/ui/button"
import { Github, Download } from "lucide-react"

export function BuilderActions() {
  const workflow = useWorkflowStore((s) => s.generatedWorkflow)
  const [publishOpen, setPublishOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  if (!workflow) return null

  return (
    <section className="animate-fade-up" style={{ animationDelay: "200ms" }}>
      <ParameterEditor onPublish={() => setPublishOpen(true)} />

      <div className="mt-4 flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setExportOpen(true)}
          className="gap-1.5"
        >
          <Github className="h-3.5 w-3.5" />
          Push to GitHub
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setImportOpen(true)}
          className="gap-1.5"
        >
          <Download className="h-3.5 w-3.5" />
          Import from GitHub
        </Button>
      </div>

      <PublishDialog open={publishOpen} onOpenChange={setPublishOpen} />
      <ExportGitHubDialog open={exportOpen} onOpenChange={setExportOpen} />
      <ImportGitHubDialog open={importOpen} onOpenChange={setImportOpen} />
    </section>
  )
}
