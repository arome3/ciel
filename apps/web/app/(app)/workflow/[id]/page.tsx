"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import dynamic from "next/dynamic"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent } from "@/components/ui/card"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { useAccount, useSignMessage } from "wagmi"
import { getCategoryVariant, getCategoryLabel, CHAIN_COLORS } from "@/lib/design-tokens"
import { api, type WorkflowDetail } from "@/lib/api"
import { toastSuccess, toastError, toastInfo } from "@/lib/toast"
import { createSSEConnection } from "@/lib/sse"
import { ExportGitHubDialog } from "@/components/builder/ExportGitHubDialog"
import { Github } from "lucide-react"

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

function CopySnippet({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2">
      <code className="flex-1 overflow-x-auto font-mono text-xs text-foreground whitespace-nowrap">
        {text}
      </code>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 shrink-0 px-2 text-[11px]"
        onClick={handleCopy}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  )
}

function DeployStatusBadge({ status }: { status: string | null }) {
  const label = status ?? "none"
  const colorClass =
    status === "deployed"
      ? "border-green-500/40 text-green-400"
      : status === "pending"
        ? "border-yellow-500/40 text-yellow-400"
        : status === "failed"
          ? "border-red-500/40 text-red-400"
          : "border-border text-muted-foreground"

  return (
    <Badge variant="outline" className={colorClass}>
      {label}
    </Badge>
  )
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
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()

  const [workflow, setWorkflow] = useState<WorkflowDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [executing, setExecuting] = useState(false)
  const [execResult, setExecResult] = useState<unknown>(null)
  const [execError, setExecError] = useState<string | null>(null)

  // ── Config editing (owner only) ──
  const [editedConfig, setEditedConfig] = useState("")
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // ── Redeploy (owner only, failed/none status) ──
  const [redeploying, setRedeploying] = useState(false)

  // ── GitHub export ──
  const [exportOpen, setExportOpen] = useState(false)

  // ── Execute overrides (anyone) ──
  const [showOverrides, setShowOverrides] = useState(false)
  const [overrideConfig, setOverrideConfig] = useState("")

  useEffect(() => {
    if (!params.id) return

    let cancelled = false
    setLoading(true)
    setError(null)

    api
      .getWorkflow(params.id)
      .then((data) => {
        if (!cancelled) {
          setWorkflow(data)
          const configStr = JSON.stringify(data.config, null, 2)
          setEditedConfig(configStr)
          setOverrideConfig(configStr)
        }
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

  // ── SSE: live deploy status updates ──
  useEffect(() => {
    if (!params.id) return

    const cleanup = createSSEConnection({
      onDeploy: (raw) => {
        const d = raw as Record<string, unknown>
        if (d.workflowId !== params.id) return

        const status = d.status as string
        setWorkflow((prev) => prev ? { ...prev, deployStatus: status } : prev)
        setRedeploying(false)

        if (status === "deployed") {
          toastSuccess("Deployed to DON", "Workflow is now running on the Chainlink network")
        } else if (status === "failed") {
          toastError("DON deploy failed", typeof d.error === "string" ? d.error : "Deployment failed")
        }
      },
    })

    return cleanup
  }, [params.id])

  const isOwner =
    address !== undefined &&
    workflow !== null &&
    address.toLowerCase() === workflow.ownerAddress.toLowerCase()

  const configDirty =
    workflow !== null &&
    editedConfig !== JSON.stringify(workflow.config, null, 2)

  const handleSaveConfig = useCallback(async () => {
    if (!workflow || !address || saving) return

    setSaving(true)
    setSaveError(null)

    try {
      const parsed = JSON.parse(editedConfig)
      const signature = await signMessageAsync({ message: workflow.id })
      const { config: updated } = await api.updateWorkflowConfig(
        workflow.id,
        parsed,
        { address, signature },
      )
      setWorkflow({ ...workflow, config: updated })
      setOverrideConfig(JSON.stringify(updated, null, 2))
      toastSuccess("Config saved", "Workflow defaults updated successfully")
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save config"
      setSaveError(msg)
      toastError("Save failed", msg)
    } finally {
      setSaving(false)
    }
  }, [workflow, address, saving, editedConfig, signMessageAsync])

  const canRedeploy =
    isOwner &&
    workflow !== null &&
    workflow.published &&
    (workflow.deployStatus === "failed" || workflow.deployStatus === "none")

  const handleRedeploy = useCallback(async () => {
    if (!workflow || !address || redeploying) return

    setRedeploying(true)

    try {
      const signature = await signMessageAsync({ message: workflow.id })
      const result = await api.redeployWorkflow(workflow.id, { address, signature })
      setWorkflow({ ...workflow, deployStatus: result.deployStatus } as WorkflowDetail)
      toastSuccess("Deploy initiated", "Workflow is being deployed to the DON")
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Redeploy failed"
      toastError("Deploy failed", msg)
    } finally {
      setRedeploying(false)
    }
  }, [workflow, address, redeploying, signMessageAsync])

  const handleExecute = useCallback(async () => {
    if (!workflow || executing) return

    setExecuting(true)
    setExecResult(null)
    setExecError(null)

    try {
      let ownerAuth: { address: string; signature: string } | undefined
      if (isOwner && address) {
        try {
          const signature = await signMessageAsync({ message: workflow.id })
          ownerAuth = { address, signature }
        } catch {
          // User rejected signing — fall through to paid execution
        }
      }

      // Parse overrides if the override panel is open
      let configOverrides: Record<string, unknown> | undefined
      if (showOverrides) {
        try {
          const parsed = JSON.parse(overrideConfig)
          const originalConfig = workflow.config
          // Only send overrides if different from stored config
          if (JSON.stringify(parsed) !== JSON.stringify(originalConfig)) {
            configOverrides = parsed
          }
        } catch {
          setExecError("Invalid JSON in config overrides")
          setExecuting(false)
          return
        }
      }

      const result = await api.executeWorkflow(workflow.id, ownerAuth, configOverrides)
      setExecResult(result)
      toastSuccess("Execution complete")
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Execution failed"
      setExecError(msg)
      toastError("Execution failed", msg)
    } finally {
      setExecuting(false)
    }
  }, [workflow, executing, isOwner, address, signMessageAsync, showOverrides, overrideConfig])

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

  const isFree = workflow.priceUsdc === 0
  const price = isFree ? "Free" : `$${(workflow.priceUsdc / 1_000_000).toFixed(2)}`
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
            <span className="font-mono font-semibold">{price}</span>
            {!isFree && <span className="text-muted-foreground"> USDC</span>}
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

        {/* Actions row */}
        <div className="flex flex-wrap gap-2">
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
            onClick={() => {
              window.open(api.workflowExportUrl(workflow.id), "_blank")
              toastSuccess("Downloading CRE project")
            }}
          >
            Download .zip
          </Button>
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
                {isOwner ? "editable" : "read-only"}
              </span>
            </div>
            <MonacoEditor
              height="300px"
              language="json"
              theme="vs-dark"
              value={isOwner ? editedConfig : JSON.stringify(workflow.config, null, 2)}
              options={isOwner ? { ...EDITOR_OPTIONS, readOnly: false } : EDITOR_OPTIONS}
              onChange={(value) => {
                if (isOwner && value !== undefined) setEditedConfig(value)
              }}
            />
          </div>
          {isOwner && (
            <div className="mt-3 flex items-center gap-3">
              <Button
                onClick={handleSaveConfig}
                disabled={!configDirty || saving}
                variant="secondary"
                size="sm"
              >
                {saving ? "Saving..." : "Save Config"}
              </Button>
              {saveError && (
                <p className="text-sm text-red-400">{saveError}</p>
              )}
            </div>
          )}
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

      {/* Deploy guide */}
      <Card>
        <CardHeader>
          <CardTitle>Deploy to DON</CardTitle>
          <CardDescription>
            Deploy this workflow to the Chainlink Decentralized Oracle Network for production execution.
          </CardDescription>
          {isOwner && workflow.published && (
            <CardAction className="flex items-center gap-2">
              <DeployStatusBadge status={workflow.deployStatus} />
              {canRedeploy && (
                <Button
                  onClick={handleRedeploy}
                  disabled={redeploying}
                  variant="outline"
                  size="sm"
                >
                  {redeploying ? "Deploying..." : "Redeploy"}
                </Button>
              )}
            </CardAction>
          )}
        </CardHeader>

        <CardContent>
          <Tabs defaultValue="cli">
            <TabsList>
              <TabsTrigger value="cli">CLI Deploy</TabsTrigger>
              <TabsTrigger value="manual">Manual Deploy</TabsTrigger>
            </TabsList>

            <TabsContent value="cli" className="space-y-4">
              <Alert>
                <AlertTitle>Prerequisites</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4 text-xs">
                    <li>CRE CLI installed and authenticated</li>
                    <li><code className="rounded bg-muted px-1 font-mono text-[11px]">CIEL_PRIVATE_KEY</code> environment variable set</li>
                  </ul>
                </AlertDescription>
              </Alert>

              <div className="space-y-0">
                {/* Step 1 */}
                <div className="flex items-start gap-3">
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[10px] text-muted-foreground">
                    1
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="text-sm font-medium text-foreground">Install the Ciel CLI</p>
                    <CopySnippet text="npm i -g @ciel/cli" />
                  </div>
                </div>
                <div className="ml-2.5 h-4 w-px bg-border" />

                {/* Step 2 */}
                <div className="flex items-start gap-3">
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[10px] text-muted-foreground">
                    2
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="text-sm font-medium text-foreground">Authenticate CRE access</p>
                    <CopySnippet text="cre account access" />
                  </div>
                </div>
                <div className="ml-2.5 h-4 w-px bg-border" />

                {/* Step 3 — primary */}
                <div className="flex items-start gap-3">
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary font-mono text-[10px] text-primary-foreground">
                    3
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="text-sm font-medium text-foreground">Deploy the workflow</p>
                    <CopySnippet text={`ciel deploy ${workflow.id}`} />
                    <p className="text-xs text-muted-foreground">
                      This fetches the workflow bundle, scaffolds the CRE project, deploys to the DON, and reports back.
                    </p>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="manual" className="space-y-4">
              <Alert>
                <AlertTitle>Prerequisites</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4 text-xs">
                    <li>CRE CLI installed (<code className="rounded bg-muted px-1 font-mono text-[11px]">npm i -g @chainlink/cre-cli</code>)</li>
                    <li>CRE account access configured (<code className="rounded bg-muted px-1 font-mono text-[11px]">cre account access</code>)</li>
                    <li>Bun runtime installed</li>
                  </ul>
                </AlertDescription>
              </Alert>

              <div className="space-y-0">
                {/* Step 1 */}
                <div className="flex items-start gap-3">
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[10px] text-muted-foreground">
                    1
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="text-sm font-medium text-foreground">Download and unzip the project</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        window.open(api.workflowExportUrl(workflow.id), "_blank")
                        toastSuccess("Downloading CRE project")
                      }}
                    >
                      Download .zip
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      Unzip to get a ready-to-use project with <code className="rounded bg-muted px-1 font-mono text-[11px]">project.yaml</code>, <code className="rounded bg-muted px-1 font-mono text-[11px]">wf/main.ts</code>, and all config files pre-configured.
                    </p>
                  </div>
                </div>
                <div className="ml-2.5 h-4 w-px bg-border" />

                {/* Step 2 */}
                <div className="flex items-start gap-3">
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[10px] text-muted-foreground">
                    2
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="text-sm font-medium text-foreground">Install dependencies</p>
                    <CopySnippet text="cd wf && bun install && cd .." />
                  </div>
                </div>
                <div className="ml-2.5 h-4 w-px bg-border" />

                {/* Step 3 — primary */}
                <div className="flex items-start gap-3">
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary font-mono text-[10px] text-primary-foreground">
                    3
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="text-sm font-medium text-foreground">Deploy to DON</p>
                    <CopySnippet text="cre workflow deploy wf --target production-settings" />
                    <p className="text-xs text-muted-foreground">
                      Run from the project root (where <code className="rounded bg-muted px-1 font-mono text-[11px]">project.yaml</code> lives). This compiles to WASM and deploys to the Chainlink DON.
                    </p>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Execute section */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button
            onClick={handleExecute}
            disabled={executing}
            className="active:scale-[0.98]"
          >
            {executing
              ? "Executing..."
              : isOwner || isFree
                ? "Execute (Free)"
                : `Execute (${price})`}
          </Button>
          <button
            type="button"
            onClick={() => setShowOverrides(!showOverrides)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showOverrides ? "Hide overrides" : "Customize config"}
          </button>
        </div>

        {showOverrides && (
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-1.5">
              <span className="h-2 w-2 rounded-full bg-blue-400/60" />
              <span className="font-mono text-xs text-muted-foreground">
                execution overrides
              </span>
              <span className="ml-auto font-mono text-[10px] text-muted-foreground/50">
                per-execution only
              </span>
            </div>
            <MonacoEditor
              height="200px"
              language="json"
              theme="vs-dark"
              value={overrideConfig}
              options={{ ...EDITOR_OPTIONS, readOnly: false }}
              onChange={(value) => {
                if (value !== undefined) setOverrideConfig(value)
              }}
            />
          </div>
        )}

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

      <ExportGitHubDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        workflowId={workflow.id}
        workflowName={workflow.name}
      />
    </div>
  )
}
