"use client"

import { useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useWorkflowStore } from "@/lib/store"

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function randomAddress(): string {
  const hex = Array.from({ length: 40 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join("")
  return `0x${hex}`
}

export function WalletButton() {
  const walletAddress = useWorkflowStore((s) => s.walletAddress)
  const setWalletAddress = useWorkflowStore((s) => s.setWalletAddress)
  const [connecting, setConnecting] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleConnect = useCallback(async () => {
    setConnecting(true)
    // Mock wallet connection with 1s delay
    await new Promise((resolve) => setTimeout(resolve, 1000))
    setWalletAddress(randomAddress())
    setConnecting(false)
  }, [setWalletAddress])

  const handleCopy = useCallback(async () => {
    if (!walletAddress) return
    await navigator.clipboard.writeText(walletAddress)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [walletAddress])

  const handleDisconnect = useCallback(() => {
    setWalletAddress(null)
  }, [setWalletAddress])

  // Disconnected state
  if (!walletAddress) {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={handleConnect}
        disabled={connecting}
        className="text-xs"
      >
        {connecting ? "Connecting..." : "Connect Wallet"}
      </Button>
    )
  }

  // Connected state with dropdown
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="gap-2 text-xs">
          <span className="h-2 w-2 rounded-full bg-green-500" />
          {truncateAddress(walletAddress)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={handleCopy}>
          {copied ? "Copied!" : "Copy Address"}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleDisconnect}>
          Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
