"use client"

import { useState, useCallback, useEffect } from "react"
import { ExternalLink, Copy, Check, Globe, Server, FileCode, Shield, Zap } from "lucide-react"
import { api } from "@/lib/api"

const NETWORK_LABELS: Record<number, string> = {
  1: "Ethereum Mainnet",
  84532: "Base Sepolia",
  8453: "Base",
  42161: "Arbitrum One",
}

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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={handleCopy}
      className="ml-2 inline-flex items-center text-muted-foreground hover:text-foreground transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <Check className="size-3.5 text-green-400" /> : <Copy className="size-3.5" />}
    </button>
  )
}

const FEATURES = [
  {
    icon: Globe,
    title: "Fork Real State",
    desc: "Full mainnet state available — real token balances, deployed contracts, live oracle data.",
  },
  {
    icon: Shield,
    title: "Safe Testing",
    desc: "Snapshot and revert to any state. Unlimited faucet for gas — no real funds at risk.",
  },
  {
    icon: FileCode,
    title: "CRE Workflows",
    desc: "AI-generated CRE workflows are simulated and validated on the Virtual TestNet before publishing.",
  },
  {
    icon: Zap,
    title: "Shareable Explorer",
    desc: "Every transaction is visible in a public Tenderly Explorer — perfect for demos and audits.",
  },
]

export function TestnetDashboard() {
  const [state, setState] = useState<TestnetState | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const data = await api.tenderlyStatus()
      setState(data)
      setError(null)
    } catch {
      // Tenderly not configured — show inactive state
      setState({ active: false, testnet: null, contracts: { registry: null, consumer: null }, snapshotId: null })
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const t = state?.testnet

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Powered by Tenderly badge */}
      <div className="flex items-center gap-3 rounded-lg border border-border bg-card/50 px-4 py-3">
        <Server className="size-5 text-purple-400 shrink-0" />
        <div className="flex-1">
          <p className="text-xs font-medium text-foreground">
            Powered by Tenderly Virtual TestNets
          </p>
          <p className="text-xs text-muted-foreground">
            Ciel uses ephemeral blockchain forks with full mainnet state to simulate and validate every workflow before it goes live.
          </p>
        </div>
        <a
          href="https://tenderly.co/virtual-testnets"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          Learn more <ExternalLink className="inline size-3 ml-0.5" />
        </a>
      </div>

      {/* Active TestNet Status */}
      {t ? (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-full bg-green-500/10">
                <div className="size-2.5 rounded-full bg-green-400 animate-pulse" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">{t.name}</h3>
                <p className="text-xs text-muted-foreground">
                  {NETWORK_LABELS[t.networkId] ?? `Chain ${t.networkId}`} &middot; Chain ID {t.chainId}
                </p>
              </div>
            </div>
            <span className="inline-flex items-center rounded-full bg-green-900/60 px-2.5 py-0.5 text-xs font-medium text-green-300">
              Active
            </span>
          </div>

          {/* Explorer Link — prominent */}
          <a
            href={t.explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 border-b border-border px-5 py-3 bg-primary/5 hover:bg-primary/10 transition-colors group"
          >
            <ExternalLink className="size-4 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-primary group-hover:underline">
                Open Tenderly Explorer
              </p>
              <p className="text-xs text-muted-foreground truncate">
                View all transactions, contract state, and execution traces
              </p>
            </div>
          </a>

          {/* Details */}
          <div className="px-5 py-4 space-y-3">
            <div>
              <p className="text-xs text-muted-foreground mb-1">RPC URL</p>
              <div className="flex items-center">
                <code className="text-xs font-mono text-foreground truncate flex-1">{t.rpcUrl}</code>
                <CopyButton text={t.rpcUrl} />
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">VNet ID</p>
              <div className="flex items-center">
                <code className="text-xs font-mono text-foreground truncate flex-1">{t.id}</code>
                <CopyButton text={t.id} />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card px-5 py-8 text-center">
          <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-muted">
            <Server className="size-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground">No Active Virtual TestNet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            A Virtual TestNet will appear here when one is running.
          </p>
        </div>
      )}

      {/* Deployed Contracts */}
      {state?.contracts?.registry && (
        <div className="rounded-lg border border-border bg-card p-5">
          <h3 className="mb-4 text-sm font-semibold text-foreground">Deployed Contracts</h3>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-muted-foreground mb-1">AutopilotRegistry</p>
              <div className="flex items-center">
                <code className="text-xs font-mono text-foreground truncate flex-1">
                  {state.contracts.registry}
                </code>
                <CopyButton text={state.contracts.registry!} />
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">AutopilotConsumer</p>
              <div className="flex items-center">
                <code className="text-xs font-mono text-foreground truncate flex-1">
                  {state.contracts.consumer}
                </code>
                <CopyButton text={state.contracts.consumer!} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* How it works */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-foreground">How It Works</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {FEATURES.map(f => (
            <div key={f.title} className="rounded-lg border border-border bg-card/50 p-4">
              <div className="flex items-center gap-2 mb-1.5">
                <f.icon className="size-4 text-muted-foreground" />
                <p className="text-xs font-medium text-foreground">{f.title}</p>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
