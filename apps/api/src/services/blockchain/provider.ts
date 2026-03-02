import { createPublicClient, createWalletClient, http, defineChain, type Chain } from "viem"
import { baseSepolia } from "viem/chains"
import { privateKeyToAccount } from "viem/accounts"
import { config } from "../../config"
import { createLogger } from "../../lib/logger"

const log = createLogger("Blockchain")

// --- Account ---

export const account = privateKeyToAccount(config.PRIVATE_KEY as `0x${string}`)

log.info(`Wallet account loaded: ${account.address}`)

// --- Dynamic Chain Resolution ---

// Lazy-cached import to break circular dependency:
// manager.ts → provider.ts (account) → manager.ts (getActiveTestnet)
// Resolved once on first call, cached for all subsequent calls.
type ManagerModule = typeof import("../tenderly/manager")
let _manager: ManagerModule | null = null
function getManager(): ManagerModule {
  if (!_manager) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _manager = require("../tenderly/manager") as ManagerModule
  }
  return _manager
}

function resolveChainAndRpc(): { chain: Chain; rpcUrl: string } {
  const active = getManager().getActiveTestnet()

  // Priority 1: Active Tenderly testnet (runtime state)
  if (active.testnet) {
    const t = active.testnet
    log.debug(`Using active Tenderly VNet: ${t.name} (chainId: ${t.chainId})`)
    return {
      chain: defineChain({
        id: t.chainId,
        name: `Tenderly VNet (${t.name})`,
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: { http: [t.publicRpcUrl] },
        },
      }),
      rpcUrl: t.publicRpcUrl,
    }
  }

  // Priority 2: TENDERLY_VIRTUAL_TESTNET_RPC env var
  if (config.TENDERLY_VIRTUAL_TESTNET_RPC) {
    log.debug("Using TENDERLY_VIRTUAL_TESTNET_RPC env var")
    return {
      chain: defineChain({
        id: 73571,
        name: "Tenderly Virtual TestNet",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: { http: [config.TENDERLY_VIRTUAL_TESTNET_RPC] },
        },
      }),
      rpcUrl: config.TENDERLY_VIRTUAL_TESTNET_RPC,
    }
  }

  // Priority 3: Default Base Sepolia
  return {
    chain: baseSepolia,
    rpcUrl: config.BASE_SEPOLIA_RPC_URL,
  }
}

// --- Factory Functions ---

export function getPublicClient() {
  const { chain, rpcUrl } = resolveChainAndRpc()
  return createPublicClient({
    chain,
    transport: http(rpcUrl),
  })
}

export function getWalletClient() {
  const { chain, rpcUrl } = resolveChainAndRpc()
  return createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  })
}

// --- Backwards-compatible static exports ---
// These are used by modules that always target the default chain.

export const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(config.BASE_SEPOLIA_RPC_URL),
})

export const walletClient = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http(config.BASE_SEPOLIA_RPC_URL),
})
