"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { useWorkflowStore } from "@/lib/store"
import { api } from "@/lib/api"
import { toastSuccess, toastError } from "@/lib/toast"
import { useAccount, usePublicClient, useWriteContract } from "wagmi"
import { useConnectModal } from "@rainbow-me/rainbowkit"
import {
  REGISTRY_ABI,
  REGISTRY_ADDRESS,
  BASE_SEPOLIA_CHAIN_SELECTOR,
} from "@/lib/contracts"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"

interface PublishDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PublishDialog({ open, onOpenChange }: PublishDialogProps) {
  const workflow = useWorkflowStore((s) => s.generatedWorkflow)
  const { address, isConnected } = useAccount()
  const { openConnectModal } = useConnectModal()
  const publicClient = usePublicClient()
  const { writeContractAsync } = useWriteContract()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [price, setPrice] = useState("0.10")
  const [publishing, setPublishing] = useState(false)
  const [status, setStatus] = useState("")

  async function handlePublish() {
    if (!workflow || publishing) return
    if (!name.trim()) return

    const priceUsdc = Math.round(Number(price) * 1_000_000)
    if (priceUsdc < 1000) {
      toastError("Publish failed", "Minimum price is 0.001 USDC")
      return
    }

    if (!isConnected || !address) {
      openConnectModal?.()
      return
    }

    if (!publicClient) {
      toastError("Publish failed", "No network client available")
      return
    }

    setPublishing(true)
    setStatus("Submitting tx...")
    try {
      const x402Endpoint = `${API_URL}/api/workflows/${workflow.id}/execute`

      const capabilities = [
        ...(workflow.intent.dataSources ?? []),
        ...(workflow.intent.actions ?? []),
      ]

      const category = workflow.template.category ?? "core-defi"

      // 1. Submit publishWorkflow tx from user's wallet
      const hash = await writeContractAsync({
        address: REGISTRY_ADDRESS,
        abi: REGISTRY_ABI,
        functionName: "publishWorkflow",
        args: [
          name.trim(),
          description.trim(),
          category,
          [BASE_SEPOLIA_CHAIN_SELECTOR],
          capabilities,
          x402Endpoint,
          BigInt(priceUsdc),
        ],
        gas: 800_000n,
      })

      // 2. Wait for on-chain confirmation
      setStatus("Confirming tx...")
      await publicClient.waitForTransactionReceipt({ hash })

      // 3. Use tx hash as onchain workflow identifier
      //    (Free RPC doesn't support eth_call/readContract reliably;
      //     upgrade to read actual bytes32 workflowId with a paid RPC)
      const onchainWorkflowId = hash

      // 4. Confirm with backend (DB update + DON deploy)
      setStatus("Registering...")
      await api.confirmPublish(
        workflow.id,
        hash,
        onchainWorkflowId,
        name.trim(),
        description.trim(),
        priceUsdc,
        address,
      )

      toastSuccess("Workflow published", `"${name}" is now live on the marketplace`)
      onOpenChange(false)
      setName("")
      setDescription("")
      setPrice("0.10")
    } catch (err) {
      console.error("[PublishDialog] error:", err)
      // User rejected the transaction — silently bail
      if (err instanceof Error && /rejected|denied|cancel/i.test(err.message)) {
        return
      }
      const msg = err instanceof Error ? err.message
        : typeof err === "string" ? err
        : "Unknown error"
      toastError("Publish failed", msg)
    } finally {
      setPublishing(false)
      setStatus("")
    }
  }

  const buttonLabel = publishing
    ? status
    : isConnected
      ? "Publish"
      : "Connect Wallet"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Publish Workflow</DialogTitle>
          <DialogDescription>
            Make your workflow available on the marketplace
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="pub-name" className="text-xs">
              Name
            </Label>
            <Input
              id="pub-name"
              placeholder="My Workflow"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pub-desc" className="text-xs">
              Description
            </Label>
            <Textarea
              id="pub-desc"
              placeholder="What does this workflow do?"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pub-price" className="text-xs">
              Price (USDC)
            </Label>
            <Input
              id="pub-price"
              type="number"
              step="0.001"
              min="0.001"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>

          <Button
            onClick={handlePublish}
            disabled={publishing || !name.trim()}
            className="w-full"
          >
            {buttonLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
