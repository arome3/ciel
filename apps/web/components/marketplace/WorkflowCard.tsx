"use client"

import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { useWorkflowStore } from "@/lib/store"
import type { WorkflowListItem } from "@/lib/api"

const CATEGORY_STYLES: Record<string, string> = {
  "core-defi": "bg-green-900/60 text-green-300",
  institutional: "bg-blue-900/60 text-blue-300",
  "risk-compliance": "bg-red-900/60 text-red-300",
  "ai-powered": "bg-purple-900/60 text-purple-300",
}

const CATEGORY_LABELS: Record<string, string> = {
  "core-defi": "Core DeFi",
  institutional: "Institutional",
  "risk-compliance": "Risk & Compliance",
  "ai-powered": "AI-Powered",
}

const CHAIN_COLORS: Record<string, string> = {
  "base-sepolia": "bg-blue-400",
  base: "bg-blue-500",
  ethereum: "bg-indigo-400",
  arbitrum: "bg-sky-400",
  optimism: "bg-red-400",
}

const MAX_TAGS = 4

export function WorkflowCard({ workflow }: { workflow: WorkflowListItem }) {
  const walletAddress = useWorkflowStore((s) => s.walletAddress)
  const isOwner =
    walletAddress !== null &&
    walletAddress.toLowerCase() === workflow.ownerAddress.toLowerCase()

  const successRate =
    workflow.totalExecutions > 0
      ? Math.round(
          (workflow.successfulExecutions / workflow.totalExecutions) * 100,
        )
      : 0

  const price = (workflow.priceUsdc / 1_000_000).toFixed(2)
  const visibleTags = workflow.capabilities.slice(0, MAX_TAGS)
  const overflowCount = workflow.capabilities.length - MAX_TAGS

  return (
    <Link
      href={`/workflow/${workflow.id}`}
      className="group block rounded-xl border border-border bg-card p-5 transition-all hover:border-primary hover:shadow-md"
    >
      {/* Header: category + chain dots */}
      <div className="flex items-center justify-between gap-2">
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            CATEGORY_STYLES[workflow.category] ?? "bg-muted text-muted-foreground"
          }`}
        >
          {CATEGORY_LABELS[workflow.category] ?? workflow.category}
        </span>
        <div className="flex items-center gap-1">
          {workflow.chains.map((chain) => (
            <span
              key={chain}
              title={chain}
              className={`h-2.5 w-2.5 rounded-full ${CHAIN_COLORS[chain] ?? "bg-muted-foreground"}`}
            />
          ))}
        </div>
      </div>

      {/* Title + owner badge */}
      <div className="mt-3 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-foreground transition-colors group-hover:text-primary">
          {workflow.name}
        </h3>
        {isOwner && (
          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            Owner
          </span>
        )}
      </div>

      {/* Description */}
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground line-clamp-2">
        {workflow.description}
      </p>

      {/* Capability tags */}
      {visibleTags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {visibleTags.map((cap) => (
            <Badge key={cap} variant="secondary" className="text-[10px]">
              {cap}
            </Badge>
          ))}
          {overflowCount > 0 && (
            <Badge variant="outline" className="text-[10px]">
              +{overflowCount}
            </Badge>
          )}
        </div>
      )}

      {/* Price */}
      <p className="mt-3 font-mono text-sm font-semibold text-foreground">
        ${price} <span className="text-xs font-medium text-muted-foreground">USDC</span>
      </p>

      {/* Stats footer */}
      <div className="mt-3 flex items-center gap-4 border-t border-border pt-3">
        <span className="text-xs text-muted-foreground">
          {workflow.totalExecutions.toLocaleString()} executions
        </span>
        <span className="text-xs text-muted-foreground">
          {successRate}% success
        </span>
      </div>
    </Link>
  )
}
