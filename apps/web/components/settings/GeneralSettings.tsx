"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import type { UserSettings } from "@/lib/api"

interface GeneralSettingsProps {
  settings: UserSettings
  onChange: (partial: Partial<UserSettings>) => void
  onSave: () => void
  isSaving: boolean
}

export function GeneralSettings({ settings, onChange, onSave, isSaving }: GeneralSettingsProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="display-name">Display Name</Label>
        <Input
          id="display-name"
          placeholder="Anonymous"
          value={settings.displayName ?? ""}
          onChange={(e) => onChange({ displayName: e.target.value || null })}
          maxLength={50}
        />
        <p className="text-xs text-muted-foreground">
          Shown alongside your workflows on the marketplace
        </p>
      </div>

      <div className="space-y-2">
        <Label>Default Chain</Label>
        <Select
          value={settings.defaultChain}
          onValueChange={(v) => onChange({ defaultChain: v })}
        >
          <SelectTrigger className="w-full sm:w-60">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="base-sepolia">Base Sepolia</SelectItem>
            <SelectItem value="base">Base</SelectItem>
            <SelectItem value="ethereum">Ethereum</SelectItem>
            <SelectItem value="arbitrum">Arbitrum</SelectItem>
            <SelectItem value="optimism">Optimism</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Button onClick={onSave} disabled={isSaving}>
        {isSaving ? "Saving..." : "Save Changes"}
      </Button>
    </div>
  )
}
