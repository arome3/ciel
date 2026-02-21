"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Hammer, Store, GitBranch, Plus, Wallet } from "lucide-react"
import { useCommandStore } from "@/lib/command-store"
import { useWorkflowStore } from "@/lib/store"

export function CommandPalette() {
  const router = useRouter()
  const { isOpen, setOpen } = useCommandStore()
  const walletAddress = useWorkflowStore((s) => s.walletAddress)
  const setWalletAddress = useWorkflowStore((s) => s.setWalletAddress)

  // Cmd+K / Ctrl+K toggle
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen(!isOpen)
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, setOpen])

  function navigate(path: string) {
    router.push(path)
    setOpen(false)
  }

  function handleConnectWallet() {
    if (walletAddress) return
    const hex = Array.from({ length: 40 }, () =>
      Math.floor(Math.random() * 16).toString(16),
    ).join("")
    setWalletAddress(`0x${hex}`)
    setOpen(false)
  }

  return (
    <CommandDialog open={isOpen} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigation">
          <CommandItem onSelect={() => navigate("/build")}>
            <Hammer className="mr-2 h-4 w-4" />
            Build
          </CommandItem>
          <CommandItem onSelect={() => navigate("/marketplace")}>
            <Store className="mr-2 h-4 w-4" />
            Marketplace
          </CommandItem>
          <CommandItem onSelect={() => navigate("/pipelines")}>
            <GitBranch className="mr-2 h-4 w-4" />
            Pipelines
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => navigate("/build")}>
            <Plus className="mr-2 h-4 w-4" />
            New Workflow
          </CommandItem>
          {!walletAddress && (
            <CommandItem onSelect={handleConnectWallet}>
              <Wallet className="mr-2 h-4 w-4" />
              Connect Wallet
            </CommandItem>
          )}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
