"use client"

import { Sidebar } from "./Sidebar"
import { TopBar } from "./TopBar"
import { CommandPalette } from "./CommandPalette"

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
      <CommandPalette />
    </div>
  )
}
