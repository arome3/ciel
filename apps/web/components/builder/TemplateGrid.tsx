"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { useWorkflowStore } from "@/lib/store"
import { getCategoryVariant } from "@/lib/design-tokens"

// ─────────────────────────────────────────────
// Trigger type icons (inline SVG, 14×14)
// ─────────────────────────────────────────────

function CronIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
      aria-label="Cron trigger"
    >
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 4.5V8l2.5 1.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function HttpIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
      aria-label="HTTP trigger"
    >
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2 8h12M8 1.5c-2 2-2 5 0 6.5s2 4.5 0 6.5M8 1.5c2 2 2 5 0 6.5s-2 4.5 0 6.5" fill="none" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  )
}

function EvmLogIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
      aria-label="EVM log trigger"
    >
      <path d="M4 4h8M4 8h8M4 12h5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="12.5" cy="12" r="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

function TriggerIcon({ trigger, className }: { trigger: string; className?: string }) {
  switch (trigger) {
    case "http":
      return <HttpIcon className={className} />
    case "evm_log":
      return <EvmLogIcon className={className} />
    default:
      return <CronIcon className={className} />
  }
}

const TRIGGER_LABELS: Record<string, string> = {
  cron: "Scheduled",
  http: "On-demand",
  evm_log: "Event-driven",
}

// ─────────────────────────────────────────────
// Curated templates (real backend template IDs)
// ─────────────────────────────────────────────

interface Template {
  id: number
  title: string
  category: string
  trigger: string
  description: string
  prompt: string
  flagship?: boolean
}

const TEMPLATES: Template[] = [
  {
    id: 9,
    title: "Multi-AI Consensus Oracle",
    category: "AI",
    trigger: "http",
    description: "Query GPT-4o, Claude & Gemini with BFT voting for hallucination-resistant answers on-chain",
    prompt:
      "Query multiple AI models (GPT-4o, Claude, Gemini) for consensus on whether a major crypto credit event has occurred. Apply Byzantine fault-tolerant majority voting, reject hallucinations with outlier detection, and write the verified consensus answer onchain via evmWrite",
    flagship: true,
  },
  {
    id: 1,
    title: "Price Monitoring + Alert",
    category: "DeFi",
    trigger: "cron",
    description: "Track crypto prices and trigger alerts when thresholds are breached",
    prompt:
      "Monitor ETH/USD price every 5 minutes using Chainlink price feeds and send an alert notification when the price drops below $2000 or rises above $4000",
  },
  {
    id: 11,
    title: "Conditional DEX Swap",
    category: "DeFi",
    trigger: "cron",
    description: "Price-triggered automated swaps on Uniswap V3",
    prompt:
      "Monitor ETH/USD price every 5 minutes and automatically execute a token swap on Uniswap V3 when the price drops below a configured threshold",
  },
  {
    id: 2,
    title: "Cross-Chain Portfolio Rebalancer",
    category: "DeFi",
    trigger: "cron",
    description: "Auto-rebalance portfolio across chains via CCIP",
    prompt:
      "Monitor portfolio allocations every hour and execute cross-chain token swaps via CCIP when any asset deviates more than 5% from target weights",
  },
  {
    id: 12,
    title: "Wallet Activity Monitor",
    category: "DeFi",
    trigger: "evm_log",
    description: "Watch wallet transfers on-chain and send real-time alerts",
    prompt:
      "Monitor ERC-20 Transfer events for a specific wallet address on-chain and send an alert notification whenever a transfer above 1000 USDC is detected",
  },
  {
    id: 5,
    title: "Proof of Reserve Monitor",
    category: "Finance",
    trigger: "cron",
    description: "Verify off-chain reserves and write attestations on-chain",
    prompt:
      "Check the USDC reserve balance every hour via the custodian API, validate it against on-chain token supply, and write a proof-of-reserve attestation on-chain",
  },
  {
    id: 4,
    title: "Stablecoin Issuance Pipeline",
    category: "Finance",
    trigger: "http",
    description: "Compliance-gated minting with reserve verification",
    prompt:
      "Verify compliance and reserve backing for incoming deposits, then mint stablecoins on-chain and deliver them cross-chain to the depositor via CCIP",
  },
  {
    id: 15,
    title: "Cross-Chain CCIP Transfer",
    category: "Infrastructure",
    trigger: "cron",
    description: "Cross-chain token transfers via Chainlink CCIP",
    prompt:
      "Estimate CCIP fees, approve token spend, and execute a cross-chain token transfer from Ethereum to Base via the Chainlink CCIP Router",
  },
  {
    id: 8,
    title: "Compliance-Gated DeFi Ops",
    category: "Security",
    trigger: "http",
    description: "KYC/AML screening before on-chain execution",
    prompt:
      "Before executing a DeFi swap, run KYC/AML checks on the sender address via the compliance API and block the on-chain transaction if the risk score exceeds the threshold",
  },
  {
    id: 10,
    title: "Custom Data Feed / NAV Oracle",
    category: "AI",
    trigger: "cron",
    description: "Multi-source NAV calculation reported on-chain",
    prompt:
      "Fetch the latest prices of ETH, BTC, and LINK from multiple sources, compute the weighted NAV for a tokenized fund, and report the value on-chain",
  },
  {
    id: 19,
    title: "Escrow Lock / Release",
    category: "Settlement",
    trigger: "http",
    description: "Verify conditions and lock or release escrow on-chain",
    prompt:
      "When a settlement request arrives via HTTP, verify conditions via the settlement API and lock or release escrow funds on-chain based on the result",
  },
  {
    id: 22,
    title: "Dividend Distribution",
    category: "Finance",
    trigger: "cron",
    description: "Batch on-chain payouts from shareholder registry",
    prompt:
      "On the first of each month, fetch the shareholder registry, calculate pro-rata dividend amounts, and execute batch token transfers on-chain to all holders",
  },
  {
    id: 0,
    title: "Atomic DvP Settlement",
    category: "Settlement",
    trigger: "http",
    description: "Lock securities, initiate SWIFT payment, and atomically release on confirmation",
    prompt:
      "Build an escrow workflow that locks tokenized securities upon receiving a delivery instruction, initiates fiat payment via SWIFT, polls for payment confirmation, and atomically releases the securities to the buyer only after settlement is confirmed — with automatic rollback if payment fails within 24 hours",
  },
]

// ─────────────────────────────────────────────
// Category filter chips
// ─────────────────────────────────────────────

const CATEGORY_FILTERS = [
  "All",
  "DeFi",
  "AI",
  "Finance",
  "Security",
  "Settlement",
  "Infrastructure",
] as const

type CategoryFilter = (typeof CATEGORY_FILTERS)[number]

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export function TemplateGrid() {
  const setPrompt = useWorkflowStore((s) => s.setPrompt)
  const setTemplateHint = useWorkflowStore((s) => s.setTemplateHint)
  const [activeFilter, setActiveFilter] = useState<CategoryFilter>("All")

  const filtered =
    activeFilter === "All"
      ? TEMPLATES
      : TEMPLATES.filter((t) => t.category === activeFilter)

  const handleClick = (template: Template) => {
    setPrompt(template.prompt)
    setTemplateHint(template.id)
  }

  return (
    <section className="animate-fade-up" style={{ animationDelay: "100ms" }}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Try an example
        </h2>
        <Link
          href="/templates"
          className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
        >
          View all
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {/* Category filter chips */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {CATEGORY_FILTERS.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setActiveFilter(cat)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
              activeFilter === cat
                ? "bg-primary text-primary-foreground"
                : "bg-muted/50 text-muted-foreground hover:bg-muted"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Template cards */}
      <div className="gradient-mask-r">
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide snap-x snap-mandatory">
          {filtered.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => handleClick(template)}
              className={`group relative min-w-[220px] max-w-[240px] flex-shrink-0 snap-start rounded-xl border p-3 text-left transition-all hover:shadow-md ${
                template.flagship
                  ? "border-primary/40 bg-gradient-to-br from-card to-primary/[0.04] hover:border-primary/70"
                  : "border-border bg-card hover:border-primary/50"
              }`}
            >
              {/* Trigger icon + label */}
              <span className="absolute right-2.5 top-2.5 flex items-center gap-1 text-[10px] text-muted-foreground/60">
                <TriggerIcon trigger={template.trigger} className="h-3 w-3" />
                {TRIGGER_LABELS[template.trigger]}
              </span>

              {/* Category badge + flagship accent */}
              <div className="flex items-center gap-1.5">
                <span
                  className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-medium ${getCategoryVariant(template.category)}`}
                >
                  {template.category}
                </span>
                {template.flagship && (
                  <span className="inline-block rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                    Flagship
                  </span>
                )}
              </div>

              <p className="mt-2 text-sm font-semibold text-foreground transition-colors group-hover:text-primary">
                {template.title}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground line-clamp-2">
                {template.description}
              </p>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
