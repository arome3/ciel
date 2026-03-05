"use client"

import { ConnectButton } from "@rainbow-me/rainbowkit"

export function WalletButton() {
  return (
    <ConnectButton
      accountStatus="address"
      chainStatus="icon"
      showBalance={false}
    />
  )
}
