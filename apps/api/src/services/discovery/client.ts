import type { Hex } from "viem"
import { eq } from "drizzle-orm"
import type { DiscoveredWorkflow } from "../../types/api"
import { AppError, ErrorCodes } from "../../types/errors"
import { db } from "../../db"
import { workflows } from "../../db/schema"
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

// ── Path B: Local DB (published workflows) ──

async function discoverViaLocal(
  query: DiscoveryQuery,
): Promise<DiscoveredWorkflow[]> {
  let rows = db
    .select()
    .from(workflows)
    .where(eq(workflows.published, true))
    .all()

  if (query.category) {
    rows = rows.filter((r) => r.category === query.category)
  }
  if (query.capability) {
    rows = rows.filter((r) => {
      try {
        const caps: string[] = JSON.parse(r.capabilities)
        return caps.includes(query.capability!)
      } catch {
        return false
      }
    })
  }
  if (query.chain) {
    rows = rows.filter((r) => {
      try {
        const chains: string[] = JSON.parse(r.chains)
        return chains.includes(query.chain!)
      } catch {
        return false
      }
    })
  }

  return rows.map((r) => ({
    workflowId: r.id,
    name: r.name,
    description: r.description,
    category: r.category,
    chains: JSON.parse(r.chains) as string[],
    capabilities: JSON.parse(r.capabilities) as string[],
    priceUsdc: r.priceUsdc ?? 10000,
    x402Endpoint: r.x402Endpoint ?? "",
    totalExecutions: r.totalExecutions ?? 0,
    successfulExecutions: r.successfulExecutions ?? 0,
    source: "local" as const,
  }))
}

// ── Path C: Bazaar directory ──

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

  const [registryResult, localResult, bazaarResult] = await Promise.allSettled([
    discoverViaRegistry(query),
    discoverViaLocal(query),
    discoverViaBazaar(query),
  ])

  // Local never fails (SQLite), so only check registry + bazaar for hard failure
  const remotesFailed =
    registryResult.status === "rejected" &&
    bazaarResult.status === "rejected"
  const localFailed = localResult.status === "rejected"

  if (remotesFailed && localFailed) {
    log.error("All discovery sources failed", {
      registry: registryResult.reason,
      local: localResult.reason,
      bazaar: bazaarResult.reason,
    })
    throw new AppError(
      ErrorCodes.DISCOVERY_FAILED,
      502,
      "All discovery sources unavailable",
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
    log.warn("Registry discovery failed", registryResult.reason)
  }
  if (localResult.status === "rejected") {
    log.warn("Local discovery failed", localResult.reason)
  }
  if (bazaarResult.status === "rejected") {
    log.warn("Bazaar discovery failed", bazaarResult.reason)
  }

  const registryWorkflows =
    registryResult.status === "fulfilled" ? registryResult.value : []
  const localWorkflows =
    localResult.status === "fulfilled" ? localResult.value : []
  const bazaarWorkflows =
    bazaarResult.status === "fulfilled" ? bazaarResult.value : []

  // ── Deduplicate by x402Endpoint — prefer registry (has execution stats), then local ──
  const seen = new Map<string, DiscoveredWorkflow>()

  for (const w of registryWorkflows) {
    seen.set(w.x402Endpoint, w)
  }
  for (const w of localWorkflows) {
    if (!seen.has(w.x402Endpoint)) {
      seen.set(w.x402Endpoint, w)
    }
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
export const _discoverViaLocal = discoverViaLocal
export const _discoverViaBazaar = discoverViaBazaar
export const _CHAIN_SELECTORS = CHAIN_SELECTORS
export const _discoveryCache = discoveryCache
