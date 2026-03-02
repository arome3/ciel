"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import dynamic from "next/dynamic"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useWorkflowStore } from "@/lib/store"
import { getCategoryVariant, getCategoryLabel, CHAIN_COLORS } from "@/lib/design-tokens"
import { api, type WorkflowDetail } from "@/lib/api"

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[400px] items-center justify-center rounded-lg border border-border bg-muted">
      <div className="space-y-2 text-center">
        <div className="mx-auto h-4 w-32 rounded bg-muted-foreground/10 animate-skeleton" />
        <p className="text-xs text-muted-foreground">Loading editor</p>
      </div>
    </div>
  ),
})

const EDITOR_OPTIONS = {
  readOnly: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  fontSize: 13,
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  lineHeight: 1.6,
  lineNumbers: "on" as const,
  wordWrap: "on" as const,
  padding: { top: 12 },
  renderLineHighlight: "none" as const,
  overviewRulerBorder: false,
  hideCursorInOverviewRuler: true,
  scrollbar: {
    verticalScrollbarSize: 8,
    horizontalScrollbarSize: 8,
  },
}

function truncateAddress(address: string): string {
  if (address.length <= 12) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "success":
      return (
        <span className="font-mono text-xs font-bold text-green-400">
          [OK]
        </span>
      )
    case "error":
      return (
        <span className="font-mono text-xs font-bold text-red-400">
          [ERR]
        </span>
      )
    default:
      return (
        <span className="font-mono text-xs font-bold text-muted-foreground">
          [SKIP]
        </span>
      )
  }
}

function DetailSkeleton() {
  return (
    <div className="container mx-auto max-w-5xl space-y-8 px-4 py-8">
      <Skeleton className="h-4 w-48" />
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        <div className="flex gap-6">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-32" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-6 w-16 rounded-full" />
          <Skeleton className="h-6 w-16 rounded-full" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      </div>
      <Skeleton className="h-[400px] w-full rounded-lg" />
      <Skeleton className="h-10 w-40" />
    </div>
  )
}

export default function WorkflowDetailPage() {
  const params = useParams<{ id: string }>()
  const walletAddress = useWorkflowStore((s) => s.walletAddress)

  const [workflow, setWorkflow] = useState<WorkflowDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [executing, setExecuting] = useState(false)
  const [execResult, setExecResult] = useState<unknown>(null)
  const [execError, setExecError] = useState<string | null>(null)

  useEffect(() => {
    if (!params.id) return

    let cancelled = false
    setLoading(true)
    setError(null)

    api
      .getWorkflow(params.id)
      .then((data) => {
        if (!cancelled) setWorkflow(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load workflow")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [params.id])

  const isOwner =
    walletAddress !== null &&
    workflow !== null &&
    walletAddress.toLowerCase() === workflow.ownerAddress.toLowerCase()

  const handleExecute = useCallback(async () => {
    if (!workflow || executing) return

    setExecuting(true)
    setExecResult(null)
    setExecError(null)

    try {
      const result = await api.executeWorkflow(workflow.id)
      setExecResult(result)
    } catch (err) {
      setExecError(err instanceof Error ? err.message : "Execution failed")
    } finally {
      setExecuting(false)
    }
  }, [workflow, executing])

  if (loading) return <DetailSkeleton />

  if (error || !workflow) {
    return (
      <div className="container mx-auto max-w-5xl px-4 py-8">
        <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card">
          <p className="text-sm text-red-400">{error ?? "Workflow not found"}</p>
          <Link
            href="/marketplace"
            className="mt-3 text-sm text-primary hover:underline"
          >
            Back to Marketplace
          </Link>
        </div>
      </div>
    )
  }

  const price = (workflow.priceUsdc / 1_000_000).toFixed(2)
  const successRate =
    workflow.totalExecutions > 0
      ? Math.round(
          (workflow.successfulExecutions / workflow.totalExecutions) * 100,
        )
      : 0

  return (
    <div className="container mx-auto max-w-5xl space-y-8 px-4 py-8">
      {/* Breadcrumb */}
      <nav className="text-sm text-muted-foreground">
        <Link href="/marketplace" className="hover:text-foreground">
          Marketplace
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{workflow.name}</span>
      </nav>

      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-foreground">
            {workflow.name}
          </h1>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${getCategoryVariant(workflow.category)}`}
          >
            {getCategoryLabel(workflow.category)}
          </span>
        </div>

        <p className="text-sm text-muted-foreground">
          {workflow.description}
        </p>

        {/* Stats row */}
        <div className="flex flex-wrap gap-6 text-sm">
          <span className="text-foreground">
            <span className="font-mono font-semibold">${price}</span>{" "}
            <span className="text-muted-foreground">USDC</span>
          </span>
          <span className="text-muted-foreground">
            {successRate}% success rate
          </span>
          <span className="text-muted-foreground">
            {workflow.totalExecutions.toLocaleString()} executions
          </span>
          <span className="text-muted-foreground">
            Template {workflow.templateId}
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            {truncateAddress(workflow.ownerAddress)}
          </span>
        </div>

        {/* Chains + capabilities */}
        <div className="flex flex-wrap gap-2">
          {workflow.chains.map((chain) => (
            <Badge key={chain} variant="outline" className="gap-1.5">
              <span
                className={`h-2 w-2 rounded-full ${CHAIN_COLORS[chain] ?? "bg-muted-foreground"}`}
              />
              {chain}
            </Badge>
          ))}
          {workflow.capabilities.map((cap) => (
            <Badge key={cap} variant="secondary">
              {cap}
            </Badge>
          ))}
        </div>
      </div>

      {/* Tabbed code view */}
      <Tabs defaultValue="code">
        <TabsList>
          <TabsTrigger value="code">Code</TabsTrigger>
          <TabsTrigger value="config">Config</TabsTrigger>
          {workflow.simulationTrace && (
            <TabsTrigger value="simulation">Simulation</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="code">
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-1.5">
              <span className="h-2 w-2 rounded-full bg-primary/60" />
              <span className="font-mono text-xs text-muted-foreground">
                workflow.ts
              </span>
              <span className="ml-auto font-mono text-[10px] text-muted-foreground/50">
                read-only
              </span>
            </div>
            <MonacoEditor
              height="400px"
              language="typescript"
              theme="vs-dark"
              value={workflow.code}
              options={EDITOR_OPTIONS}
            />
          </div>
        </TabsContent>

        <TabsContent value="config">
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-1.5">
              <span className="h-2 w-2 rounded-full bg-yellow-400/60" />
              <span className="font-mono text-xs text-muted-foreground">
                config.json
              </span>
              <span className="ml-auto font-mono text-[10px] text-muted-foreground/50">
                read-only
              </span>
            </div>
            <MonacoEditor
              height="300px"
              language="json"
              theme="vs-dark"
              value={JSON.stringify(workflow.config, null, 2)}
              options={EDITOR_OPTIONS}
            />
          </div>
        </TabsContent>

        {workflow.simulationTrace && (
          <TabsContent value="simulation">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="space-y-0">
                {workflow.simulationTrace.map((step, i) => (
                  <div key={step.step + i}>
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex-shrink-0">
                        <StatusBadge status={step.status} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-sm font-medium text-foreground">
                            {step.step}
                          </p>
                          <span className="flex-shrink-0 font-mono text-[11px] text-muted-foreground">
                            {step.duration}ms
                          </span>
                        </div>
                        {step.status === "error" && step.output && (
                          <p className="mt-1 text-xs text-red-400">
                            {step.output}
                          </p>
                        )}
                      </div>
                    </div>
                    {i < workflow.simulationTrace!.length - 1 && (
                      <div className="ml-3 mt-1 h-6 w-px bg-border" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>
        )}
      </Tabs>

      {/* Execute button */}
      <div className="space-y-4">
        <Button
          onClick={handleExecute}
          disabled={executing}
          className="active:scale-[0.98]"
        >
          {executing
            ? "Executing..."
            : isOwner
              ? "Execute (Free)"
              : `Execute ($${price})`}
        </Button>

        {execError && (
          <p className="text-sm text-red-400" role="alert">
            {execError}
          </p>
        )}

        {execResult !== null && (
          <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-4">
            <p className="mb-2 text-sm font-semibold text-green-400">
              Execution Result
            </p>
            <pre className="overflow-auto font-mono text-xs text-foreground">
              {JSON.stringify(execResult, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}
