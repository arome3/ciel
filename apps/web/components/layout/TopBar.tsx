"use client"

import { Menu } from "lucide-react"
import { useCommandStore } from "@/lib/command-store"
import { useSidebarStore } from "@/lib/sidebar-store"
import { WalletButton } from "./WalletButton"

export function TopBar() {
  const toggleCommand = useCommandStore((s) => s.toggle)
  const setMobileOpen = useSidebarStore((s) => s.setMobileOpen)

  return (
    <header className="sticky top-0 z-10 flex h-12 items-center gap-3 border-b border-border bg-background px-4">
      {/* Mobile hamburger — hidden on desktop where sidebar is always visible */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="-ml-1 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground md:hidden"
        aria-label="Open sidebar"
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
