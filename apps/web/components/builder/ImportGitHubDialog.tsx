"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { useWorkflowStore } from "@/lib/store"
import { api, type GitHubImportResult } from "@/lib/api"
import { useAccount } from "wagmi"
import {
  Github,
  Loader2,
  Download,
  Check,
  AlertTriangle,
} from "lucide-react"
import { toast } from "sonner"

interface ImportGitHubDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ImportGitHubDialog({ open, onOpenChange }: ImportGitHubDialogProps) {
  const { address } = useAccount()
  const setGeneratedWorkflow = useWorkflowStore((s) => s.setGeneratedWorkflow)

  const [url, setUrl] = useState("")
  const [branch, setBranch] = useState("")
  const [isImporting, setIsImporting] = useState(false)
  const [result, setResult] = useState<GitHubImportResult | null>(null)

  const handleImport = async () => {
    if (!address || !url.trim()) return
    setIsImporting(true)
    setResult(null)

    try {
      const imported = await api.importFromGitHub(
        address,
        url.trim(),
        branch.trim() || undefined,
      )
      setResult(imported)

      if (imported.validation.valid) {
        toast.success("Workflow imported successfully")
      } else {
        toast.warning("Imported with validation warnings")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed")
    } finally {
      setIsImporting(false)
    }
  }

  const handleLoadInBuilder = () => {
    if (!result) return

    setGeneratedWorkflow({
      id: result.workflowId,
      code: result.code,
      config: result.config,
      fallback: false,
      language: "typescript",
      explanation: `Imported from GitHub: ${result.source.repo}`,
      consumerSol: null,
      intent: {
        triggerType: "unknown",
        confidence: 0,
        dataSources: [],
        actions: [],
        chains: ["base-sepolia"],
      },
      template: {
        templateId: 0,
        templateName: "imported",
        category: "core-defi",
        confidence: 0,
      },
      validation: result.validation,
    })

    onOpenChange(false)
    setUrl("")
    setBranch("")
    setResult(null)
    toast.success("Workflow loaded in builder")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Import from GitHub
          </DialogTitle>
          <DialogDescription>
            Paste a GitHub URL to import a CRE TypeScript workflow.
            Public repos work without connecting GitHub.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-2">
              {result.validation.valid ? (
                <div className="flex items-center gap-2 text-emerald-500">
                  <Check className="h-5 w-5" />
                  <span className="font-medium">Valid workflow</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-amber-500">
                  <AlertTriangle className="h-5 w-5" />
                  <span className="font-medium">Imported with warnings</span>
                </div>
              )}
            </div>

            <div className="space-y-1 text-sm text-muted-foreground">
              <p>
                <span className="font-medium text-foreground">Source:</span>{" "}
                {result.source.repo}
              </p>
              <p>
                <span className="font-medium text-foreground">Branch:</span>{" "}
                {result.source.branch}
              </p>
              <p>
                <span className="font-medium text-foreground">File:</span>{" "}
                {result.source.path}
              </p>
            </div>

            {result.validation.errors.length > 0 && (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                <p className="mb-1.5 text-xs font-medium text-amber-500">
                  Validation warnings:
                </p>
                <ul className="space-y-1">
                  {result.validation.errors.map((e, i) => (
                    <li key={i} className="text-xs text-muted-foreground">
                      {e}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex gap-2">
              <Button onClick={handleLoadInBuilder} className="flex-1 gap-1.5">
                Load in Builder
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setResult(null)
                  setUrl("")
                }}
              >
                Import Another
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">GitHub URL</Label>
              <Input
                placeholder="https://github.com/owner/repo/blob/main/wf/main.ts"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                Supports repo, directory, or file URLs
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Branch override (optional)</Label>
              <Input
                placeholder="main"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
              />
            </div>

            <Button
              onClick={handleImport}
              disabled={isImporting || !url.trim()}
              className="w-full gap-2"
            >
              {isImporting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Github className="h-4 w-4" />
                  Import Workflow
                </>
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
