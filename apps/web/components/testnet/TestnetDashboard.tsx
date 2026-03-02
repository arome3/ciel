"use client"

import { useState, useCallback, useEffect } from "react"
import { api } from "@/lib/api"

const NETWORKS = [
  { id: 1, label: "Ethereum Mainnet" },
  { id: 84532, label: "Base Sepolia" },
  { id: 8453, label: "Base" },
  { id: 42161, label: "Arbitrum One" },
] as const

const NETWORK_LABELS: Record<number, string> = Object.fromEntries(
  NETWORKS.map(n => [n.id, n.label]),
)

interface TestnetState {
  active: boolean
  testnet: {
    id: string
    name: string
    networkId: number
    chainId: number
    rpcUrl: string
    explorerUrl: string
  } | null
  contracts: { registry: string | null; consumer: string | null }
  snapshotId: string | null
}

export function TestnetDashboard() {
  const [state, setState] = useState<TestnetState | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Create form state
  const [name, setName] = useState("ciel-testnet")
  const [networkId, setNetworkId] = useState(84532)
  const [syncState, setSyncState] = useState(false)

  // Fund form state
  const [fundAddress, setFundAddress] = useState("")
  const [fundAmount, setFundAmount] = useState("100")

  const refresh = useCallback(async () => {
    try {
      const data = await api.tenderlyStatus()
      setState(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch status")
    }
  }, [])

  const handleCreate = async () => {
    setLoading("create")
    setError(null)
    try {
      await api.tenderlyCreate({ name, networkId, syncState })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create testnet")
    } finally {
      setLoading(null)
    }
  }

  const handleDeploy = async () => {
    setLoading("deploy")
    setError(null)
    try {
      await api.tenderlyDeployContracts()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to deploy contracts")
    } finally {
      setLoading(null)
    }
  }

  const handleFund = async () => {
    if (!fundAddress) return
    setLoading("fund")
    setError(null)
    try {
      await api.tenderlyFund(fundAddress, Number(fundAmount))
      setFundAddress("")
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fund account")
    } finally {
      setLoading(null)
    }
  }

  const handleSnapshot = async () => {
    setLoading("snapshot")
    setError(null)
    try {
      await api.tenderlySnapshot()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create snapshot")
    } finally {
      setLoading(null)
    }
  }

  const handleRevert = async () => {
    if (!state?.snapshotId) return
    setLoading("revert")
    setError(null)
    try {
      await api.tenderlyRevert(state.snapshotId)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revert")
    } finally {
      setLoading(null)
    }
  }

  const handleCleanup = async () => {
    setLoading("cleanup")
    setError(null)
    try {
      await api.tenderlyCleanup()
      setState(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cleanup")
    } finally {
      setLoading(null)
    }
  }

  // Initial load — must be in useEffect, not render body
  useEffect(() => {
    refresh()
  }, [refresh])

  const t = state?.testnet

  return (
    <div className="space-y-6">
      {/* Error banner */}
      {error && (
        <div className="rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Status Card */}
      {t && (
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground">{t.name}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {NETWORK_LABELS[t.networkId] ?? `Chain ${t.networkId}`} &middot; Chain ID {t.chainId}
              </p>
            </div>
            <span className="inline-flex items-center rounded-full bg-green-900/60 px-2.5 py-0.5 text-xs font-medium text-green-300">
              Active
            </span>
          </div>
          <div className="mt-4 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">RPC URL</span>
              <button
                onClick={() => navigator.clipboard.writeText(t.rpcUrl)}
                className="max-w-[300px] truncate text-right font-mono text-foreground hover:text-primary"
                title="Click to copy"
              >
                {t.rpcUrl}
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Explorer</span>
              <a
                href={t.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary hover:underline"
              >
                Open Explorer
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Contracts Card */}
      {state?.contracts?.registry && (
        <div className="rounded-lg border border-border bg-card p-5">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Deployed Contracts</h3>
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Registry</span>
              <span className="font-mono text-foreground">{state.contracts.registry}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Consumer</span>
              <span className="font-mono text-foreground">{state.contracts.consumer}</span>
            </div>
          </div>
        </div>
      )}

      {/* Create Panel (only show when no active testnet) */}
      {!t && (
        <div className="rounded-lg border border-border bg-card p-5">
          <h3 className="mb-4 text-sm font-semibold text-foreground">Create Virtual TestNet</h3>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="ciel-testnet"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Fork Network</label>
              <select
                value={networkId}
                onChange={e => setNetworkId(Number(e.target.value))}
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {NETWORKS.map(n => (
                  <option key={n.id} value={n.id}>{n.label}</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={syncState}
                onChange={e => setSyncState(e.target.checked)}
                className="rounded border-border"
              />
              Enable real-time state sync
            </label>
            <button
              onClick={handleCreate}
              disabled={loading !== null || !name}
              className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading === "create" ? "Creating..." : "Create TestNet"}
            </button>
          </div>
        </div>
      )}

      {/* Fund Card (only when active) */}
      {t && (
        <div className="rounded-lg border border-border bg-card p-5">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Fund Account</h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={fundAddress}
              onChange={e => setFundAddress(e.target.value)}
              placeholder="0x..."
              className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <input
              type="number"
              value={fundAmount}
              onChange={e => setFundAmount(e.target.value)}
              className="w-24 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              min="1"
              max="10000"
            />
            <button
              onClick={handleFund}
              disabled={loading !== null || !fundAddress}
              className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading === "fund" ? "..." : "Fund"}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Amount in ETH (default 100). Unlimited faucet on Virtual TestNets.
          </p>
        </div>
      )}

      {/* Actions Row */}
      {t && (
        <div className="flex flex-wrap gap-2">
          {!state?.contracts?.registry && (
            <button
              onClick={handleDeploy}
              disabled={loading !== null}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading === "deploy" ? "Deploying..." : "Deploy Contracts"}
            </button>
          )}
          <button
            onClick={handleSnapshot}
            disabled={loading !== null}
            className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
          >
            {loading === "snapshot" ? "..." : "Snapshot"}
          </button>
          {state?.snapshotId && (
            <button
              onClick={handleRevert}
              disabled={loading !== null}
              className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
            >
              {loading === "revert" ? "..." : "Revert"}
            </button>
          )}
          <button
            onClick={handleCleanup}
            disabled={loading !== null}
            className="rounded-md border border-red-800/50 bg-red-950/30 px-4 py-2 text-sm font-medium text-red-300 hover:bg-red-900/40 disabled:opacity-50"
          >
            {loading === "cleanup" ? "..." : "Destroy"}
          </button>
        </div>
      )}
    </div>
  )
}
