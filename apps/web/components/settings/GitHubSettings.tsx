"use client"

import { useEffect, useState } from "react"
import { useAccount } from "wagmi"
import { useSearchParams } from "next/navigation"
import { Github, ExternalLink, Loader2, Check, Unplug } from "lucide-react"
import { Button } from "@/components/ui/button"
import { api, type GitHubStatus, type GitHubRepo } from "@/lib/api"
import { toast } from "sonner"

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"

export function GitHubSettings() {
  const { address } = useAccount()
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<GitHubStatus | null>(null)
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isDisconnecting, setIsDisconnecting] = useState(false)

  // Check for ?github=connected callback
  useEffect(() => {
    if (searchParams.get("github") === "connected") {
      toast.success("GitHub connected successfully")
    }
  }, [searchParams])

  // Fetch GitHub connection status
  useEffect(() => {
    if (!address) {
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    api
      .githubStatus(address)
      .then((s) => {
        setStatus(s)
        if (s.connected) {
          api
            .githubRepos(address)
            .then((r) => setRepos(r.repos))
            .catch(() => {})
        }
      })
      .catch(() => setStatus({ connected: false, username: null, installationId: null }))
      .finally(() => setIsLoading(false))
  }, [address])

  const handleConnect = () => {
    if (!address) return
    // Redirect to GitHub App installation — the backend redirects to GitHub
    window.location.href = `${API_BASE}/api/github/install`
  }

  const handleDisconnect = async () => {
    if (!address) return
    setIsDisconnecting(true)
    try {
      await api.githubDisconnect(address)
      setStatus({ connected: false, username: null, installationId: null })
      setRepos([])
      toast.success("GitHub disconnected")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to disconnect")
    } finally {
      setIsDisconnecting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Checking GitHub connection...</span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-muted p-2.5">
              <Github className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">GitHub</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Push workflows to GitHub repos and import existing CRE code
              </p>
            </div>
          </div>

          {status?.connected ? (
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-500">
                <Check className="h-3 w-3" />
                Connected
              </span>
            </div>
          ) : null}
        </div>

        {status?.connected ? (
          <div className="mt-5 space-y-4">
            <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
              <Github className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-foreground">@{status.username}</span>
            </div>

            {repos.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Accessible Repos ({repos.length})
                </p>
                <div className="max-h-48 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                  {repos.map((r) => (
                    <div
                      key={r.fullName}
                      className="flex items-center justify-between px-3 py-2 text-sm"
                    >
                      <span className="text-foreground">{r.fullName}</span>
                      <div className="flex items-center gap-2">
                        {r.private && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            Private
                          </span>
                        )}
                        <a
                          href={`https://github.com/${r.fullName}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={handleDisconnect}
              disabled={isDisconnecting}
              className="gap-1.5 text-destructive hover:text-destructive"
            >
              {isDisconnecting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Unplug className="h-3.5 w-3.5" />
              )}
              Disconnect GitHub
            </Button>
          </div>
        ) : (
          <div className="mt-5">
            <p className="mb-3 text-xs text-muted-foreground">
              Install the Ciel GitHub App to enable workflow export and import.
              You choose which repos to grant access to.
            </p>
            <Button onClick={handleConnect} size="sm" className="gap-1.5">
              <Github className="h-3.5 w-3.5" />
              Connect GitHub
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
