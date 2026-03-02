import Link from "next/link"

const columns = [
  {
    title: "Product",
    links: [
      { label: "Builder", href: "/build" },
      { label: "Marketplace", href: "/marketplace" },
      { label: "Pipelines", href: "/pipelines" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Documentation", href: "https://docs.chain.link/cre", external: true },
      { label: "CRE SDK", href: "https://github.com/smartcontractkit/cre-sdk", external: true },
      { label: "Templates", href: "/build" },
    ],
  },
  {
    title: "Community",
    links: [
      { label: "GitHub", href: "https://github.com", external: true },
      { label: "Discord", href: "https://discord.gg/chainlink", external: true },
      { label: "Twitter", href: "https://twitter.com/chainlink", external: true },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", href: "#" },
      { label: "Terms", href: "#" },
    ],
  },
]

export function Footer() {
  return (
    <footer className="border-t border-border/30 px-6 py-16">
      <div className="mx-auto max-w-6xl">
        {/* Link grid */}
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {columns.map((col) => (
            <div key={col.title}>
              <h4 className="text-xs uppercase tracking-wider font-medium text-muted-foreground mb-4">
                {col.title}
              </h4>
              <ul className="space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.label}>
                    {link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom row */}
        <div className="mt-12 flex flex-col items-center gap-4 border-t border-border/20 pt-8 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm font-bold tracking-tight text-foreground">
              Ciel
            </Link>
            <span className="text-xs text-muted-foreground/50">·</span>
            <span className="text-xs text-muted-foreground/50">
              Built on Chainlink CRE
            </span>
          </div>
          <p className="text-xs text-muted-foreground/40">
            &copy; {new Date().getFullYear()} Ciel. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}
