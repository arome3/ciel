import { create } from "zustand"

interface CommandState {
  isOpen: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
}

export const useCommandStore = create<CommandState>((set) => ({
  isOpen: false,
  setOpen: (isOpen) => set({ isOpen }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
}))
