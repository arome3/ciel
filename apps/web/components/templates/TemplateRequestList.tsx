"use client"

import { useEffect, useState, useCallback } from "react"
import { useAccount } from "wagmi"
import { ChevronUp, MessageSquare } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { api, type TemplateRequestItem } from "@/lib/api"
import { toast } from "sonner"

function relativeTime(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  return `${weeks}w ago`
}

interface TemplateRequestListProps {
  refreshKey?: number
}

export function TemplateRequestList({ refreshKey }: TemplateRequestListProps) {
  const { address } = useAccount()
  const [requests, setRequests] = useState<TemplateRequestItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [sort, setSort] = useState<"votes" | "newest">("votes")
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const limit = 10

  const fetchRequests = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await api.listTemplateRequests({ page, limit, sort })
      setRequests(res.requests)
      setTotal(res.total)
    } catch {
      // non-fatal
    } finally {
      setIsLoading(false)
    }
  }, [page, sort])

  useEffect(() => {
    fetchRequests()
  }, [fetchRequests, refreshKey])

  const handleVote = async (requestId: string) => {
    if (!address) {
      toast.error("Connect your wallet to vote")
      return
    }
    try {
      const result = await api.voteTemplateRequest(requestId, address)
      // Optimistic update
      setRequests((prev) =>
        prev.map((r) =>
          r.id === requestId
            ? { ...r, voteCount: r.voteCount + (result.voted ? 1 : -1) }
            : r,
        ),
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to vote")
    }
  }

  const hasMore = page * limit < total

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Community Requests</h3>
        <Select value={sort} onValueChange={(v) => { setSort(v as "votes" | "newest"); setPage(1) }}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="votes">Most Voted</SelectItem>
            <SelectItem value="newest">Newest</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      ) : requests.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 px-6 py-10 text-center">
          <MessageSquare className="mb-3 h-6 w-6 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">No requests yet</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Be the first to request a template</p>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border">
          {requests.map((req) => (
            <div key={req.id} className="flex items-start gap-3 p-3">
              <button
                type="button"
                onClick={() => handleVote(req.id)}
                className="flex flex-col items-center gap-0.5 rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
              >
                <ChevronUp className="h-4 w-4" />
                <span className="text-xs font-semibold tabular-nums">{req.voteCount}</span>
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground">{req.description}</p>
                <div className="mt-1 flex items-center gap-2">
                  {req.category && (
                    <Badge variant="outline" className="text-[10px]">{req.category}</Badge>
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    {relativeTime(req.createdAt)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {(page > 1 || hasMore) && (
        <div className="mt-4 flex justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasMore}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  )
}
