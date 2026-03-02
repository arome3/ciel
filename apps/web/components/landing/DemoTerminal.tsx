"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"

interface Demo {
  command: string
  prompt: string
  lines: { prefix: string; color: string; text: string }[]
  hint?: string
}

const demos: Demo[] = [
  {
    command: "ciel generate",
    prompt: "Monitor ETH price, alert if 10% drop",
    lines: [
      { prefix: "Template", color: "text-primary", text: "T1 — Price Monitor (94%)" },
      { prefix: "Validation", color: "text-primary", text: "8/8 checks passed" },
      { prefix: "\u2713", color: "text-chart-1", text: "Workflow abc1d2e3 generated" },
    ],
    hint: "Next: ciel simulate abc1d2e3",
  },
  {
    command: "ciel generate",
    prompt: "Rebalance portfolio when BTC > 60% allocation",
    lines: [
      { prefix: "Template", color: "text-primary", text: "T3 — Portfolio Rebalancer (91%)" },
      { prefix: "Validation", color: "text-primary", text: "8/8 checks passed" },
      { prefix: "\u2713", color: "text-chart-1", text: "Workflow f4e5d6c7 generated" },
    ],
    hint: "Next: ciel simulate f4e5d6c7",
  },
  {
    command: "ciel generate",
    prompt: "Watch my wallet for large transfers, notify me",
    lines: [
      { prefix: "Template", color: "text-primary", text: "T12 — Wallet Monitor (92%)" },
      { prefix: "Validation", color: "text-primary", text: "8/8 checks passed" },
      { prefix: "\u2713", color: "text-chart-1", text: "Workflow 8b9a0c1d generated" },
    ],
    hint: "Next: ciel simulate 8b9a0c1d",
  },
]

export function DemoTerminal() {
  const [selected, setSelected] = useState(0)
  const demo = demos[selected]

  return (
    <section className="bg-card/30 px-6 py-24 sm:py-32">
      <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-2 lg:gap-16">
        {/* Left: heading + prompt selector */}
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Try it yourself
          </h2>
          <p className="mt-4 text-muted-foreground">
            Click a prompt to see the AI engine in action. Every pipeline runs
            in under 10 seconds.
          </p>

          <div className="mt-8 space-y-3">
            {demos.map((d, i) => (
              <button
                key={i}
                onClick={() => setSelected(i)}
                className={cn(
                  "w-full rounded-lg border px-4 py-3 text-left text-sm transition-all",
                  selected === i
                    ? "border-primary/40 bg-primary/5 text-foreground"
                    : "border-border/30 text-muted-foreground hover:border-border/50 hover:text-foreground"
                )}
              >
                <span className="font-mono text-[11px] text-chart-1 mr-1.5">$</span>
                <span className="font-mono text-[11px] text-primary/60 mr-1">{d.command}</span>
                &quot;{d.prompt}&quot;
              </button>
            ))}
          </div>
        </div>

        {/* Right: terminal output */}
        <div className="rounded-xl border border-border/40 bg-background shadow-xl shadow-black/10 overflow-hidden">
          {/* Chrome bar */}
          <div className="flex items-center gap-2 border-b border-border/20 px-4 py-2.5">
            <div className="size-2.5 rounded-full bg-muted-foreground/20" />
            <div className="size-2.5 rounded-full bg-muted-foreground/20" />
            <div className="size-2.5 rounded-full bg-muted-foreground/20" />
            <span className="ml-2 text-[11px] text-muted-foreground/50">terminal</span>
          </div>

          {/* Output */}
          <div className="p-5 font-mono text-xs leading-relaxed sm:text-sm">
            <p className="text-muted-foreground">
              <span className="text-chart-1">$</span>{" "}
              <span className="text-primary/60">{demo.command}</span>{" "}
              <span className="text-foreground/70">&quot;{demo.prompt}&quot;</span>
            </p>
            <div className="mt-3 space-y-1.5">
              {demo.lines.map((line, i) => (
                <p key={i} className={i === demo.lines.length - 1 ? line.color : "text-muted-foreground"}>
                  <span className={line.color}>{line.prefix}</span>{" "}
                  {line.text}
                </p>
              ))}
            </div>
            {demo.hint && (
              <p className="mt-2 text-muted-foreground/40">
                {"\u2192"} {demo.hint}
              </p>
            )}
            <p className="mt-3">
              <span className="text-chart-1">$</span>
              <span className="cursor-blink" />
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
