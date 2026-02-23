// agent/src/discovery.ts — Discover CRE workflows via Ciel API + onchain fallback

import { createPublicClient, http, parseAbi, type Hex } from "viem"
import { baseSepolia } from "viem/chains"
import type { DiscoveredWorkflow, AgentConfig } from "./types"
import * as log from "./logger"

// Registry ABI — only the read functions we need
const registryAbi = parseAbi([
  "function searchByCategory(string category, uint256 offset, uint256 limit) view returns (bytes32[], uint256)",
  "function getWorkflow(bytes32 workflowId) view returns ((address creator, string name, string description, string category, uint64[] supportedChains, string[] capabilities, string x402Endpoint, uint256 pricePerExecution, uint256 totalExecutions, uint256 successfulExecutions, uint256 createdAt, bool active))",
])

// ─────────────────────────────────────────────
// Primary: Ciel API discovery
// ─────────────────────────────────────────────

async function discoverViaApi(
  cielApiUrl: string,
  category: string,
): Promise<DiscoveredWorkflow[]> {
  const url = `${cielApiUrl}/api/discover?category=${encodeURIComponent(category)}`
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    throw new Error(`API returned ${res.status}: ${res.statusText}`)
  }

  const data = await res.json()
  if (!Array.isArray(data)) {
    throw new Error("Unexpected response format — expected array")
  }

  return data as DiscoveredWorkflow[]
}

// ─────────────────────────────────────────────
// Fallback: Onchain registry direct read
// ─────────────────────────────────────────────

async function discoverOnchain(
  rpcUrl: string,
  registryAddress: Hex,
  category: string,
): Promise<DiscoveredWorkflow[]> {
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
  })

  const [workflowIds] = await client.readContract({
    address: registryAddress,
    abi: registryAbi,
    functionName: "searchByCategory",
    args: [category, 0n, 20n],
  })

  const workflows: DiscoveredWorkflow[] = []

  for (const id of workflowIds) {
    try {
      const wf = await client.readContract({
        address: registryAddress,
        abi: registryAbi,
        functionName: "getWorkflow",
        args: [id],
      })

      if (!wf.active) continue

      workflows.push({
        workflowId: id,
        name: wf.name,
        description: wf.description,
        category: wf.category,
        chains: [...wf.supportedChains.map(String)],
        capabilities: [...wf.capabilities],
        priceUsdc: Number(wf.pricePerExecution),
        x402Endpoint: wf.x402Endpoint,
        totalExecutions: Number(wf.totalExecutions),
        successfulExecutions: Number(wf.successfulExecutions),
        source: "registry",
      })
    } catch {
      // Skip individual workflow read failures
    }
  }

  return workflows
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

export async function discoverWorkflows(
  config: AgentConfig,
  category = "oracle",
): Promise<DiscoveredWorkflow[]> {
  // Try Ciel API first
  try {
    await log.step(`Querying Ciel API for "${category}" workflows...`)
    const workflows = await discoverViaApi(config.cielApiUrl, category)
    log.done(`Found ${workflows.length} workflow(s) via Ciel API`)
    return workflows
  } catch (err) {
    log.warn(
      `Ciel API unavailable: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // Fallback to onchain registry
  const registryAddress = process.env.REGISTRY_CONTRACT_ADDRESS as Hex | undefined
  if (!registryAddress) {
    log.error("No REGISTRY_CONTRACT_ADDRESS set — cannot fall back to onchain")
    return []
  }

  try {
    await log.step("Falling back to onchain registry...")
    const workflows = await discoverOnchain(config.rpcUrl, registryAddress, category)
    log.done(`Found ${workflows.length} workflow(s) onchain`)
    return workflows
  } catch (err) {
    log.error(
      `Onchain discovery failed: ${err instanceof Error ? err.message : String(err)}`,
    )
    return []
  }
}
