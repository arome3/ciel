"use client"

import { useEffect } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Layers,
  Globe,
  GitBranch,
  Store,
  LayoutGrid,
  FlaskConical,
  Settings,
  Plus,
  BookOpen,
  Wallet,
  ChevronLeft,
} from "lucide-react"
import { useAccount } from "wagmi"
import { cn } from "@/lib/utils"
import { useSidebarStore } from "@/lib/sidebar-store"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

// ─────────────────────────────────────────────
// Navigation structure
// ─────────────────────────────────────────────

const NAV_GROUPS = [
  {
    label: "Workspace",
    items: [
      { href: "/workflows", label: "My Workflows", icon: Layers },
      { href: "/published", label: "Published", icon: Globe },
      { href: "/pipelines", label: "Pipelines", icon: GitBranch },
    ],
  },
  {
    label: "Explore",
    items: [
      { href: "/marketplace", label: "Marketplace", icon: Store },
      { href: "/templates", label: "Templates", icon: LayoutGrid },
    ],
  },
  {
    label: "Tools",
    items: [
      { href: "/testnet", label: "TestNet", icon: FlaskConical },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
] as const

function truncateAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

// ─────────────────────────────────────────────
// NavItem with tooltip on collapse
// ─────────────────────────────────────────────

function NavItem({
  href,
  label,
  icon: Icon,
  isActive,
  isCollapsed,
}: {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  isActive: boolean
  isCollapsed: boolean
}) {
  const inner = (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        isActive
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        isCollapsed && "justify-center px-2",
      )}
      aria-current={isActive ? "page" : undefined}
    >
      <Icon className="h-4 w-4 flex-shrink-0" />
      {!isCollapsed && <span>{label}</span>}
    </Link>
  )

  if (isCollapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{inner}</TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    )
  }

  return inner
}

// ─────────────────────────────────────────────
// Sidebar
// ─────────────────────────────────────────────

export function Sidebar() {
  const pathname = usePathname()
  const { address, chain } = useAccount()
  const { isCollapsed, isMobileOpen, toggleCollapsed, setMobileOpen } =
    useSidebarStore()

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname, setMobileOpen])

  // Cmd+B to toggle sidebar
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "b" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        toggleCollapsed()
      }
      if (e.key === "Escape" && isMobileOpen) {
        setMobileOpen(false)
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [isMobileOpen, toggleCollapsed, setMobileOpen])

  const sidebarContent = (
    <div className="flex h-full flex-col">
      {/* Header: New Workflow CTA */}
      <div className="border-b border-border p-3">
        <Link href="/build">
          <Button
            variant="default"
            size="sm"
            className={cn("w-full gap-1.5", isCollapsed && "justify-center px-0")}
          >
            <Plus className="h-4 w-4 shrink-0" />
            {!isCollapsed && <span>New Workflow</span>}
          </Button>
        </Link>
      </div>

      {/* Nav groups */}
      <nav className="flex-1 overflow-y-auto px-2 py-2" aria-label="Main navigation">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-3">
            {!isCollapsed && (
              <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {group.label}
              </p>
            )}
            <div className="flex flex-col gap-0.5">
              {group.items.map(({ href, label, icon }) => {
                const isActive = pathname === href || pathname.startsWith(href + "/")
                return (
                  <NavItem
                    key={href}
                    href={href}
                    label={label}
                    icon={icon}
                    isActive={isActive}
                    isCollapsed={isCollapsed}
                  />
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer: Docs + Wallet */}
      <div className="border-t border-border px-2 py-2">
        <NavItem
          href="https://docs.chain.link/cre"
          label="Docs"
          icon={BookOpen}
          isActive={false}
          isCollapsed={isCollapsed}
        />
        {address && (
          <div
            className={cn(
              "mt-1 flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground",
              isCollapsed && "justify-center px-2",
            )}
          >
            <Wallet className="h-4 w-4 flex-shrink-0" />
            {!isCollapsed && (
              <span className="truncate text-xs">
                {truncateAddress(address)}
                {chain && (
                  <span className="ml-1.5 text-[10px] opacity-60">{chain.name}</span>
                )}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden md:flex flex-col border-r border-border bg-background transition-all duration-200",
          isCollapsed ? "w-[3.5rem]" : "w-60",
        )}
      >
        {/* Collapse toggle */}
        <div className="flex h-12 items-center justify-end px-2 border-b border-border">
          <button
            type="button"
            onClick={toggleCollapsed}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <ChevronLeft
              className={cn(
                "h-4 w-4 transition-transform duration-200",
                isCollapsed && "rotate-180",
              )}
            />
          </button>
        </div>
        {sidebarContent}
      </aside>

      {/* Mobile overlay */}
      {isMobileOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside className="fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-border bg-background md:hidden">
            <div className="flex h-12 items-center px-4 border-b border-border">
              <span className="text-sm font-semibold text-foreground">Ciel</span>
            </div>
            {sidebarContent}
          </aside>
        </>
      )}
    </>
  )
}
