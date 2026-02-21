"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  usePipelineBuilderStore,
  type Connection,
  type FieldMapping,
  type PaletteWorkflow,
} from "@/lib/pipeline-builder-store"

interface FieldMapperProps {
  connection: Connection
  sourceWorkflow: PaletteWorkflow
  targetWorkflow: PaletteWorkflow
  open: boolean
  onOpenChange: (open: boolean) => void
}

const TYPE_COLORS: Record<string, string> = {
  string: "bg-blue-900/60 text-blue-300",
  number: "bg-green-900/60 text-green-300",
  boolean: "bg-yellow-900/60 text-yellow-300",
}

export function FieldMapper({
  connection,
  sourceWorkflow,
  targetWorkflow,
  open,
  onOpenChange,
}: FieldMapperProps) {
  const updateFieldMapping = usePipelineBuilderStore(
    (s) => s.updateFieldMapping,
  )
  const disconnectSteps = usePipelineBuilderStore((s) => s.disconnectSteps)

  const [mappings, setMappings] = useState<FieldMapping[]>(
    connection.fieldMappings,
  )

  const sourceFields = Object.entries(
    sourceWorkflow.outputSchema.properties ?? {},
  )
  const targetFields = Object.entries(
    targetWorkflow.inputSchema.properties ?? {},
  )
  const requiredFields = targetWorkflow.inputSchema.required ?? []

  function addMapping(sourceField: string, targetField: string) {
    // Don't add duplicates
    if (mappings.some((m) => m.targetField === targetField)) return
    setMappings([...mappings, { sourceField, targetField, confidence: 1 }])
  }

  function removeMapping(targetField: string) {
    setMappings(mappings.filter((m) => m.targetField !== targetField))
  }

  function handleSave() {
    updateFieldMapping(connection.id, mappings)
    onOpenChange(false)
  }

  function handleDisconnect() {
    disconnectSteps(connection.id)
    onOpenChange(false)
  }

  const mappedTargets = new Set(mappings.map((m) => m.targetField))
  const mappedSources = new Set(mappings.map((m) => m.sourceField))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {sourceWorkflow.name} → {targetWorkflow.name}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-6 pt-2">
          {/* Source outputs */}
          <div>
            <h4 className="mb-2 text-xs font-semibold text-muted-foreground">
              Source Output Fields
            </h4>
            <div className="space-y-1.5">
              {sourceFields.map(([name, field]) => (
                <div
                  key={name}
                  className={`flex items-center justify-between rounded-md border px-2.5 py-1.5 text-xs ${
                    mappedSources.has(name)
                      ? "border-primary/50 bg-primary/5"
                      : "border-border"
                  }`}
                >
                  <span className="font-mono text-foreground">{name}</span>
                  <Badge
                    variant="secondary"
                    className={`text-[10px] ${TYPE_COLORS[field.type] ?? ""}`}
                  >
                    {field.type}
                  </Badge>
                </div>
              ))}
            </div>
          </div>

          {/* Target inputs */}
          <div>
            <h4 className="mb-2 text-xs font-semibold text-muted-foreground">
              Target Input Fields
            </h4>
            <div className="space-y-1.5">
              {targetFields.map(([name, field]) => {
                const mapping = mappings.find((m) => m.targetField === name)
                const isRequired = requiredFields.includes(name)
                const isUnmatchedRequired = isRequired && !mapping

                return (
                  <div
                    key={name}
                    className={`flex items-center justify-between rounded-md border px-2.5 py-1.5 text-xs ${
                      isUnmatchedRequired
                        ? "border-red-500/50 bg-red-500/5"
                        : mapping
                          ? "border-primary/50 bg-primary/5"
                          : "border-border"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-foreground">{name}</span>
                      {isRequired && (
                        <span className="text-[10px] text-red-400">*</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Badge
                        variant="secondary"
                        className={`text-[10px] ${TYPE_COLORS[field.type] ?? ""}`}
                      >
                        {field.type}
                      </Badge>
                      {mapping ? (
                        <button
                          type="button"
                          onClick={() => removeMapping(name)}
                          className="text-[10px] text-red-400 hover:text-red-300"
                        >
                          ×
                        </button>
                      ) : (
                        <select
                          className="h-5 rounded border border-border bg-background px-1 text-[10px] text-foreground"
                          value=""
                          onChange={(e) => {
                            if (e.target.value) addMapping(e.target.value, name)
                          }}
                        >
                          <option value="">Map...</option>
                          {sourceFields
                            .filter(([, f]) => f.type === field.type)
                            .map(([sName]) => (
                              <option key={sName} value={sName}>
                                {sName}
                              </option>
                            ))}
                        </select>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Mapped connections summary */}
        {mappings.length > 0 && (
          <div className="mt-4 space-y-1">
            <h4 className="text-xs font-semibold text-muted-foreground">
              Mappings
            </h4>
            {mappings.map((m) => (
              <div
                key={m.targetField}
                className="flex items-center gap-2 text-xs text-foreground"
              >
                <span className="font-mono">{m.sourceField}</span>
                <span className="text-muted-foreground">→</span>
                <span className="font-mono">{m.targetField}</span>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {Math.round(m.confidence * 100)}%
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <Button variant="destructive" size="sm" onClick={handleDisconnect}>
            Disconnect
          </Button>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave}>
            Save Mappings
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
