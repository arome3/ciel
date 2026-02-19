import { createPublicClient, createWalletClient, http } from "viem"
import { baseSepolia } from "viem/chains"
import { privateKeyToAccount } from "viem/accounts"
import { config } from "../../config"
import { createLogger } from "../../lib/logger"

const log = createLogger("Blockchain")

// --- Account ---

const account = privateKeyToAccount(config.PRIVATE_KEY as `0x${string}`)

log.info(`Wallet account loaded: ${account.address}`)

// --- Public Client (read-only) ---

export const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(config.BASE_SEPOLIA_RPC_URL),
})

// --- Wallet Client (read + write) ---

export const walletClient = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http(config.BASE_SEPOLIA_RPC_URL),
})

export { account }
