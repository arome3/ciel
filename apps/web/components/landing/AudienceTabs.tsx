"use client"

import Link from "next/link"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Sparkles, Bot, Building2, Zap, Globe, Shield, DollarSign, Workflow, Lock } from "lucide-react"

interface AudiencePoint {
  icon: React.ElementType
  text: string
}

interface AudienceTab {
  value: string
  label: string
  heading: string
  description: string
  points: AudiencePoint[]
  ctaLabel: string
  ctaHref: string
}

const tabs: AudienceTab[] = [
  {
    value: "creators",
    label: "Creators",
    heading: "Build workflows. Earn revenue.",
    description:
      "Describe automations in plain English and deploy them to a decentralized marketplace. Every execution generates revenue via x402 micropayments.",
    points: [
      { icon: Sparkles, text: "AI-powered code generation from natural language" },
      { icon: DollarSign, text: "Earn per-execution fees from agent consumers" },
      { icon: Shield, text: "8-point validation ensures production-ready output" },
    ],
    ctaLabel: "Start building",
    ctaHref: "/build",
  },
  {
    value: "agents",
    label: "AI Agents",
    heading: "Discover. Compose. Execute.",
    description:
      "Autonomous AI agents browse the marketplace, evaluate schemas for compatibility, and compose multi-step pipelines — paying per execution with no human in the loop.",
    points: [
      { icon: Bot, text: "Autonomous workflow discovery via schema matching" },
      { icon: Workflow, text: "Pipeline composition with DAG execution engine" },
      { icon: Zap, text: "Pay-per-use via x402 protocol — no subscriptions" },
    ],
    ctaLabel: "Explore marketplace",
    ctaHref: "/marketplace",
  },
  {
    value: "enterprises",
    label: "Enterprises",
    heading: "Institutional-grade automation.",
    description:
      "Run automations on Chainlink's decentralized oracle network with consensus-safe execution, compliance guardrails, and full audit trails.",
    points: [
      { icon: Building2, text: "Decentralized execution on Chainlink DON nodes" },
      { icon: Lock, text: "Consensus-safe — no non-determinism, no single points of failure" },
      { icon: Globe, text: "Cross-chain via CCIP with settlement reconciliation" },
    ],
    ctaLabel: "Read documentation",
    ctaHref: "https://docs.chain.link/cre",
  },
]

export function AudienceTabs() {
  return (
    <section className="px-6 py-24 sm:py-32">
      <div className="mx-auto max-w-6xl">
        <Tabs defaultValue="creators">
          <TabsList variant="line" className="mb-12 border-b border-border/20 pb-px">
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="text-xs uppercase tracking-[0.15em] px-4 pb-3"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {tabs.map((tab) => (
            <TabsContent key={tab.value} value={tab.value}>
              <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
                <div>
                  <h3 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                    {tab.heading}
                  </h3>
                  <p className="mt-4 text-muted-foreground leading-relaxed">
                    {tab.description}
                  </p>
                  <Link
                    href={tab.ctaHref}
                    className="mt-6 inline-flex text-sm font-medium text-primary transition-colors hover:text-primary/80"
                    {...(tab.ctaHref.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  >
                    {tab.ctaLabel} &rarr;
                  </Link>
                </div>

                <div className="space-y-5">
                  {tab.points.map((point) => {
                    const Icon = point.icon
                    return (
                      <div key={point.text} className="flex items-start gap-4">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                          <Icon className="size-4 text-primary" />
                        </div>
                        <p className="text-sm text-muted-foreground leading-relaxed pt-1.5">
                          {point.text}
                        </p>
                      </div>
                    )
                  })}
                </div>
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </section>
  )
}
