"use client"

import { useAccount, useDisconnect, useSwitchChain } from "wagmi"
import { ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"

const REGISTRY_ADDRESS = "0x10317DEe62219bD69619C27575995F4CC145DdC0"
const CONSUMER_ADDRESS = "0x34DAba0F2295972547d3ceb42f12B50a18D8E392"

export function WalletSettings() {
  const { address, chain } = useAccount()
  const { disconnect } = useDisconnect()
  const { switchChain, chains } = useSwitchChain()

  if (!address) {
    return (
      <p className="text-sm text-muted-foreground">
        Connect your wallet to view wallet settings.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label>Connected Wallet</Label>
        <div className="flex items-center gap-3">
          <code className="rounded-md bg-muted px-3 py-1.5 text-sm font-mono">
            {address}
          </code>
          <Button variant="outline" size="sm" onClick={() => disconnect()}>
            Disconnect
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Network</Label>
        <div className="flex items-center gap-3">
          <span className="text-sm text-foreground">{chain?.name ?? "Unknown"}</span>
          {switchChain && chains.length > 1 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const baseSepolia = chains.find((c) => c.name.includes("Base Sepolia"))
                if (baseSepolia) switchChain({ chainId: baseSepolia.id })
              }}
            >
              Switch to Base Sepolia
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Contract Addresses</Label>
        <div className="space-y-1.5 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Registry:</span>
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">{REGISTRY_ADDRESS}</code>
            <a
              href={`https://sepolia.basescan.org/address/${REGISTRY_ADDRESS}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Consumer:</span>
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">{CONSUMER_ADDRESS}</code>
            <a
              href={`https://sepolia.basescan.org/address/${CONSUMER_ADDRESS}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
