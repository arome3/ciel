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

interface PublishDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PublishDialog({ open, onOpenChange }: PublishDialogProps) {
  const workflow = useWorkflowStore((s) => s.generatedWorkflow)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [price, setPrice] = useState("0.10")
  const [publishing, setPublishing] = useState(false)

  async function handlePublish() {
    if (!workflow || publishing) return
    if (!name.trim()) return

    setPublishing(true)
    try {
      await api.publish(
        workflow.id,
        name.trim(),
        description.trim(),
        Math.round(Number(price) * 1_000_000),
      )
      toastSuccess("Workflow published", `"${name}" is now live on the marketplace`)
      onOpenChange(false)
      setName("")
      setDescription("")
      setPrice("0.10")
    } catch (err) {
      toastError(
        "Publish failed",
        err instanceof Error ? err.message : "Unknown error",
      )
    } finally {
      setPublishing(false)
    }
  }

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
            {publishing ? "Publishing..." : "Publish"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
