import { create } from "zustand"

interface ActivityState {
  isConnected: boolean
  connectionError: boolean
  setConnected: (v: boolean) => void
  setConnectionError: (v: boolean) => void
}

export const useActivityStore = create<ActivityState>((set) => ({
  isConnected: false,
  connectionError: false,
  setConnected: (isConnected) => set({ isConnected, connectionError: false }),
  setConnectionError: (connectionError) =>
    set({ connectionError, isConnected: false }),
}))
