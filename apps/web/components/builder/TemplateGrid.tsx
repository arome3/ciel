"use client"

import { useBuilderStore } from "@/lib/store"

const CATEGORY_VARIANTS: Record<string, string> = {
  DeFi: "bg-green-900/60 text-green-300",
  Finance: "bg-blue-900/60 text-blue-300",
  Security: "bg-red-900/60 text-red-300",
  Analytics: "bg-purple-900/60 text-purple-300",
  Governance: "bg-yellow-900/60 text-yellow-300",
  Infrastructure: "bg-gray-800/60 text-gray-300",
  NFT: "bg-pink-900/60 text-pink-300",
  Utility: "bg-orange-900/60 text-orange-300",
}

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
    title: "Price Monitor",
    category: "DeFi",
    description: "Track asset prices and trigger alerts on thresholds",
    prompt:
      "Monitor the ETH/USD price feed every 5 minutes and send an alert when the price drops below $2000 or rises above $4000",
  },
  {
    id: 2,
    title: "Weather Oracle",
    category: "Utility",
    description: "Fetch weather data and report on-chain",
    prompt:
      "Fetch the current weather for New York City every hour and report the temperature and conditions on-chain",
  },
  {
    id: 3,
    title: "Flight Tracker",
    category: "Utility",
    description: "Monitor flight status and trigger actions on delays",
    prompt:
      "Track flight AA100 status and send an alert if the flight is delayed by more than 30 minutes",
  },
  {
    id: 4,
    title: "Reserve Proof",
    category: "Finance",
    description: "Verify asset reserves and report compliance data",
    prompt:
      "Check the USDC reserve balance every hour and report proof of reserves data on-chain for compliance verification",
  },
  {
    id: 5,
    title: "NAV Calculator",
    category: "Finance",
    description: "Calculate net asset value for tokenized funds",
    prompt:
      "Calculate the NAV for a tokenized fund by fetching the latest prices of ETH, BTC, and LINK, then report the weighted portfolio value on-chain",
  },
  {
    id: 6,
    title: "Compliance Check",
    category: "Security",
    description: "Run KYC/AML checks and gate transactions",
    prompt:
      "Before processing a transfer, run a compliance check on the sender address and block the transaction if the risk score exceeds the threshold",
  },
  {
    id: 7,
    title: "DeFi Rebalancer",
    category: "DeFi",
    description: "Auto-rebalance portfolio based on target allocations",
    prompt:
      "Monitor my portfolio allocation every hour and rebalance by swapping tokens when any asset deviates more than 5% from target weights",
  },
  {
    id: 8,
    title: "Prediction Market",
    category: "Analytics",
    description: "Resolve prediction markets with verified data",
    prompt:
      "Fetch the outcome of the upcoming election from multiple data sources, reach consensus, and resolve the prediction market contract",
  },
  {
    id: 9,
    title: "Multi-AI Agent",
    category: "Analytics",
    description: "Orchestrate multiple AI models for consensus",
    prompt:
      "Query three different AI models about the sentiment of the crypto market, aggregate their responses, and report the consensus sentiment on-chain",
  },
  {
    id: 10,
    title: "Cross-Chain Bridge",
    category: "Infrastructure",
    description: "Monitor and execute cross-chain token transfers",
    prompt:
      "Monitor for deposit events on Ethereum mainnet and execute corresponding mint transactions on Base when deposits are confirmed",
  },
]

export function TemplateGrid() {
  const setPrompt = useBuilderStore((s) => s.setPrompt)

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {TEMPLATES.map((template) => (
        <button
          key={template.id}
          type="button"
          onClick={() => setPrompt(template.prompt)}
          className="group relative rounded-xl border border-border bg-card p-3 text-left transition-all hover:border-primary/50 hover:shadow-md"
        >
          {/* Template number */}
          <span className="absolute right-2.5 top-2.5 font-mono text-[10px] text-muted-foreground/40">
            {String(template.id).padStart(2, "0")}
          </span>

          <span
            className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
              CATEGORY_VARIANTS[template.category] ?? "bg-gray-800/60 text-gray-300"
            }`}
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
  )
}
