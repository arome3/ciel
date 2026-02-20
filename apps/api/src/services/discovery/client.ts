import type { Hex } from "viem"
import type { DiscoveredWorkflow } from "../../types/api"
import { AppError, ErrorCodes } from "../../types/errors"
import {
  getAllWorkflowIds,
  getWorkflowFromRegistry,
  searchWorkflowsByCategory,
  searchWorkflowsByChain,
} from "../blockchain/registry"
import { withRetry } from "../blockchain/retry"
import { LRUCache } from "../../lib/lru-cache"
import { config } from "../../config"
import { createLogger } from "../../lib/logger"

const log = createLogger("Discovery")

const discoveryCache = new LRUCache<DiscoveredWorkflow[]>(30, 2 * 60 * 1000)

// ── Chain name → CCIP selector mapping ──
const CHAIN_SELECTORS: Record<string, bigint> = {
  "base-sepolia": 10344971235874465080n,
}

// ── Reverse mapping for display ──
const SELECTOR_TO_CHAIN: Record<string, string> = {
  "10344971235874465080": "base-sepolia",
}

interface DiscoveryQuery {
  category?: string
  chain?: string
  capability?: string
}

// ── Path A: On-chain registry ──

async function discoverViaRegistry(
  query: DiscoveryQuery,
): Promise<DiscoveredWorkflow[]> {
  let ids: readonly Hex[]

  if (query.category) {
    const result = await searchWorkflowsByCategory(query.category, 0n, 50n)
    ids = result.data
  } else if (query.chain) {
    if (!CHAIN_SELECTORS[query.chain]) return []
    const result = await searchWorkflowsByChain(
      CHAIN_SELECTORS[query.chain],
      0n,
      50n,
    )
    ids = result.data
  } else {
    const result = await getAllWorkflowIds(0n, 50n)
    ids = result.data
  }

  // Filter out zero-value IDs (empty slots)
  const validIds = ids.filter(
    (id) => id !== "0x0000000000000000000000000000000000000000000000000000000000000000",
  )

  const results = await Promise.all(
    validIds.map(async (id) => {
      try {
        const w = await getWorkflowFromRegistry(id)
        return normalizeRegistryWorkflow(id, w)
      } catch (err) {
        log.warn(`Failed to fetch registry workflow ${id}`, err)
        return null
      }
    }),
  )

  let workflows = results.filter(
    (w): w is DiscoveredWorkflow => w !== null,
  )

  // Client-side capability filter
  if (query.capability) {
    workflows = workflows.filter((w) =>
      w.capabilities.includes(query.capability!),
    )
  }

  return workflows
}

function normalizeRegistryWorkflow(
  id: Hex,
  w: {
    creator: string
    name: string
    description: string
    category: string
    supportedChains: readonly bigint[]
    capabilities: readonly string[]
    x402Endpoint: string
    pricePerExecution: bigint
    totalExecutions: bigint
    successfulExecutions: bigint
    createdAt: bigint
    active: boolean
  },
): DiscoveredWorkflow | null {
  if (!w.active) return null

  return {
    workflowId: id,
    name: w.name,
    description: w.description,
    category: w.category,
    chains: w.supportedChains.map(
      (s) => SELECTOR_TO_CHAIN[s.toString()] ?? s.toString(),
    ),
    capabilities: [...w.capabilities],
    priceUsdc: Number(w.pricePerExecution),
    x402Endpoint: w.x402Endpoint,
    totalExecutions: Number(w.totalExecutions),
    successfulExecutions: Number(w.successfulExecutions),
    source: "registry",
  }
}

// ── Path B: Bazaar directory ──

interface BazaarResource {
  resource: string
  type: string
  x402Version: number
  accepts: unknown[]
  lastUpdated: string
  metadata?: Record<string, unknown>
}

interface BazaarResponse {
  x402Version: number
  items: BazaarResource[]
  pagination: { limit: number; offset: number; total: number }
}

async function discoverViaBazaar(
  query: DiscoveryQuery,
): Promise<DiscoveredWorkflow[]> {
  const keyword = query.category ?? query.capability ?? ""
  const url = new URL(
    "/discovery/resources",
    config.X402_FACILITATOR_URL,
  )
  if (keyword) url.searchParams.set("q", keyword)

  const resp = await withRetry(
    () => fetch(url.toString(), { signal: AbortSignal.timeout(10_000) }),
    { maxRetries: 2, baseDelay: 500 },
  )

  if (!resp.ok) {
    throw new Error(`Bazaar responded ${resp.status}: ${resp.statusText}`)
  }

  const data = (await resp.json()) as Record<string, unknown>
  const items = Array.isArray(data?.items) ? (data.items as BazaarResource[]) : []
  return items.map(normalizeBazaarResource).filter(
    (w): w is DiscoveredWorkflow => w !== null,
  )
}

const WORKFLOW_UUID_RE = /\/workflows\/([0-9a-f-]{36})\/execute/i

function normalizeBazaarResource(
  r: BazaarResource,
): DiscoveredWorkflow | null {
  const match = r.resource.match(WORKFLOW_UUID_RE)
  if (!match) return null

  const metadata = r.metadata ?? {}

  return {
    workflowId: match[1],
    name: (metadata.name as string) ?? "Unknown",
    description: (metadata.description as string) ?? "",
    category: (metadata.category as string) ?? "unknown",
    chains: Array.isArray(metadata.chains)
      ? (metadata.chains as string[])
      : [],
    capabilities: Array.isArray(metadata.capabilities)
      ? (metadata.capabilities as string[])
      : [],
    priceUsdc: typeof metadata.priceUsdc === "number"
      ? metadata.priceUsdc
      : 0,
    x402Endpoint: r.resource,
    totalExecutions: 0,
    successfulExecutions: 0,
    source: "bazaar",
    inputSchema: metadata.inputSchema,
    outputSchema: metadata.outputSchema,
  }
}

// ── Unified discovery entrypoint ──

export async function discoverWorkflows(
  query: DiscoveryQuery,
): Promise<DiscoveredWorkflow[]> {
  const cacheKey = JSON.stringify(query)
  const cached = discoveryCache.get(cacheKey)
  if (cached) {
    log.debug("Discovery cache hit", { query })
    return cached
  }

  const [registryResult, bazaarResult] = await Promise.allSettled([
    discoverViaRegistry(query),
    discoverViaBazaar(query),
  ])

  if (
    registryResult.status === "rejected" &&
    bazaarResult.status === "rejected"
  ) {
    log.error("Both discovery sources failed", {
      registry: registryResult.reason,
      bazaar: bazaarResult.reason,
    })
    throw new AppError(
      ErrorCodes.DISCOVERY_FAILED,
      502,
      "Both discovery sources unavailable",
      {
        registry: registryResult.reason instanceof Error
          ? registryResult.reason.message
          : String(registryResult.reason),
        bazaar: bazaarResult.reason instanceof Error
          ? bazaarResult.reason.message
          : String(bazaarResult.reason),
      },
    )
  }

  if (registryResult.status === "rejected") {
    log.warn("Registry discovery failed, using Bazaar only", registryResult.reason)
  }
  if (bazaarResult.status === "rejected") {
    log.warn("Bazaar discovery failed, using registry only", bazaarResult.reason)
  }

  const registryWorkflows =
    registryResult.status === "fulfilled" ? registryResult.value : []
  const bazaarWorkflows =
    bazaarResult.status === "fulfilled" ? bazaarResult.value : []

  // ── Deduplicate by x402Endpoint — prefer registry (has execution stats) ──
  const seen = new Map<string, DiscoveredWorkflow>()

  for (const w of registryWorkflows) {
    seen.set(w.x402Endpoint, w)
  }
  for (const w of bazaarWorkflows) {
    if (!seen.has(w.x402Endpoint)) {
      seen.set(w.x402Endpoint, w)
    }
  }

  // Sort by totalExecutions descending
  const merged = [...seen.values()]
  merged.sort((a, b) => b.totalExecutions - a.totalExecutions)

  discoveryCache.set(cacheKey, merged)
  return merged
}

// ── Test introspection exports ──
export const _discoverViaRegistry = discoverViaRegistry
export const _discoverViaBazaar = discoverViaBazaar
export const _CHAIN_SELECTORS = CHAIN_SELECTORS
export const _discoveryCache = discoveryCache
