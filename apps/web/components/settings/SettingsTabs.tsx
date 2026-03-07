"use client"

import { useEffect, useState } from "react"
import { useAccount } from "wagmi"
import { useConnectModal } from "@rainbow-me/rainbowkit"
import { Settings, Wallet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { api, type UserSettings } from "@/lib/api"
import { toast } from "sonner"
import { GeneralSettings } from "./GeneralSettings"
import { WalletSettings } from "./WalletSettings"
import { NotificationSettings } from "./NotificationSettings"
import { GitHubSettings } from "./GitHubSettings"

const DEFAULT_SETTINGS: UserSettings = {
  ownerAddress: "",
  displayName: null,
  defaultChain: "base-sepolia",
  webhookUrl: null,
  notifyDeployFail: true,
  notifyExecFail: true,
  notifyExecSuccess: false,
}

export function SettingsTabs() {
  const { address } = useAccount()
  const { openConnectModal } = useConnectModal()
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!address) {
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    api
      .getSettings(address)
      .then((s) => setSettings(s))
      .catch(() => {})
      .finally(() => setIsLoading(false))
  }, [address])

  const handleChange = (partial: Partial<UserSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }))
  }

  const handleSave = async () => {
    if (!address) return
    setIsSaving(true)
    try {
      const updated = await api.updateSettings(settings, address)
      setSettings(updated)
      toast.success("Settings saved")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save settings")
    } finally {
      setIsSaving(false)
    }
  }

  if (!address) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-8">
        <header className="mb-10 animate-fade-up">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure your Ciel preferences
          </p>
        </header>
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 px-8 py-16 text-center animate-fade-up">
          <div className="mb-4 rounded-full bg-muted p-4">
            <Wallet className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">Connect your wallet</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Connect your wallet to access and configure your settings.
          </p>
          <Button className="mt-6" onClick={() => openConnectModal?.()}>
            Connect Wallet
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <header className="mb-8 animate-fade-up">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure your Ciel preferences
        </p>
      </header>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      ) : (
        <Tabs defaultValue="general" className="animate-fade-up" style={{ animationDelay: "50ms" }}>
          <TabsList className="mb-6">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="wallet">Wallet</TabsTrigger>
            <TabsTrigger value="notifications">Notifications</TabsTrigger>
            <TabsTrigger value="integrations">Integrations</TabsTrigger>
          </TabsList>

          <TabsContent value="general">
            <GeneralSettings
              settings={settings}
              onChange={handleChange}
              onSave={handleSave}
              isSaving={isSaving}
            />
          </TabsContent>

          <TabsContent value="wallet">
            <WalletSettings />
          </TabsContent>

          <TabsContent value="notifications">
            <NotificationSettings
              settings={settings}
              onChange={handleChange}
              onSave={handleSave}
              isSaving={isSaving}
            />
          </TabsContent>

          <TabsContent value="integrations">
            <GitHubSettings />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
