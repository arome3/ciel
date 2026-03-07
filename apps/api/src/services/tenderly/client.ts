// apps/api/src/services/tenderly/client.ts
// REST API + Admin RPC wrapper for Tenderly Virtual TestNets.

import { config } from "../../config"
import { AppError, ErrorCodes } from "../../types/errors"
import { createLogger } from "../../lib/logger"

const log = createLogger("Tenderly")

const API_BASE = "https://api.tenderly.co/api/v1"
const FETCH_TIMEOUT = 15_000

/** 100 ETH in wei hex — shared constant for deployer funding. */
export const DEFAULT_FUND_WEI = "0x56BC75E2D63100000"

// --- Types ---

export interface CreateTestnetConfig {
  name: string
  networkId: number       // 1=mainnet, 84532=base-sepolia, 8453=base, 42161=arbitrum
  chainId?: number        // custom chain ID (prevents replay attacks)
  syncState?: boolean     // real-time mainnet state sync
}

export interface TenderlyTestnet {
  id: string
  name: string
  slug: string
  networkId: number
  chainId: number
  publicRpcUrl: string
  adminRpcUrl: string
  explorerUrl: string
  createdAt: string
}

// --- Config Guard ---

export function ensureTenderlyConfigured(): void {
  if (!config.TENDERLY_ACCESS_KEY || !config.TENDERLY_PROJECT_SLUG) {
    throw new AppError(
      ErrorCodes.TENDERLY_NOT_CONFIGURED,
      501,
      "Tenderly is not configured. Set TENDERLY_ACCESS_KEY and TENDERLY_PROJECT_SLUG in .env",
    )
  }
}

// --- REST API Helpers ---

function apiUrl(path: string): string {
  return `${API_BASE}/account/${config.TENDERLY_ACCOUNT_SLUG}/project/${config.TENDERLY_PROJECT_SLUG}${path}`
}

function headers(): Record<string, string> {
  return {
    "X-Access-Key": config.TENDERLY_ACCESS_KEY!,
    "Content-Type": "application/json",
  }
}

async function apiRequest<T>(
  method: string,
  url: string,
  body?: unknown,
): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: headers(),
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    })
  } catch (err) {
    throw new AppError(
      ErrorCodes.TENDERLY_API_ERROR,
      502,
      `Tenderly API request failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  if (!res.ok) {
    let detail = ""
    try {
      const errBody = await res.json()
      detail = errBody.error?.message ?? JSON.stringify(errBody).slice(0, 300)
    } catch {
      detail = `HTTP ${res.status}`
    }
    throw new AppError(
      ErrorCodes.TENDERLY_API_ERROR,
      res.status >= 500 ? 502 : res.status,
      `Tenderly API error: ${detail}`,
    )
  }

  // Handle empty responses (e.g. DELETE 204 No Content)
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as T
  }

  return res.json() as Promise<T>
}

// --- Admin RPC Helper ---

async function adminRpc<T>(
  adminRpcUrl: string,
  method: string,
  params: unknown[] = [],
): Promise<T> {
  let res: Response
  try {
    res = await fetch(adminRpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params,
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    })
  } catch (err) {
    throw new AppError(
      ErrorCodes.TENDERLY_API_ERROR,
      502,
      `Tenderly RPC call failed (${method}): ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  if (!res.ok) {
    throw new AppError(
      ErrorCodes.TENDERLY_API_ERROR,
      502,
      `Tenderly RPC HTTP error (${method}): ${res.status}`,
    )
  }

  const json = await res.json() as { result?: T; error?: { message: string } }

  if (json.error) {
    throw new AppError(
      ErrorCodes.TENDERLY_API_ERROR,
      502,
      `Tenderly RPC error (${method}): ${json.error.message}`,
    )
  }

  return json.result as T
}

// --- Virtual TestNet CRUD ---

export async function createTestnet(opts: CreateTestnetConfig): Promise<TenderlyTestnet> {
  ensureTenderlyConfigured()

  const chainId = opts.chainId ?? 73571 // default custom chain ID
  log.info(`Creating Virtual TestNet "${opts.name}" (fork: ${opts.networkId}, chainId: ${chainId})`)

  const body = {
    slug: opts.name.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
    display_name: opts.name,
    fork_config: {
      network_id: opts.networkId,
    },
    virtual_network_config: {
      chain_config: {
        chain_id: chainId,
      },
    },
    sync_state_config: {
      enabled: opts.syncState ?? false,
    },
    explorer_page_config: {
      enabled: true,
      verification_visibility: "src",
    },
  }

  interface VNetResponse {
    id: string
    slug: string
    display_name: string
    fork_config: { network_id: number }
    virtual_network_config: { chain_config: { chain_id: number } }
    rpcs: Array<{ name: string; url: string }>
    created_at: string
  }

  const raw = await apiRequest<VNetResponse>("POST", apiUrl("/vnets"), body)

  const publicRpc = raw.rpcs?.find(r => r.name === "Public RPC")?.url
    ?? raw.rpcs?.find(r => r.name === "Admin RPC")?.url
    ?? raw.rpcs?.[0]?.url ?? ""
  const adminRpcUrl = raw.rpcs?.find(r => r.name === "Admin RPC")?.url
    ?? raw.rpcs?.[0]?.url ?? ""
  const explorerUrl = `https://dashboard.tenderly.co/${config.TENDERLY_ACCOUNT_SLUG}/${config.TENDERLY_PROJECT_SLUG}/testnet/${raw.id}`

  const testnet: TenderlyTestnet = {
    id: raw.id,
    name: raw.display_name,
    slug: raw.slug,
    networkId: raw.fork_config.network_id,
    chainId: raw.virtual_network_config.chain_config.chain_id,
    publicRpcUrl: publicRpc,
    adminRpcUrl,
    explorerUrl,
    createdAt: raw.created_at,
  }

  log.info(`Virtual TestNet created: ${testnet.id} (explorer: ${testnet.explorerUrl})`)
  return testnet
}

export async function deleteTestnet(testnetId: string): Promise<void> {
  ensureTenderlyConfigured()
  log.info(`Deleting Virtual TestNet: ${testnetId}`)
  await apiRequest("DELETE", apiUrl(`/vnets/${testnetId}`))
  log.info(`Virtual TestNet deleted: ${testnetId}`)
}

export async function listTestnets(): Promise<TenderlyTestnet[]> {
  ensureTenderlyConfigured()

  interface ListResponse {
    id: string
    slug: string
    display_name: string
    fork_config: { network_id: number }
    virtual_network_config: { chain_config: { chain_id: number } }
    rpcs: Array<{ name: string; url: string }>
    created_at: string
  }

  const raw = await apiRequest<ListResponse[]>("GET", apiUrl("/vnets"))

  return raw.map(r => ({
    id: r.id,
    name: r.display_name,
    slug: r.slug,
    networkId: r.fork_config.network_id,
    chainId: r.virtual_network_config.chain_config.chain_id,
    publicRpcUrl: r.rpcs?.find(rpc => rpc.name === "Public RPC")?.url ?? r.rpcs?.[0]?.url ?? "",
    adminRpcUrl: r.rpcs?.find(rpc => rpc.name === "Admin RPC")?.url ?? r.rpcs?.[0]?.url ?? "",
    explorerUrl: `https://dashboard.tenderly.co/${config.TENDERLY_ACCOUNT_SLUG}/${config.TENDERLY_PROJECT_SLUG}/testnet/${r.id}`,
    createdAt: r.created_at,
  }))
}

// --- State Manipulation (Admin RPC) ---

export async function fundAccount(
  adminRpcUrl: string,
  address: string,
  weiHex: string,
): Promise<void> {
  log.info(`Funding ${address} with ${weiHex} wei`)
  try {
    await adminRpc(adminRpcUrl, "tenderly_setBalance", [[address], weiHex])
  } catch (err) {
    if (err instanceof AppError) {
      throw new AppError(
        ErrorCodes.TENDERLY_FUND_FAILED,
        502,
        `Failed to fund account ${address}: ${err.message}`,
      )
    }
    throw err
  }
}

export async function setErc20Balance(
  adminRpcUrl: string,
  tokenAddress: string,
  walletAddress: string,
  amountHex: string,
): Promise<void> {
  log.info(`Setting ERC-20 balance: token=${tokenAddress}, wallet=${walletAddress}`)
  await adminRpc(adminRpcUrl, "tenderly_setErc20Balance", [
    tokenAddress,
    walletAddress,
    amountHex,
  ])
}

export async function snapshot(adminRpcUrl: string): Promise<string> {
  log.info("Creating EVM snapshot")
  const snapshotId = await adminRpc<string>(adminRpcUrl, "evm_snapshot")
  log.info(`Snapshot created: ${snapshotId}`)
  return snapshotId
}

export async function revertToSnapshot(
  adminRpcUrl: string,
  snapshotId: string,
): Promise<boolean> {
  log.info(`Reverting to snapshot: ${snapshotId}`)
  const result = await adminRpc<boolean>(adminRpcUrl, "evm_revert", [snapshotId])
  log.info(`Revert ${result ? "succeeded" : "failed"}`)
  return result
}
