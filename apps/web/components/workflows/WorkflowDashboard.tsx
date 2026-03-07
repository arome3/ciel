"use client"

import { useEffect, useState, useMemo } from "react"
import Link from "next/link"
import { useAccount } from "wagmi"
import { useConnectModal } from "@rainbow-me/rainbowkit"
import { Layers, Plus, Wallet, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { api, type WorkflowListItem } from "@/lib/api"
import { MyWorkflowCard } from "./MyWorkflowCard"

type StatusFilter = "all" | "drafts" | "published" | "failed"

export function WorkflowDashboard() {
  const { address } = useAccount()
  const { openConnectModal } = useConnectModal()
  const [workflows, setWorkflows] = useState<WorkflowListItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [filter, setFilter] = useState<StatusFilter>("all")
  const [search, setSearch] = useState("")

  useEffect(() => {
    if (!address) {
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    api
      .listWorkflows({ owner: address, published: "all", sort: "newest", limit: 100 })
      .then((res) => setWorkflows(res.workflows))
      .catch(() => {})
      .finally(() => setIsLoading(false))
  }, [address])

  const filtered = useMemo(() => {
    let result = workflows
    if (filter === "drafts") result = result.filter((w) => !w.published)
    else if (filter === "published") result = result.filter((w) => w.published)
    else if (filter === "failed") result = result.filter((w) => w.deployStatus === "failed")

    if (search) {
      const q = search.toLowerCase()
      result = result.filter((w) => w.name.toLowerCase().includes(q))
    }
    return result
  }, [workflows, filter, search])

  const stats = useMemo(() => ({
    total: workflows.length,
    published: workflows.filter((w) => w.published).length,
    drafts: workflows.filter((w) => !w.published).length,
    failed: workflows.filter((w) => w.deployStatus === "failed").length,
  }), [workflows])

  // Not connected
  if (!address) {
    return (
      <div className="container mx-auto max-w-7xl px-4 py-8">
        <header className="mb-10 animate-fade-up">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">My Workflows</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage all your CRE workflows in one place
          </p>
        </header>
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 px-8 py-16 text-center animate-fade-up">
          <div className="mb-4 rounded-full bg-muted p-4">
            <Wallet className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">Connect your wallet</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Connect your wallet to view and manage your workflows. All workflows are tied to your wallet address.
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
      <header className="mb-8 animate-fade-up">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">My Workflows</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage all your CRE workflows in one place
        </p>
      </header>

      {/* Stats bar */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 animate-fade-up" style={{ animationDelay: "50ms" }}>
        {[
          { label: "Total", value: stats.total },
          { label: "Published", value: stats.published },
          { label: "Drafts", value: stats.drafts },
          { label: "Failed", value: stats.failed },
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
            <TabsTrigger value="drafts">Drafts</TabsTrigger>
            <TabsTrigger value="published">Published</TabsTrigger>
            <TabsTrigger value="failed">Failed</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search workflows..."
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
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 px-8 py-16 text-center animate-fade-up">
          <div className="mb-4 rounded-full bg-muted p-4">
            <Layers className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">
            {workflows.length === 0 ? "Create your first workflow" : "No matching workflows"}
          </h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {workflows.length === 0
              ? "Describe an automation in plain language and Ciel will generate production-ready CRE code for you."
              : "Try adjusting your filters or search query."}
          </p>
          {workflows.length === 0 && (
            <Button className="mt-6 gap-1.5" asChild>
              <Link href="/build">
                <Plus className="h-4 w-4" />
                New Workflow
              </Link>
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 animate-fade-up" style={{ animationDelay: "150ms" }}>
          {filtered.map((w) => (
            <MyWorkflowCard key={w.id} workflow={w} />
          ))}
        </div>
      )}
    </div>
  )
}
