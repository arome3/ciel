const partners = [
  "Chainlink",
  "Base",
  "Ethereum",
  "x402",
  "CRE",
]

export function LogoBar() {
  return (
    <section className="border-y border-border/20 px-6 py-12">
      <div className="mx-auto max-w-5xl">
        <p className="mb-6 text-center text-[11px] uppercase tracking-wider text-muted-foreground">
          Trusted Infrastructure
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-4">
          {partners.map((name) => (
            <span
              key={name}
              className="text-sm font-medium tracking-wide text-foreground/40 select-none"
            >
              {name}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}
