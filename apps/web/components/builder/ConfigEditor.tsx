"use client"

import { useMemo } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useWorkflowStore } from "@/lib/store"

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

/** camelCase → Title Case: "uniswapRouter" → "Uniswap Router" */
function toLabel(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase())
}

/** Detect placeholder values that need user input */
function isPlaceholder(value: unknown): boolean {
  if (value === "" || value === 0) return true
  if (typeof value === "string" && value === ZERO_ADDRESS) return true
  return false
}

type FieldType = "boolean" | "number" | "address" | "url" | "cron" | "text"

function inferFieldType(key: string, value: unknown): FieldType {
  if (typeof value === "boolean") return "boolean"
  if (typeof value === "number") return "number"
  const k = key.toLowerCase()
  if (
    (typeof value === "string" && value.startsWith("0x")) ||
    k.includes("address") ||
    k.includes("contract")
  ) return "address"
  if (k.includes("url") || k.includes("api")) return "url"
  if (k.includes("schedule") || k.includes("cron")) return "cron"
  return "text"
}

function placeholderFor(fieldType: FieldType): string {
  switch (fieldType) {
    case "address": return "0x..."
    case "url": return "https://..."
    case "cron": return "0 */5 * * * *"
    case "number": return "0"
    default: return ""
  }
}

interface FieldEntry {
  key: string
  value: unknown
  fieldType: FieldType
  needsInput: boolean
}

export function ConfigEditor() {
  const editedConfig = useWorkflowStore((s) => s.editedConfig)
  const updateConfigField = useWorkflowStore((s) => s.updateConfigField)

  const fields = useMemo<FieldEntry[]>(() => {
    if (!editedConfig) return []
    const entries = Object.entries(editedConfig).map(([key, value]) => {
      const fieldType = inferFieldType(key, value)
      return { key, value, fieldType, needsInput: isPlaceholder(value) }
    })
    // Sort: placeholder fields first
    return entries.sort((a, b) => (a.needsInput === b.needsInput ? 0 : a.needsInput ? -1 : 1))
  }, [editedConfig])

  if (!editedConfig || fields.length === 0) return null

  const placeholderCount = fields.filter((f) => f.needsInput).length

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Configuration</h3>
        <span className="text-[11px] text-muted-foreground">
          {fields.length} field{fields.length !== 1 && "s"}
          {placeholderCount > 0 && (
            <span className="text-amber-400"> · {placeholderCount} need input</span>
          )}
        </span>
      </div>

      <div className="space-y-3">
        {fields.map(({ key, value, fieldType, needsInput }) => (
          <div key={key} className="space-y-1">
            <Label htmlFor={`cfg-${key}`} className="flex items-center gap-1.5 text-xs">
              {needsInput && (
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" aria-label="Needs input" />
              )}
              {toLabel(key)}
            </Label>

            {fieldType === "boolean" ? (
              <button
                type="button"
                role="switch"
                aria-checked={!!value}
                onClick={() => updateConfigField(key, !value)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  value ? "bg-primary" : "bg-muted"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                    value ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            ) : (
              <Input
                id={`cfg-${key}`}
                type={fieldType === "number" ? "number" : "text"}
                value={value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value)}
                onChange={(e) => {
                  const raw = e.target.value
                  if (fieldType === "number") {
                    updateConfigField(key, raw === "" ? 0 : Number(raw))
                  } else if (typeof value === "object" && value !== null) {
                    try { updateConfigField(key, JSON.parse(raw)) } catch { updateConfigField(key, raw) }
                  } else {
                    updateConfigField(key, raw)
                  }
                }}
                placeholder={placeholderFor(fieldType)}
                className={`h-8 text-xs ${fieldType === "address" ? "font-mono" : ""}`}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
