"use client"

import { useState } from "react"
import { useAccount } from "wagmi"
import { useConnectModal } from "@rainbow-me/rainbowkit"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { api } from "@/lib/api"
import { toast } from "sonner"

interface RequestTemplateFormProps {
  onSubmitted?: () => void
}

export function RequestTemplateForm({ onSubmitted }: RequestTemplateFormProps) {
  const { address } = useAccount()
  const { openConnectModal } = useConnectModal()
  const [description, setDescription] = useState("")
  const [category, setCategory] = useState("")
  const [triggerType, setTriggerType] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!address) {
      openConnectModal?.()
      return
    }
    if (description.length < 10) return

    setIsSubmitting(true)
    try {
      await api.createTemplateRequest(
        {
          description,
          category: category || undefined,
          triggerType: triggerType || undefined,
        },
        address,
      )
      toast.success("Template request submitted")
      setDescription("")
      setCategory("")
      setTriggerType("")
      onSubmitted?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit request")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="mb-3 text-sm font-semibold text-foreground">Request a Template</h3>
      <Textarea
        placeholder="Describe the automation you'd like..."
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="min-h-[80px] resize-none"
        maxLength={500}
      />
      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="sm:w-40">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="DeFi">DeFi</SelectItem>
            <SelectItem value="Finance">Finance</SelectItem>
            <SelectItem value="Security">Security</SelectItem>
            <SelectItem value="AI">AI</SelectItem>
            <SelectItem value="Infrastructure">Infrastructure</SelectItem>
            <SelectItem value="Utility">Utility</SelectItem>
          </SelectContent>
        </Select>
        <Select value={triggerType} onValueChange={setTriggerType}>
          <SelectTrigger className="sm:w-40">
            <SelectValue placeholder="Trigger type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cron">Scheduled</SelectItem>
            <SelectItem value="http">On-demand</SelectItem>
            <SelectItem value="evm_log">Event-driven</SelectItem>
          </SelectContent>
        </Select>
        <Button
          onClick={handleSubmit}
          disabled={description.length < 10 || isSubmitting}
          className="sm:ml-auto"
        >
          {isSubmitting ? "Submitting..." : "Submit Request"}
        </Button>
      </div>
    </div>
  )
}
