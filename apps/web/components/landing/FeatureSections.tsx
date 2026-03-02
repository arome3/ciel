import { Badge } from "@/components/ui/badge"

/* ──────────────────────────────────────────────
   Shared window chrome for product mockups
   ────────────────────────────────────────────── */
function WindowChrome({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/40 bg-card shadow-xl shadow-black/10 overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border/20 px-4 py-2.5 bg-card">
        <div className="size-2.5 rounded-full bg-muted-foreground/20" />
        <div className="size-2.5 rounded-full bg-muted-foreground/20" />
        <div className="size-2.5 rounded-full bg-muted-foreground/20" />
        <span className="ml-2 text-[11px] text-muted-foreground/50">{title}</span>
      </div>
      {children}
    </div>
  )
}

/* ──────────────────────────────────────────────
   Feature 1: Describe, don't code
   ────────────────────────────────────────────── */
function IntentMockup() {
  return (
    <WindowChrome title="intent-parser">
      <div className="p-5 space-y-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/40 mb-2">
            Input
          </div>
          <p className="text-sm text-foreground/70">
            &quot;Every hour, check if SOL drops 15% and swap to USDC&quot;
          </p>
        </div>
        <div className="h-px bg-border/20" />
        <div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/40 mb-2">
            Parsed Intent
          </div>
          <div className="space-y-2 text-xs font-mono">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground/40">trigger</span>
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">cron</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground/40">sources</span>
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">price-feed</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground/40">actions</span>
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">dexSwap</span>
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">alert</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground/40">confidence</span>
              <span className="text-chart-1 font-medium">0.94</span>
            </div>
          </div>
        </div>
      </div>
    </WindowChrome>
  )
}

/* ──────────────────────────────────────────────
   Feature 2: 22 battle-tested templates
   ────────────────────────────────────────────── */
const templateGrid = [
  { id: "T1", name: "Price Monitor", category: "DeFi" },
  { id: "T3", name: "Portfolio Rebalancer", category: "DeFi" },
  { id: "T12", name: "Wallet Monitor", category: "Security" },
  { id: "T15", name: "CCIP Transfer", category: "Infrastructure" },
  { id: "T17", name: "Stablecoin Burn", category: "Finance" },
  { id: "T22", name: "Dividend Dist.", category: "Finance" },
]

const CATEGORY_COLORS: Record<string, string> = {
  DeFi: "bg-green-900/60 text-green-300",
  Security: "bg-red-900/60 text-red-300",
  Infrastructure: "bg-gray-800/60 text-gray-300",
  Finance: "bg-blue-900/60 text-blue-300",
}

function TemplateMiniGrid() {
  return (
    <WindowChrome title="templates">
      <div className="grid grid-cols-2 gap-px bg-border/10">
        {templateGrid.map((t) => (
          <div key={t.id} className="bg-card p-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-mono text-[10px] text-muted-foreground/40">{t.id}</span>
              <Badge className={`text-[9px] px-1.5 py-0 ${CATEGORY_COLORS[t.category] ?? ""}`}>
                {t.category}
              </Badge>
            </div>
            <p className="text-xs font-medium text-foreground/70">{t.name}</p>
          </div>
        ))}
      </div>
    </WindowChrome>
  )
}

/* ──────────────────────────────────────────────
   Feature 3: Deploy to a marketplace
   ────────────────────────────────────────────── */
function MarketplaceMockup() {
  const items = [
    { name: "ETH Price Alert", price: "0.001", executions: "2.4k", status: "live" },
    { name: "Portfolio Rebalancer", price: "0.005", executions: "891", status: "live" },
    { name: "Wallet Monitor", price: "0.002", executions: "1.1k", status: "live" },
  ]
  return (
    <WindowChrome title="marketplace">
      <div className="divide-y divide-border/10">
        {items.map((item) => (
          <div key={item.name} className="flex items-center justify-between px-5 py-3.5">
            <div>
              <p className="text-sm font-medium text-foreground/80">{item.name}</p>
              <p className="text-[11px] text-muted-foreground/50 mt-0.5">
                {item.executions} executions
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs text-foreground/60">
                {item.price} ETH
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-chart-1/10 px-2 py-0.5 text-[10px] font-medium text-chart-1">
                <span className="inline-block size-1.5 rounded-full bg-chart-1" />
                {item.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </WindowChrome>
  )
}

/* ──────────────────────────────────────────────
   Main export: three alternating feature sections
   ────────────────────────────────────────────── */
export function FeatureSections() {
  return (
    <div id="features">
      {/* Feature 1 — content left, mockup right */}
      <section className="px-6 py-24 sm:py-32">
        <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <span className="font-mono text-xs font-bold text-primary">01</span>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Describe, don&apos;t code
            </h2>
            <p className="mt-4 text-muted-foreground leading-relaxed">
              Write what you want in plain English. The deterministic intent parser
              extracts triggers, data sources, and actions — no hallucination,
              no ambiguity. Stemming, fuzzy matching, and entity extraction
              handle natural language variations automatically.
            </p>
          </div>
          <IntentMockup />
        </div>
      </section>

      {/* Feature 2 — mockup left, content right */}
      <section id="templates" className="px-6 py-24 sm:py-32">
        <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <TemplateMiniGrid />
          <div>
            <span className="font-mono text-xs font-bold text-primary">02</span>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              22 battle-tested templates
            </h2>
            <p className="mt-4 text-muted-foreground leading-relaxed">
              Every template is a production-ready CRE workflow covering DeFi,
              finance, security, and infrastructure. IDF-weighted keyword scoring
              combined with semantic embeddings picks the highest-confidence
              match for your use case.
            </p>
          </div>
        </div>
      </section>

      {/* Feature 3 — content left, mockup right */}
      <section className="px-6 py-24 sm:py-32">
        <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <span className="font-mono text-xs font-bold text-primary">03</span>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Deploy to a marketplace
            </h2>
            <p className="mt-4 text-muted-foreground leading-relaxed">
              Publish workflows on-chain with one click. Set your price, define
              the schema, and earn whenever an AI agent discovers and executes
              your workflow via x402 micropayments. A self-reinforcing economy
              where builders earn and agents compose.
            </p>
          </div>
          <MarketplaceMockup />
        </div>
      </section>
    </div>
  )
}
