"use client"

import { useEffect, useRef, useCallback } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useWorkflowStore } from "@/lib/store"

const CATEGORIES = [
  { value: "core-defi", label: "Core DeFi" },
  { value: "institutional", label: "Institutional" },
  { value: "risk-compliance", label: "Risk & Compliance" },
  { value: "ai-powered", label: "AI-Powered" },
]

const CHAINS = [
  { value: "base-sepolia", label: "Base Sepolia" },
  { value: "base", label: "Base" },
  { value: "ethereum", label: "Ethereum" },
  { value: "arbitrum", label: "Arbitrum" },
  { value: "optimism", label: "Optimism" },
]

const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "most-executed", label: "Most Executed" },
  { value: "price-asc", label: "Price: Low → High" },
  { value: "price-desc", label: "Price: High → Low" },
]

export function SearchBar() {
  const {
    searchQuery,
    filters,
    setSearchQuery,
    setFilter,
    clearFilters,
    fetchWorkflows,
  } = useWorkflowStore()

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const hasActiveFilters =
    searchQuery !== "" ||
    filters.category !== null ||
    filters.chain !== null ||
    filters.sortBy !== "newest"

  // Debounced search
  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchQuery(value)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        fetchWorkflows()
      }, 300)
    },
    [setSearchQuery, fetchWorkflows],
  )

  // Immediate refetch on filter/sort change
  const handleCategoryChange = useCallback(
    (value: string) => {
      setFilter("category", value === "all" ? null : value)
      fetchWorkflows()
    },
    [setFilter, fetchWorkflows],
  )

  const handleChainChange = useCallback(
    (value: string) => {
      setFilter("chain", value === "all" ? null : value)
      // Chain filter is client-side only — no refetch needed
    },
    [setFilter],
  )

  const handleSortChange = useCallback(
    (value: string) => {
      setFilter("sortBy", value)
      fetchWorkflows()
    },
    [setFilter, fetchWorkflows],
  )

  const handleClear = useCallback(() => {
    clearFilters()
    fetchWorkflows()
  }, [clearFilters, fetchWorkflows])

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <Input
        placeholder="Search workflows..."
        value={searchQuery}
        onChange={(e) => handleSearchChange(e.target.value)}
        className="sm:max-w-xs"
      />

      <Select
        value={filters.category ?? "all"}
        onValueChange={handleCategoryChange}
      >
        <SelectTrigger size="sm">
          <SelectValue placeholder="Category" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Categories</SelectItem>
          {CATEGORIES.map((c) => (
            <SelectItem key={c.value} value={c.value}>
              {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.chain ?? "all"}
        onValueChange={handleChainChange}
      >
        <SelectTrigger size="sm">
          <SelectValue placeholder="Chain" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Chains</SelectItem>
          {CHAINS.map((c) => (
            <SelectItem key={c.value} value={c.value}>
              {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filters.sortBy} onValueChange={handleSortChange}>
        <SelectTrigger size="sm">
          <SelectValue placeholder="Sort" />
        </SelectTrigger>
        <SelectContent>
          {SORT_OPTIONS.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={handleClear}>
          Clear
        </Button>
      )}
    </div>
  )
}
