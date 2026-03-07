"use client"

import { useEffect, useState, useMemo } from "react"
import Link from "next/link"
import { useAccount } from "wagmi"
import { useConnectModal } from "@rainbow-me/rainbowkit"
import { Globe, Plus, Wallet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { api, type WorkflowListItem } from "@/lib/api"
import { PublishedWorkflowRow } from "./PublishedWorkflowRow"

export function PublishedDashboard() {
  const { address } = useAccount()
  const { openConnectModal } = useConnectModal()
  const [workflows, setWorkflows] = useState<WorkflowListItem[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!address) {
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    api
      .listWorkflows({ owner: address, published: "true", sort: "newest", limit: 100 })
      .then((res) => setWorkflows(res.workflows))
      .catch(() => {})
      .finally(() => setIsLoading(false))
  }, [address])

  const stats = useMemo(() => {
    const deployed = workflows.filter((w) => w.deployStatus === "deployed").length
    const totalExecs = workflows.reduce((sum, w) => sum + w.totalExecutions, 0)
    const totalSuccess = workflows.reduce((sum, w) => sum + w.successfulExecutions, 0)
    const avgSuccess = totalExecs > 0 ? Math.round((totalSuccess / totalExecs) * 100) : 0
    return {
      total: workflows.length,
      deployed,
      totalExecs,
      avgSuccess,
    }
  }, [workflows])

  if (!address) {
    return (
      <div className="container mx-auto max-w-7xl px-4 py-8">
        <header className="mb-10 animate-fade-up">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Published Workflows</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your published workflows and monitor deployments
          </p>
        </header>
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 px-8 py-16 text-center animate-fade-up">
          <div className="mb-4 rounded-full bg-muted p-4">
            <Wallet className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">Connect your wallet</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Connect your wallet to view your published workflows and deployment status.
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
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Published Workflows</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your published workflows and monitor deployments
        </p>
      </header>

      {/* Summary cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 animate-fade-up" style={{ animationDelay: "50ms" }}>
        {[
          { label: "Total Published", value: stats.total },
          { label: "Deployed to DON", value: stats.deployed },
          { label: "Total Executions", value: stats.totalExecs },
          { label: "Avg Success", value: `${stats.avgSuccess}%` },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-border bg-card px-4 py-3">
            <p className="text-xs font-medium text-muted-foreground">{s.label}</p>
            <p className="mt-1 text-2xl font-bold text-foreground">
              {isLoading ? <Skeleton className="h-8 w-12" /> : s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Table or empty state */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      ) : workflows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 px-8 py-16 text-center animate-fade-up">
          <div className="mb-4 rounded-full bg-muted p-4">
            <Globe className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">No published workflows yet</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Publish your first workflow from the Build page to make it available on the marketplace and deploy it to the DON.
          </p>
          <Button className="mt-6 gap-1.5" asChild>
            <Link href="/build">
              <Plus className="h-4 w-4" />
              Build a Workflow
            </Link>
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-border animate-fade-up" style={{ animationDelay: "100ms" }}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Executions</TableHead>
                <TableHead className="text-right">Success</TableHead>
                <TableHead>Deploy Status</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workflows.map((w) => (
                <PublishedWorkflowRow key={w.id} workflow={w} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
