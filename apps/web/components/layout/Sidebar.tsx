"use client"

import { useEffect } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Hammer, Store, GitBranch, ChevronLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { useSidebarStore } from "@/lib/sidebar-store"

const NAV_ITEMS = [
  { href: "/build", label: "Build", icon: Hammer },
  { href: "/marketplace", label: "Marketplace", icon: Store },
  { href: "/pipelines", label: "Pipelines", icon: GitBranch },
] as const

export function Sidebar() {
  const pathname = usePathname()
  const { isCollapsed, isMobileOpen, toggleCollapsed, setMobileOpen } =
    useSidebarStore()

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname, setMobileOpen])

  // Close mobile sidebar on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && isMobileOpen) {
        setMobileOpen(false)
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [isMobileOpen, setMobileOpen])

  const navContent = (
    <nav className="flex flex-col gap-1 px-2 py-3" aria-label="Main navigation">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const isActive = pathname === href || pathname.startsWith(href + "/")
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "border-l-2 border-primary bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              isCollapsed && "justify-center px-2",
            )}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon className="h-4 w-4 flex-shrink-0" />
            {!isCollapsed && <span>{label}</span>}
          </Link>
        )
      })}
    </nav>
  )

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden md:flex flex-col border-r border-border bg-card transition-all duration-200",
          isCollapsed ? "w-12" : "w-60",
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
        {navContent}
      </aside>

      {/* Mobile overlay */}
      {isMobileOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside className="fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-border bg-card md:hidden">
            <div className="flex h-12 items-center px-4 border-b border-border">
              <span className="text-sm font-semibold text-foreground">Ciel</span>
            </div>
            {navContent}
          </aside>
        </>
      )}
    </>
  )
}
