// ─────────────────────────────────────────────
// Centralized design tokens — single source of truth
// ─────────────────────────────────────────────

/**
 * Category badge variants with light+dark mode support.
 * Keys are canonical category slugs.
 */
export const CATEGORY_VARIANTS: Record<string, string> = {
  DeFi: "bg-green-900/60 text-green-300 dark:bg-green-900/60 dark:text-green-300",
  Finance: "bg-blue-900/60 text-blue-300 dark:bg-blue-900/60 dark:text-blue-300",
  Security: "bg-red-900/60 text-red-300 dark:bg-red-900/60 dark:text-red-300",
  Analytics: "bg-purple-900/60 text-purple-300 dark:bg-purple-900/60 dark:text-purple-300",
  Governance: "bg-yellow-900/60 text-yellow-300 dark:bg-yellow-900/60 dark:text-yellow-300",
  Infrastructure: "bg-gray-800/60 text-gray-300 dark:bg-gray-800/60 dark:text-gray-300",
  NFT: "bg-pink-900/60 text-pink-300 dark:bg-pink-900/60 dark:text-pink-300",
  Utility: "bg-orange-900/60 text-orange-300 dark:bg-orange-900/60 dark:text-orange-300",
}

/**
 * Maps all known category slugs (including legacy marketplace slugs)
 * to display labels.
 */
export const CATEGORY_LABELS: Record<string, string> = {
  // Canonical
  DeFi: "DeFi",
  Finance: "Finance",
  Security: "Security",
  Analytics: "Analytics",
  Governance: "Governance",
  Infrastructure: "Infrastructure",
  NFT: "NFT",
  Utility: "Utility",
  // Legacy marketplace slugs
  "core-defi": "DeFi",
  institutional: "Finance",
  "risk-compliance": "Security",
  "ai-powered": "Analytics",
}

/**
 * Maps legacy marketplace category slugs to canonical names
 * so CATEGORY_VARIANTS lookups work.
 */
const CATEGORY_ALIAS: Record<string, string> = {
  "core-defi": "DeFi",
  institutional: "Finance",
  "risk-compliance": "Security",
  "ai-powered": "Analytics",
}

const FALLBACK_VARIANT = "bg-muted text-muted-foreground"

/** Returns Tailwind classes for a category badge. */
export function getCategoryVariant(category: string): string {
  const canonical = CATEGORY_ALIAS[category] ?? category
  return CATEGORY_VARIANTS[canonical] ?? FALLBACK_VARIANT
}

/** Returns a display label for a category slug. */
export function getCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? CATEGORY_LABELS[CATEGORY_ALIAS[category] ?? ""] ?? category
}

/** Chain dot colors — uses Tailwind -500 shades per design guide. */
export const CHAIN_COLORS: Record<string, string> = {
  ethereum: "bg-purple-500",
  "base-sepolia": "bg-blue-500",
  base: "bg-blue-500",
  arbitrum: "bg-sky-500",
  optimism: "bg-red-500",
}

/** Filter dropdown options for categories. */
export const CATEGORIES = [
  { value: "core-defi", label: "DeFi" },
  { value: "institutional", label: "Finance" },
  { value: "risk-compliance", label: "Security" },
  { value: "ai-powered", label: "Analytics" },
  { value: "governance", label: "Governance" },
  { value: "infrastructure", label: "Infrastructure" },
  { value: "nft", label: "NFT" },
  { value: "utility", label: "Utility" },
] as const

/** Filter dropdown options for chains. */
export const CHAINS = [
  { value: "base-sepolia", label: "Base Sepolia" },
  { value: "base", label: "Base" },
  { value: "ethereum", label: "Ethereum" },
  { value: "arbitrum", label: "Arbitrum" },
  { value: "optimism", label: "Optimism" },
] as const
