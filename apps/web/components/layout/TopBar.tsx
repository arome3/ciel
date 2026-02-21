"use client"

import { Menu } from "lucide-react"
import { useSidebarStore } from "@/lib/sidebar-store"
import { useCommandStore } from "@/lib/command-store"
import { WalletButton } from "./WalletButton"

export function TopBar() {
  const setMobileOpen = useSidebarStore((s) => s.setMobileOpen)
  const toggleCommand = useCommandStore((s) => s.toggle)

  return (
    <header className="sticky top-0 z-10 flex h-12 items-center gap-3 border-b border-border bg-card px-4">
      {/* Mobile hamburger */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground md:hidden"
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Wordmark */}
      <span className="text-sm font-semibold text-foreground">Ciel</span>

      <div className="flex-1" />

      {/* Cmd+K hint */}
      <button
        type="button"
        onClick={toggleCommand}
        className="hidden items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground sm:flex"
      >
        <kbd className="font-mono text-[10px]">⌘K</kbd>
      </button>

      <WalletButton />
    </header>
  )
}
