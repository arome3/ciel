"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import type { UserSettings } from "@/lib/api"

interface NotificationSettingsProps {
  settings: UserSettings
  onChange: (partial: Partial<UserSettings>) => void
  onSave: () => void
  isSaving: boolean
}

export function NotificationSettings({ settings, onChange, onSave, isSaving }: NotificationSettingsProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="webhook-url">Webhook URL</Label>
        <Input
          id="webhook-url"
          type="url"
          placeholder="https://hooks.example.com/ciel"
          value={settings.webhookUrl ?? ""}
          onChange={(e) => onChange({ webhookUrl: e.target.value || null })}
        />
        <p className="text-xs text-muted-foreground">
          Receive POST notifications for workflow events at this URL
        </p>
      </div>

      <div className="space-y-3">
        <Label>Notify on</Label>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={settings.notifyDeployFail}
              onCheckedChange={(v) => onChange({ notifyDeployFail: !!v })}
            />
            Deploy failure
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={settings.notifyExecFail}
              onCheckedChange={(v) => onChange({ notifyExecFail: !!v })}
            />
            Execution failure
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={settings.notifyExecSuccess}
              onCheckedChange={(v) => onChange({ notifyExecSuccess: !!v })}
            />
            Successful execution
          </label>
        </div>
      </div>

      <Button onClick={onSave} disabled={isSaving}>
        {isSaving ? "Saving..." : "Save Changes"}
      </Button>
    </div>
  )
}
