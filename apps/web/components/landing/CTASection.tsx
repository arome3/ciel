import Link from "next/link"
import { Button } from "@/components/ui/button"

export function CTASection() {
  return (
    <section className="px-6 py-32 sm:py-40">
      <div className="mx-auto max-w-4xl text-center">
        <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl md:text-5xl">
          Built for consensus.{" "}
          <span className="text-muted-foreground">Ready for production.</span>
        </h2>
        <p className="mx-auto mt-6 max-w-xl text-muted-foreground">
          No setup required. Describe your automation, and Ciel handles the rest —
          from code generation to on-chain deployment on Chainlink DON nodes.
        </p>
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
        <p className="mt-8 text-sm text-muted-foreground/50">
          Or from your terminal:{" "}
          <code className="rounded bg-card px-2 py-1 font-mono text-xs text-primary/70">
            npx @ciel/cli generate &quot;your prompt&quot;
          </code>
        </p>
      </div>
    </section>
  )
}
