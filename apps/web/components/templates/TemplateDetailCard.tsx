"use client"

import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { getCategoryVariant } from "@/lib/design-tokens"
import type { TemplateCatalogItem } from "@/lib/api"

interface TemplateDetailCardProps {
  template: TemplateCatalogItem
  featured?: boolean
}

export function TemplateDetailCard({ template, featured }: TemplateDetailCardProps) {
  const router = useRouter()

  const handleUse = () => {
    // Navigate to build page with the template description pre-filled
    const params = new URLSearchParams({ prompt: template.description, hint: String(template.id) })
    router.push(`/build?${params}`)
  }

  return (
    <Card className={`flex flex-col gap-3 p-4 transition-all hover:border-primary/50 ${
      featured ? "border-primary/40 bg-gradient-to-br from-card to-primary/[0.04]" : ""
    }`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-medium ${getCategoryVariant(template.categoryLabel)}`}>
            {template.categoryLabel}
          </span>
          {featured && (
            <Badge className="bg-primary/15 text-primary text-[10px]">Flagship</Badge>
          )}
        </div>
        <Badge variant="outline" className="text-[10px]">
          {template.triggerLabel}
        </Badge>
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{template.name}</p>
        <p className={`mt-1 text-xs leading-relaxed text-muted-foreground ${featured ? "" : "line-clamp-2"}`}>
          {template.description}
        </p>
      </div>

      {template.capabilities.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {template.capabilities.slice(0, 4).map((cap) => (
            <span key={cap} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {cap}
            </span>
          ))}
          {template.capabilities.length > 4 && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              +{template.capabilities.length - 4}
            </span>
          )}
        </div>
      )}

      <Button size="sm" className="w-full mt-auto" onClick={handleUse}>
        Use Template
      </Button>
    </Card>
  )
}
