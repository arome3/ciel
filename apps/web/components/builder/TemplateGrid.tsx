"use client"

import { useWorkflowStore } from "@/lib/store"
import { getCategoryVariant } from "@/lib/design-tokens"

interface Template {
  id: number
  title: string
  category: string
  description: string
  prompt: string
}

const TEMPLATES: Template[] = [
  {
    id: 1,
    title: "Proof of Reserve",
    category: "Finance",
    description: "Verify off-chain reserves and write attestations on-chain",
    prompt:
      "Check the USDC reserve balance every hour via the custodian API, validate it against on-chain token supply, and write a proof-of-reserve attestation on-chain",
  },
  {
    id: 2,
    title: "Stablecoin Issuance",
    category: "Finance",
    description: "Compliance-gated minting with reserve verification",
    prompt:
      "Verify compliance and reserve backing for incoming deposits, then mint stablecoins on-chain and deliver them cross-chain to the depositor via CCIP",
  },
  {
    id: 3,
    title: "AI Market Settlement",
    category: "AI",
    description: "Settle prediction markets using multi-AI consensus",
    prompt:
      "When a prediction market resolution event is emitted on-chain, query three AI models for the outcome, aggregate via BFT consensus, and settle the market contract on-chain",
  },
  {
    id: 4,
    title: "Cross-Chain Rebalancer",
    category: "DeFi",
    description: "Auto-rebalance portfolio across chains via CCIP",
    prompt:
      "Monitor portfolio allocations every hour and execute cross-chain token swaps via CCIP when any asset deviates more than 5% from target weights",
  },
  {
    id: 5,
    title: "Compliance Gate",
    category: "Security",
    description: "KYC/AML screening before on-chain execution",
    prompt:
      "Before executing a DeFi swap, run KYC/AML checks on the sender address via the compliance API and block the on-chain transaction if the risk score exceeds the threshold",
  },
  {
    id: 6,
    title: "NAV Oracle",
    category: "Finance",
    description: "Multi-source NAV calculation reported on-chain",
    prompt:
      "Fetch the latest prices of ETH, BTC, and LINK from multiple sources, compute the weighted NAV for a tokenized fund, and report the value on-chain",
  },
  {
    id: 7,
    title: "Conditional DEX Swap",
    category: "DeFi",
    description: "Price-triggered automated swaps on Uniswap V3",
    prompt:
      "Monitor ETH/USD price every 5 minutes and automatically execute a token swap on Uniswap V3 when the price drops below a configured threshold",
  },
  {
    id: 8,
    title: "CCIP Transfer",
    category: "Infrastructure",
    description: "Cross-chain token transfers via Chainlink CCIP",
    prompt:
      "Estimate CCIP fees, approve token spend, and execute a cross-chain token transfer from Ethereum to Base via the Chainlink CCIP Router",
  },
  {
    id: 9,
    title: "Escrow Settlement",
    category: "Settlement",
    description: "Verify conditions and lock or release escrow on-chain",
    prompt:
      "When a settlement request arrives via HTTP, verify conditions via the settlement API and lock or release escrow funds on-chain based on the result",
  },
  {
    id: 10,
    title: "Dividend Distribution",
    category: "Finance",
    description: "Batch on-chain payouts from shareholder registry",
    prompt:
      "On the first of each month, fetch the shareholder registry, calculate pro-rata dividend amounts, and execute batch token transfers on-chain to all holders",
  },
]

export function TemplateGrid() {
  const setPrompt = useWorkflowStore((s) => s.setPrompt)

  return (
    <section className="animate-fade-up" style={{ animationDelay: "100ms" }}>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Or start from a template
      </h2>
      <div className="gradient-mask-r">
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide snap-x snap-mandatory">
          {TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => setPrompt(template.prompt)}
              className="group relative min-w-[200px] max-w-[220px] flex-shrink-0 snap-start rounded-xl border border-border bg-card p-3 text-left transition-all hover:border-primary/50 hover:shadow-md"
            >
              <span className="absolute right-2.5 top-2.5 font-mono text-[10px] text-muted-foreground/40">
                {String(template.id).padStart(2, "0")}
              </span>

              <span
                className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-medium ${getCategoryVariant(template.category)}`}
              >
                {template.category}
              </span>
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
