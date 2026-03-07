"use client"

import { useState, useEffect } from "react"
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
import { Switch } from "@/components/ui/switch"
import { useWorkflowStore } from "@/lib/store"
import { api, type GitHubRepo, type GitHubExportResult } from "@/lib/api"
import { useAccount } from "wagmi"
import { Github, Loader2, ExternalLink, Check, FolderGit2 } from "lucide-react"
import { toast } from "sonner"

interface ExportGitHubDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflowId?: string
  workflowName?: string
}

export function ExportGitHubDialog({ open, onOpenChange, workflowId: propWorkflowId, workflowName: propWorkflowName }: ExportGitHubDialogProps) {
  const storeWorkflow = useWorkflowStore((s) => s.generatedWorkflow)
  const { address } = useAccount()

  // Use prop ID (detail page) or store workflow (builder)
  const effectiveId = propWorkflowId ?? storeWorkflow?.id
  const effectiveName = propWorkflowName ?? storeWorkflow?.template?.templateName ?? "workflow"

  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [isConnected, setIsConnected] = useState<boolean | null>(null)
  const [isLoadingRepos, setIsLoadingRepos] = useState(false)
  const [isPushing, setIsPushing] = useState(false)
  const [result, setResult] = useState<GitHubExportResult | null>(null)

  // Form state
  const [selectedRepo, setSelectedRepo] = useState("")
  const [selectedOwner, setSelectedOwner] = useState("")
  const [createNewRepo, setCreateNewRepo] = useState(false)
  const [newRepoName, setNewRepoName] = useState("")
  const [isPrivate, setIsPrivate] = useState(true)
  const [branch, setBranch] = useState("main")
  const [createBranch, setCreateBranch] = useState(false)
  const [commitMessage, setCommitMessage] = useState("")
  const [pathPrefix, setPathPrefix] = useState("")

  // Check connection and fetch repos on open
  useEffect(() => {
    if (!open || !address) return
    setResult(null)
    setIsLoadingRepos(true)

    api
      .githubStatus(address)
      .then((s) => {
        setIsConnected(s.connected)
        if (s.connected) {
          return api.githubRepos(address).then((r) => {
            setRepos(r.repos)
            if (r.repos.length > 0 && !selectedRepo) {
              setSelectedRepo(r.repos[0].name)
              setSelectedOwner(r.repos[0].owner)
            }
          })
        }
      })
      .catch(() => setIsConnected(false))
      .finally(() => setIsLoadingRepos(false))
  }, [open, address])

  // Set default commit message from workflow name
  useEffect(() => {
    if (effectiveName && !commitMessage) {
      setCommitMessage(`Add Ciel CRE workflow: ${effectiveName}`)
    }
  }, [effectiveName])

  const handleExport = async () => {
    if (!address || !effectiveId) return
    setIsPushing(true)

    try {
      const repo = createNewRepo ? newRepoName : selectedRepo
      const owner = createNewRepo
        ? selectedOwner || repos[0]?.owner || ""
        : selectedOwner

      const exportResult = await api.exportToGitHub(effectiveId, address, {
        repo,
        owner,
        createRepo: createNewRepo,
        isPrivate,
        branch: createBranch ? branch : "main",
        createBranch,
        commitMessage,
        path: pathPrefix,
      })

      setResult(exportResult)
      toast.success("Pushed to GitHub!")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed")
    } finally {
      setIsPushing(false)
    }
  }

  const handleRepoSelect = (repoName: string) => {
    setSelectedRepo(repoName)
    const repo = repos.find((r) => r.name === repoName)
    if (repo) setSelectedOwner(repo.owner)
  }

  if (!effectiveId) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github className="h-5 w-5" />
            Push to GitHub
          </DialogTitle>
          <DialogDescription>
            Push your workflow files to a GitHub repository as an atomic commit.
          </DialogDescription>
        </DialogHeader>

        {isConnected === false ? (
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Connect your GitHub account to push workflows to repositories.
            </p>
            <Button
              onClick={() => {
                window.location.href = api.githubInstallUrl(address!)
              }}
              className="w-full gap-2"
            >
              <Github className="h-4 w-4" />
              Connect GitHub
            </Button>
          </div>
        ) : result ? (
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-2 text-emerald-500">
              <Check className="h-5 w-5" />
              <span className="font-medium">Successfully pushed!</span>
            </div>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                <span className="font-medium text-foreground">{result.filesCreated.length}</span> files committed
              </p>
              <p className="font-mono text-xs text-muted-foreground">
                {result.commitSha.slice(0, 7)}
              </p>
            </div>
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm" className="gap-1.5">
                <a href={result.commitUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" />
                  View Commit
                </a>
              </Button>
              <Button asChild variant="outline" size="sm" className="gap-1.5">
                <a href={result.repoUrl} target="_blank" rel="noopener noreferrer">
                  <FolderGit2 className="h-3.5 w-3.5" />
                  View Repo
                </a>
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {isLoadingRepos ? (
              <div className="flex items-center gap-2 py-4 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Loading repos...</span>
              </div>
            ) : (
              <>
                {/* Repo selection */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Repository</Label>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Switch
                        checked={createNewRepo}
                        onCheckedChange={setCreateNewRepo}
                        className="scale-75"
                      />
                      Create new
                    </label>
                  </div>

                  {createNewRepo ? (
                    <div className="space-y-2">
                      <Input
                        placeholder="my-cre-workflows"
                        value={newRepoName}
                        onChange={(e) => setNewRepoName(e.target.value)}
                      />
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Switch
                          checked={isPrivate}
                          onCheckedChange={setIsPrivate}
                          className="scale-75"
                        />
                        Private repository
                      </label>
                    </div>
                  ) : (
                    <select
                      value={selectedRepo}
                      onChange={(e) => handleRepoSelect(e.target.value)}
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      {repos.map((r) => (
                        <option key={r.fullName} value={r.name}>
                          {r.fullName}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Branch */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Branch</Label>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Switch
                        checked={createBranch}
                        onCheckedChange={setCreateBranch}
                        className="scale-75"
                      />
                      New branch
                    </label>
                  </div>
                  {createBranch && (
                    <Input
                      placeholder="feat/add-workflow"
                      value={branch}
                      onChange={(e) => setBranch(e.target.value)}
                    />
                  )}
                </div>

                {/* Path prefix */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Path prefix (optional)</Label>
                  <Input
                    placeholder="workflows/price-monitor"
                    value={pathPrefix}
                    onChange={(e) => setPathPrefix(e.target.value)}
                  />
                </div>

                {/* Commit message */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Commit message</Label>
                  <Input
                    value={commitMessage}
                    onChange={(e) => setCommitMessage(e.target.value)}
                  />
                </div>

                <Button
                  onClick={handleExport}
                  disabled={isPushing || (!createNewRepo && !selectedRepo) || (createNewRepo && !newRepoName)}
                  className="w-full gap-2"
                >
                  {isPushing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Pushing...
                    </>
                  ) : (
                    <>
                      <Github className="h-4 w-4" />
                      Push to GitHub
                    </>
                  )}
                </Button>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
