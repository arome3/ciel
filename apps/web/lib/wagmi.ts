import { getDefaultConfig } from "@rainbow-me/rainbowkit"
import { baseSepolia } from "wagmi/chains"
import { http } from "wagmi"

export const config = getDefaultConfig({
  appName: "Ciel",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "PLACEHOLDER",
  chains: [baseSepolia],
  transports: {
    [baseSepolia.id]: http(
      process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC ?? undefined,
    ),
  },
  ssr: true,
})
