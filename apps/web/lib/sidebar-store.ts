import { create } from "zustand"

interface SidebarState {
  isCollapsed: boolean
  isMobileOpen: boolean
  toggleCollapsed: () => void
  setMobileOpen: (open: boolean) => void
}

export const useSidebarStore = create<SidebarState>((set) => ({
  isCollapsed: false,
  isMobileOpen: false,
  toggleCollapsed: () => set((s) => ({ isCollapsed: !s.isCollapsed })),
  setMobileOpen: (isMobileOpen) => set({ isMobileOpen }),
}))
