"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useWorkflowStore } from "@/lib/store"

const SCHEDULE_OPTIONS = [
  { value: "1m", label: "Every 1 minute" },
  { value: "5m", label: "Every 5 minutes" },
  { value: "15m", label: "Every 15 minutes" },
  { value: "1h", label: "Every 1 hour" },
  { value: "24h", label: "Every 24 hours" },
]

const CHAIN_OPTIONS = [
  { value: "base-sepolia", label: "Base Sepolia" },
  { value: "ethereum", label: "Ethereum" },
  { value: "arbitrum", label: "Arbitrum" },
  { value: "optimism", label: "Optimism" },
]

interface ParameterEditorProps {
  onPublish: () => void
}

export function ParameterEditor({ onPublish }: ParameterEditorProps) {
  const workflow = useWorkflowStore((s) => s.generatedWorkflow)
  const simulation = useWorkflowStore((s) => s.simulation)
  const isSimulating = useWorkflowStore((s) => s.isSimulating)
  const setSimulation = useWorkflowStore((s) => s.setSimulation)

  const [schedule, setSchedule] = useState("5m")
  const [threshold, setThreshold] = useState("2000")
  const [selectedChains, setSelectedChains] = useState<string[]>(["base-sepolia"])
  const [price, setPrice] = useState("0.10")

  if (!workflow) return null

  function toggleChain(chain: string) {
    setSelectedChains((prev) =>
      prev.includes(chain)
        ? prev.filter((c) => c !== chain)
        : [...prev, chain],
    )
  }

  async function handleReSimulate() {
    if (!workflow || isSimulating) return
    useWorkflowStore.getState().setIsSimulating(true)
    try {
      const { api } = await import("@/lib/api")
      const result = await api.simulate(workflow.id, {
        schedule,
        threshold: Number(threshold),
        chains: selectedChains,
      })
      setSimulation(result)
    } catch {
      // non-fatal — keep previous simulation
    } finally {
      useWorkflowStore.getState().setIsSimulating(false)
    }
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <h3 className="mb-4 text-sm font-semibold text-foreground">
        Parameters
      </h3>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Schedule */}
        <div className="space-y-1.5">
          <Label htmlFor="schedule" className="text-xs">
            Schedule
          </Label>
          <Select value={schedule} onValueChange={setSchedule}>
            <SelectTrigger id="schedule">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCHEDULE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Threshold */}
        <div className="space-y-1.5">
          <Label htmlFor="threshold" className="text-xs">
            Threshold
          </Label>
          <Input
            id="threshold"
            type="number"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
          />
        </div>

        {/* Chains */}
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs">Chains</Label>
          <div className="flex flex-wrap gap-2">
            {CHAIN_OPTIONS.map((chain) => (
              <button
                key={chain.value}
                type="button"
                onClick={() => toggleChain(chain.value)}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                  selectedChains.includes(chain.value)
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/50"
                }`}
              >
                {chain.label}
              </button>
            ))}
          </div>
        </div>

        {/* Price */}
        <div className="space-y-1.5">
          <Label htmlFor="price" className="text-xs">
            Price
          </Label>
          <div className="relative">
            <Input
              id="price"
              type="number"
              step="0.01"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="pr-14"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              USDC
            </span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-4 flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={handleReSimulate}
          disabled={isSimulating}
        >
          {isSimulating ? "Simulating..." : "Re-simulate"}
        </Button>
        <Button size="sm" onClick={onPublish}>
          Publish
        </Button>
      </div>
    </div>
  )
}
