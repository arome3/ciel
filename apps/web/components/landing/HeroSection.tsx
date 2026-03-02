import Link from "next/link"
import { Button } from "@/components/ui/button"

export function HeroSection() {
  return (
    <section className="relative flex min-h-screen items-center justify-center px-6 pt-20 pb-16">
      <div className="mx-auto max-w-5xl text-center">
        {/* Status badge */}
        <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-border/40 bg-card/60 px-4 py-1.5">
          <span className="live-dot inline-block size-2 rounded-full bg-chart-1" />
          <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
            Live on Base Sepolia
          </span>
        </div>

        {/* Massive heading — two-tone */}
        <h1 className="text-4xl font-bold tracking-[-0.03em] leading-[1.05] text-foreground sm:text-5xl md:text-6xl lg:text-[72px] xl:text-[80px]">
          Build blockchain automations{" "}
          <span className="text-muted-foreground">with natural language</span>
        </h1>

        {/* Subtext */}
        <p className="mx-auto mt-6 max-w-2xl text-base text-muted-foreground sm:text-lg">
          Describe what you want automated on-chain. Ciel&apos;s AI engine parses
          your intent, generates validated CRE workflows, and deploys them to a
          decentralized marketplace.
        </p>

        {/* Pill CTAs */}
        <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <Button asChild size="lg" className="rounded-full px-8 h-12 text-sm">
            <Link href="/build">Start Building</Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="lg"
            className="rounded-full px-8 h-12 text-sm"
          >
            <Link
              href="https://docs.chain.link/cre"
              target="_blank"
              rel="noopener noreferrer"
            >
              Read Documentation
            </Link>
          </Button>
        </div>

        {/* Product preview mockup */}
        <div className="mx-auto mt-16 max-w-4xl w-full rounded-xl border border-border/40 bg-card shadow-2xl shadow-black/20 overflow-hidden">
          {/* Window chrome */}
          <div className="flex items-center gap-2 border-b border-border/30 px-4 py-3 bg-card">
            <div className="size-3 rounded-full bg-muted-foreground/20" />
            <div className="size-3 rounded-full bg-muted-foreground/20" />
            <div className="size-3 rounded-full bg-muted-foreground/20" />
            <span className="ml-3 text-xs text-muted-foreground/60">
              ciel — workflow builder
            </span>
          </div>

          {/* Two-column: prompt + code */}
          <div className="grid md:grid-cols-2">
            {/* Left: prompt input */}
            <div className="border-b border-border/20 p-5 md:border-b-0 md:border-r">
              <div className="mb-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">
                Prompt
              </div>
              <p className="text-sm leading-relaxed text-foreground/80">
                &quot;Monitor ETH price every 5 minutes. If it drops more than 10%
                in an hour, send me an alert and log the event on-chain.&quot;
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
                  price-feed
                </span>
                <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
                  alert
                </span>
                <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
                  cron
                </span>
                <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
                  evmWrite
                </span>
              </div>
            </div>

            {/* Right: code output */}
            <div className="p-5">
              <div className="mb-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">
                Generated Output
              </div>
              <pre className="text-xs leading-relaxed font-mono">
                <code>
                  <span className="text-muted-foreground/50">{"// "}</span>
                  <span className="text-muted-foreground/70">Template #1 — Price Monitor</span>
                  {"\n"}
                  <span className="text-chart-3">{"import"}</span>
                  <span className="text-foreground/70">{" { cre }"}</span>
                  <span className="text-chart-3">{" from"}</span>
                  <span className="text-chart-1">{' "@chainlink/cre-sdk"'}</span>
                  {"\n\n"}
                  <span className="text-chart-3">{"const"}</span>
                  <span className="text-foreground/70">{" config"}</span>
                  <span className="text-muted-foreground/50">{" = {"}</span>
                  {"\n"}
                  <span className="text-foreground/70">{"  schedule: "}</span>
                  <span className="text-chart-1">{'"*/5 * * * *"'}</span>
                  <span className="text-muted-foreground/50">,</span>
                  {"\n"}
                  <span className="text-foreground/70">{"  threshold: "}</span>
                  <span className="text-chart-4">{"10"}</span>
                  <span className="text-muted-foreground/50">,</span>
                  {"\n"}
                  <span className="text-muted-foreground/50">{"}"}</span>
                </code>
              </pre>
            </div>
          </div>

          {/* Status bar */}
          <div className="flex items-center justify-between border-t border-border/20 px-4 py-2.5 bg-card/80">
            <div className="flex items-center gap-3 text-[11px]">
              <span className="text-muted-foreground/50">intent parsed</span>
              <span className="text-muted-foreground/30">·</span>
              <span className="text-muted-foreground/50">template matched</span>
              <span className="text-muted-foreground/30">·</span>
              <span className="text-muted-foreground/50">code generated</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="inline-block size-1.5 rounded-full bg-chart-1" />
              <span className="text-chart-1 font-medium">8/8 checks passed</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
