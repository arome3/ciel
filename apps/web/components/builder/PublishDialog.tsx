"use client"

import { useState, useEffect } from "react"
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
import { createPublicClient, http } from "viem"
import { baseSepolia } from "wagmi/chains"
import {
  REGISTRY_ABI,
  REGISTRY_ADDRESS,
  BASE_SEPOLIA_CHAIN_SELECTOR,
} from "@/lib/contracts"
import { tenderlyVnet } from "@/lib/wagmi"
import { Sparkles, Loader2, FlaskConical, Globe } from "lucide-react"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"

type PublishTarget = "base-sepolia" | "vnet"

interface VNetInfo {
  chainId: number
  rpcUrl: string
  name: string
  registryAddress: string
  explorerUrl: string
}

interface PublishDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// --- MetaMask chain helpers ---

async function switchToChain(chainId: number, rpcUrl?: string, chainName?: string): Promise<void> {
  const ethereum = (window as unknown as { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum
  if (!ethereum) throw new Error("No wallet detected")

  const chainIdHex = `0x${chainId.toString(16)}`

  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    })
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: number }).code === 4902 && rpcUrl) {
      await ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: chainIdHex,
          chainName: chainName ?? "Tenderly VNet",
          nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
          rpcUrls: [rpcUrl],
        }],
      })
    } else {
      throw err
    }
  }
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
  const [generating, setGenerating] = useState(false)
  const [status, setStatus] = useState("")

  // Environment selection
  const [target, setTarget] = useState<PublishTarget>("base-sepolia")
  const [vnetInfo, setVnetInfo] = useState<VNetInfo | null>(null)
  const [loadingVnet, setLoadingVnet] = useState(false)

  // Fetch VNet status when dialog opens
  useEffect(() => {
    if (!open) return
    setLoadingVnet(true)
    api.tenderlyStatus()
      .then((s) => {
        if (s.active && s.testnet && s.contracts.registry) {
          setVnetInfo({
            chainId: s.testnet.chainId,
            rpcUrl: s.testnet.rpcUrl,
            name: s.testnet.name,
            registryAddress: s.contracts.registry,
            explorerUrl: s.testnet.explorerUrl,
          })
        } else {
          setVnetInfo(null)
        }
      })
      .catch(() => setVnetInfo(null))
      .finally(() => setLoadingVnet(false))
  }, [open])

  async function handleGenerateDescription() {
    if (!workflow || generating) return
    setGenerating(true)
    try {
      const capabilities = [
        ...(workflow.intent.dataSources ?? []),
        ...(workflow.intent.actions ?? []),
      ]
      const result = await api.generateDescription({
        explanation: workflow.explanation,
        templateName: workflow.template.templateName,
        category: workflow.template.category ?? "core-defi",
        capabilities,
      })
      setDescription(result.description)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to generate description"
      toastError("Generation failed", msg)
    } finally {
      setGenerating(false)
    }
  }

  const DESC_MAX = 500

  async function handlePublish() {
    if (!workflow || publishing) return
    if (!name.trim()) return

    const desc = description.trim()
    if (desc.length < 10) {
      toastError("Publish failed", "Description must be at least 10 characters")
      return
    }
    if (desc.length > DESC_MAX) {
      toastError("Publish failed", `Description must be under ${DESC_MAX} characters (currently ${desc.length})`)
      return
    }

    const priceUsdc = Math.round(Number(price) * 1_000_000)
    if (priceUsdc < 0) {
      toastError("Publish failed", "Price cannot be negative")
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

    const useVNet = target === "vnet" && vnetInfo !== null

    setPublishing(true)
    let switchedChain = false

    try {
      let registryAddr: `0x${string}` = REGISTRY_ADDRESS
      let receiptClient: typeof publicClient = publicClient

      if (useVNet) {
        registryAddr = vnetInfo.registryAddress as `0x${string}`

        // Auto-fund the user's wallet on VNet (unlimited faucet)
        setStatus("Funding wallet on VNet...")
        try {
          await api.tenderlyFund(address, 10)
        } catch {
          // Non-fatal — user might already have funds
        }

        // Switch wallet to VNet chain
        setStatus("Switching to Virtual TestNet...")
        await switchToChain(vnetInfo.chainId, vnetInfo.rpcUrl, vnetInfo.name)
        switchedChain = true

        // Create viem client with real VNet RPC for receipt
        receiptClient = createPublicClient({
          chain: tenderlyVnet,
          transport: http(vnetInfo.rpcUrl),
        }) as typeof publicClient
      }

      // Submit on-chain tx
      const x402Endpoint = `${API_URL}/api/workflows/${workflow.id}/execute`
      const capabilities = [
        ...(workflow.intent.dataSources ?? []),
        ...(workflow.intent.actions ?? []),
      ]
      const category = workflow.template.category ?? "core-defi"

      setStatus("Submitting tx...")
      const hash = await writeContractAsync({
        address: registryAddr,
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

      // Wait for confirmation
      setStatus("Confirming tx...")
      await receiptClient.waitForTransactionReceipt({ hash })

      const onchainWorkflowId = hash

      // Confirm with backend
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

      const env = useVNet ? "Virtual TestNet" : "Base Sepolia"
      toastSuccess("Workflow published", `"${name}" published to ${env}`)
      onOpenChange(false)
      setName("")
      setDescription("")
      setPrice("0.10")
    } catch (err) {
      console.error("[PublishDialog] error:", err)
      if (err instanceof Error && /rejected|denied|cancel/i.test(err.message)) {
        return
      }
      const msg = err instanceof Error ? err.message
        : typeof err === "string" ? err
        : "Unknown error"
      toastError("Publish failed", msg)
    } finally {
      // Switch back to Base Sepolia
      if (switchedChain) {
        switchToChain(baseSepolia.id).catch(() => {})
      }
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
          {/* Environment picker */}
          {!loadingVnet && vnetInfo && (
            <div className="space-y-1.5">
              <Label className="text-xs">Publish to</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setTarget("base-sepolia")}
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                    target === "base-sepolia"
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-card text-muted-foreground hover:border-muted-foreground"
                  }`}
                >
                  <Globe className="size-3.5 shrink-0" />
                  <div>
                    <p className="font-medium">Base Sepolia</p>
                    <p className="text-[10px] text-muted-foreground">Permanent</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setTarget("vnet")}
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                    target === "vnet"
                      ? "border-purple-500 bg-purple-500/10 text-foreground"
                      : "border-border bg-card text-muted-foreground hover:border-muted-foreground"
                  }`}
                >
                  <FlaskConical className="size-3.5 shrink-0" />
                  <div>
                    <p className="font-medium">Virtual TestNet</p>
                    <p className="text-[10px] text-muted-foreground">Testing only</p>
                  </div>
                </button>
              </div>
              {target === "vnet" && (
                <p className="rounded-md bg-yellow-950/30 border border-yellow-800/40 px-3 py-2 text-[11px] text-yellow-300">
                  Virtual TestNet data is temporary and will be lost when the testnet is destroyed.
                  Your wallet will be auto-funded with 10 ETH for gas.
                </p>
              )}
            </div>
          )}

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
            <div className="flex items-center gap-2">
              <Label htmlFor="pub-desc" className="text-xs">
                Description
              </Label>
              <button
                type="button"
                onClick={handleGenerateDescription}
                disabled={generating || !workflow}
                className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                title="Auto-generate description"
              >
                {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              </button>
            </div>
            <Textarea
              id="pub-desc"
              placeholder="What does this workflow do?"
              rows={3}
              maxLength={DESC_MAX}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <p className={`text-[10px] text-right ${description.length > DESC_MAX ? "text-destructive" : "text-muted-foreground"}`}>
              {description.length}/{DESC_MAX}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pub-price" className="text-xs">
              Price (USDC)
            </Label>
            <Input
              id="pub-price"
              type="number"
              step="0.01"
              min="0"
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
