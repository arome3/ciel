"use client"

import { useEffect, useState, useMemo, useCallback } from "react"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { api, type TemplateCatalogItem } from "@/lib/api"
import { TemplateDetailCard } from "./TemplateDetailCard"
import { RequestTemplateForm } from "./RequestTemplateForm"
import { TemplateRequestList } from "./TemplateRequestList"

const CATEGORY_FILTERS = ["All", "DeFi", "Finance", "Security", "AI", "Infrastructure"] as const
type CategoryFilter = (typeof CATEGORY_FILTERS)[number]

// Map backend category slugs to display labels
const CATEGORY_LABEL_MAP: Record<string, string> = {
  "core-defi": "DeFi",
  institutional: "Finance",
  "risk-compliance": "Security",
  "ai-powered": "AI",
}

const FEATURED_IDS = [9, 16] // Multi-AI Consensus Oracle, Dual-Trigger

export function TemplateGallery() {
  const [templates, setTemplates] = useState<TemplateCatalogItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [activeFilter, setActiveFilter] = useState<CategoryFilter>("All")
  const [requestRefresh, setRequestRefresh] = useState(0)

  useEffect(() => {
    api
      .listTemplates()
      .then((res) => setTemplates(res.templates))
      .catch(() => {})
      .finally(() => setIsLoading(false))
  }, [])

  const filtered = useMemo(() => {
    let result = templates
    if (activeFilter !== "All") {
      result = result.filter((t) => {
        const label = CATEGORY_LABEL_MAP[t.category] ?? t.categoryLabel
        return label === activeFilter
      })
    }
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q),
      )
    }
    return result
  }, [templates, activeFilter, search])

  const featured = useMemo(
    () => templates.filter((t) => FEATURED_IDS.includes(t.id)),
    [templates],
  )

  const handleRequestSubmitted = useCallback(() => {
    setRequestRefresh((r) => r + 1)
  }, [])

  return (
    <div className="container mx-auto max-w-7xl px-4 py-8">
      <header className="mb-8 animate-fade-up">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Template Gallery</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Explore pre-built workflow templates or request new ones
        </p>
      </header>

      {/* Search + filters */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center animate-fade-up" style={{ animationDelay: "50ms" }}>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search templates..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {CATEGORY_FILTERS.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveFilter(cat)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                activeFilter === cat
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          {/* Featured */}
          {activeFilter === "All" && !search && featured.length > 0 && (
            <section className="mb-8 animate-fade-up" style={{ animationDelay: "75ms" }}>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Featured
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {featured.map((t) => (
                  <TemplateDetailCard key={t.id} template={t} featured />
                ))}
              </div>
            </section>
          )}

          {/* All templates */}
          <section className="mb-10 animate-fade-up" style={{ animationDelay: "100ms" }}>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {activeFilter === "All" ? `All Templates (${filtered.length})` : `${activeFilter} (${filtered.length})`}
            </h2>
            {filtered.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-card/50 px-8 py-12 text-center">
                <p className="text-sm text-muted-foreground">No templates match your search.</p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filtered
                  .filter((t) => !FEATURED_IDS.includes(t.id) || activeFilter !== "All" || search)
                  .map((t) => (
                    <TemplateDetailCard key={t.id} template={t} />
                  ))}
              </div>
            )}
          </section>

          {/* Request section */}
          <section className="space-y-6 animate-fade-up" style={{ animationDelay: "150ms" }}>
            <RequestTemplateForm onSubmitted={handleRequestSubmitted} />
            <TemplateRequestList refreshKey={requestRefresh} />
          </section>
        </>
      )}
    </div>
  )
}
