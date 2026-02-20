import { SearchBar } from "@/components/marketplace/SearchBar"
import { WorkflowGrid } from "@/components/marketplace/WorkflowGrid"
import { AgentActivityFeed } from "@/components/marketplace/AgentActivityFeed"

export const metadata = {
  title: "Marketplace — Ciel",
  description: "Browse and execute AI-powered CRE workflows",
}

export default function MarketplacePage() {
  return (
    <div className="container mx-auto max-w-7xl px-4 py-8">
      {/* Page header */}
      <header className="mb-8 animate-fade-up">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Marketplace
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Browse, discover, and execute published CRE workflows
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Main content */}
        <div
          className="space-y-6 lg:col-span-2 animate-fade-up"
          style={{ animationDelay: "50ms" }}
        >
          <SearchBar />
          <WorkflowGrid />
        </div>

        {/* Sidebar */}
        <div
          className="animate-fade-up lg:col-span-1"
          style={{ animationDelay: "100ms" }}
        >
          <div className="sticky top-8">
            <AgentActivityFeed />
          </div>
        </div>
      </div>
    </div>
  )
}
