import { getDefaultConfig } from "@rainbow-me/rainbowkit"
import { baseSepolia } from "wagmi/chains"
import { http } from "wagmi"
import { defineChain } from "viem"

// Tenderly VNet chain — chain ID 73571 is the default for Ciel VNets.
// The RPC URL here is a placeholder; the real URL is injected into MetaMask
// at publish time via wallet_addEthereumChain (it changes per VNet session).
export const tenderlyVnet = defineChain({
  id: 73571,
  name: "Ciel Virtual TestNet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://virtual.base-sepolia.eu.rpc.tenderly.co/placeholder"] },
  },
  testnet: true,
})

export const config = getDefaultConfig({
  appName: "Ciel",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "PLACEHOLDER",
  chains: [baseSepolia, tenderlyVnet],
  transports: {
    [baseSepolia.id]: http(
      process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC ?? undefined,
    ),
    [tenderlyVnet.id]: http(),
  },
  ssr: true,
})
