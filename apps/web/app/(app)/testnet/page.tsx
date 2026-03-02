import { TestnetDashboard } from "@/components/testnet/TestnetDashboard"

export const metadata = {
  title: "TestNet — Ciel",
  description: "Manage Tenderly Virtual TestNets for CRE workflow testing",
}

export default function TestNetPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <header className="mb-8 animate-fade-up">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Virtual TestNet
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Fork real mainnet state, deploy contracts, and test CRE workflows with
          unlimited faucets and a shareable explorer link.
        </p>
      </header>

      <div className="animate-fade-up" style={{ animationDelay: "50ms" }}>
        <TestnetDashboard />
      </div>
    </div>
  )
}
