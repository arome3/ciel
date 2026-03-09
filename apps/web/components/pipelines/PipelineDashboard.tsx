"use client"

import { useEffect, useState, useMemo, useCallback } from "react"
import Link from "next/link"
import { useAccount, useSignMessage } from "wagmi"
import { useConnectModal } from "@rainbow-me/rainbowkit"
import { GitBranch, Plus, Wallet, Search, Clock, CheckCircle, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { api, type PipelineListItem, type PipelineExecution } from "@/lib/api"
import { MyPipelineCard } from "./MyPipelineCard"

type StatusFilter = "all" | "active" | "inactive"

function relativeTime(dateStr?: string) {
  if (!dateStr) return ""
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

function formatDuration(ms: number | null): string {
  if (!ms) return "-"
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function PipelineDashboard() {
  const { address } = useAccount()
  const { openConnectModal } = useConnectModal()
  const { signMessageAsync } = useSignMessage()
  const [pipelines, setPipelines] = useState<PipelineListItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [filter, setFilter] = useState<StatusFilter>("all")
  const [search, setSearch] = useState("")
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [execHistory, setExecHistory] = useState<Record<string, PipelineExecution[]>>({})
  const [lastExecutions, setLastExecutions] = useState<Record<string, PipelineExecution>>({})
  const [executingId, setExecutingId] = useState<string | null>(null)

  // Fetch pipelines for connected wallet
  useEffect(() => {
    if (!address) {
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    api
      .listPipelines({ owner: address, limit: 100 })
      .then((res) => {
        setPipelines(res.pipelines)
        // Fetch last execution for each pipeline
        for (const p of res.pipelines) {
          api
            .getPipelineHistory(p.id, { limit: 1 })
            .then((h) => {
              if (h.executions.length > 0) {
                setLastExecutions((prev) => ({ ...prev, [p.id]: h.executions[0] }))
              }
            })
            .catch(() => {})
        }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false))
  }, [address])

  const filtered = useMemo(() => {
    let result = pipelines
    if (filter === "active") result = result.filter((p) => p.isActive)
    else if (filter === "inactive") result = result.filter((p) => !p.isActive)

    if (search) {
      const q = search.toLowerCase()
      result = result.filter((p) => p.name.toLowerCase().includes(q))
    }
    return result
  }, [pipelines, filter, search])

  const stats = useMemo(() => ({
    total: pipelines.length,
    active: pipelines.filter((p) => p.isActive).length,
    inactive: pipelines.filter((p) => !p.isActive).length,
    totalRuns: pipelines.reduce((sum, p) => sum + p.executionCount, 0),
  }), [pipelines])

  const handleExpand = useCallback(async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null)
      return
    }
    setExpandedId(id)
    if (!execHistory[id]) {
      try {
        const res = await api.getPipelineHistory(id, { limit: 10 })
        setExecHistory((prev) => ({ ...prev, [id]: res.executions }))
      } catch {
        setExecHistory((prev) => ({ ...prev, [id]: [] }))
      }
    }
  }, [expandedId, execHistory])

  const handleExecute = useCallback(async (id: string) => {
    if (!address) return
    setExecutingId(id)
    try {
      const timestamp = String(Date.now())
      const message = `${id}:${timestamp}`
      const signature = await signMessageAsync({ message })

      await api.executePipeline(id, undefined, {
        address,
        signature,
        timestamp,
      })

      // Refresh the pipeline's last execution
      const h = await api.getPipelineHistory(id, { limit: 1 })
      if (h.executions.length > 0) {
        setLastExecutions((prev) => ({ ...prev, [id]: h.executions[0] }))
      }

      // Refresh execution count
      const res = await api.listPipelines({ owner: address, limit: 100 })
      setPipelines(res.pipelines)

      // If history is expanded, refresh it
      if (expandedId === id) {
        const hist = await api.getPipelineHistory(id, { limit: 10 })
        setExecHistory((prev) => ({ ...prev, [id]: hist.executions }))
      }
    } catch {
      // toast or silently fail
    } finally {
      setExecutingId(null)
    }
  }, [address, signMessageAsync, expandedId])

  const handleDelete = useCallback(async (id: string) => {
    if (!address) return
    try {
      const timestamp = String(Date.now())
      const message = `${id}:${timestamp}`
      const signature = await signMessageAsync({ message })

      await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/api/pipelines/${id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "X-Owner-Address": address,
          "X-Owner-Signature": signature,
          "X-Owner-Timestamp": timestamp,
        },
      })

      setPipelines((prev) =>
        prev.map((p) => (p.id === id ? { ...p, isActive: false } : p)),
      )
    } catch {
      // silently fail
    }
  }, [address, signMessageAsync])

  const handleRestore = useCallback(async (id: string) => {
    if (!address) return
    try {
      const timestamp = String(Date.now())
      const message = `${id}:${timestamp}`
      const signature = await signMessageAsync({ message })

      await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/api/pipelines/${id}/restore`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Owner-Address": address,
          "X-Owner-Signature": signature,
          "X-Owner-Timestamp": timestamp,
        },
      })

      setPipelines((prev) =>
        prev.map((p) => (p.id === id ? { ...p, isActive: true } : p)),
      )
    } catch {
      // silently fail
    }
  }, [address, signMessageAsync])

  // Not connected
  if (!address) {
    return (
      <div className="container mx-auto max-w-7xl px-4 py-8">
        <header className="mb-10 animate-fade-up">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">My Pipelines</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            View and manage your composable workflow pipelines
          </p>
        </header>
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 px-8 py-16 text-center animate-fade-up">
          <div className="mb-4 rounded-full bg-muted p-4">
            <Wallet className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">Connect your wallet</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Connect your wallet to view and manage your pipelines. All pipelines are tied to your wallet address.
          </p>
          <Button className="mt-6" onClick={() => openConnectModal?.()}>
            Connect Wallet
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-7xl px-4 py-8">
      <header className="mb-8 flex items-center justify-between animate-fade-up">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">My Pipelines</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            View and manage your composable workflow pipelines
          </p>
        </div>
        <Button className="gap-1.5" asChild>
          <Link href="/pipelines/new">
            <Plus className="h-4 w-4" />
            New Pipeline
          </Link>
        </Button>
      </header>

      {/* Stats bar */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 animate-fade-up" style={{ animationDelay: "50ms" }}>
        {[
          { label: "Total", value: stats.total },
          { label: "Active", value: stats.active },
          { label: "Inactive", value: stats.inactive },
          { label: "Total Runs", value: stats.totalRuns },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-border bg-card px-4 py-3">
            <p className="text-xs font-medium text-muted-foreground">{s.label}</p>
            <div className="mt-1 text-2xl font-bold text-foreground">
              {isLoading ? <Skeleton className="h-8 w-12" /> : s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between animate-fade-up" style={{ animationDelay: "100ms" }}>
        <Tabs value={filter} onValueChange={(v) => setFilter(v as StatusFilter)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="inactive">Inactive</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search pipelines..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-52 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 px-8 py-16 text-center animate-fade-up">
          <div className="mb-4 rounded-full bg-muted p-4">
            <GitBranch className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">
            {pipelines.length === 0 ? "Create your first pipeline" : "No matching pipelines"}
          </h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {pipelines.length === 0
              ? "Compose multiple workflows into a single pipeline. Chain outputs to inputs for powerful multi-step automations."
              : "Try adjusting your filters or search query."}
          </p>
          {pipelines.length === 0 && (
            <Button className="mt-6 gap-1.5" asChild>
              <Link href="/pipelines/new">
                <Plus className="h-4 w-4" />
                New Pipeline
              </Link>
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 animate-fade-up" style={{ animationDelay: "150ms" }}>
          {filtered.map((p) => (
            <div key={p.id} className="flex flex-col gap-2">
              <MyPipelineCard
                pipeline={p}
                lastExecution={lastExecutions[p.id] ?? null}
                onExecute={handleExecute}
                onDelete={handleDelete}
                onRestore={handleRestore}
                onExpand={handleExpand}
                isExpanded={expandedId === p.id}
                isExecuting={executingId === p.id}
              />

              {/* Execution history dropdown */}
              {expandedId === p.id && (
                <div className="rounded-lg border border-border bg-card/50 p-3 animate-fade-up">
                  <p className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Recent Executions
                  </p>
                  {!execHistory[p.id] ? (
                    <div className="space-y-2">
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-full" />
                    </div>
                  ) : execHistory[p.id].length === 0 ? (
                    <p className="text-xs text-muted-foreground">No executions yet</p>
                  ) : (
                    <div className="space-y-1.5">
                      {execHistory[p.id].map((exec) => (
                        <div
                          key={exec.id}
                          className="flex items-center justify-between rounded-md bg-background/50 px-2.5 py-1.5 text-[11px]"
                        >
                          <div className="flex items-center gap-2">
                            {exec.status === "completed" ? (
                              <CheckCircle className="h-3 w-3 text-green-400" />
                            ) : exec.status === "failed" ? (
                              <XCircle className="h-3 w-3 text-red-400" />
                            ) : (
                              <Clock className="h-3 w-3 text-yellow-400" />
                            )}
                            <Badge
                              variant="outline"
                              className={`text-[9px] ${
                                exec.status === "completed"
                                  ? "border-green-800 text-green-400"
                                  : exec.status === "failed"
                                    ? "border-red-800 text-red-400"
                                    : exec.status === "partial"
                                      ? "border-yellow-800 text-yellow-400"
                                      : "border-border"
                              }`}
                            >
                              {exec.status}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-3 text-muted-foreground">
                            <span>{formatDuration(exec.duration)}</span>
                            <span>{relativeTime(exec.createdAt)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
