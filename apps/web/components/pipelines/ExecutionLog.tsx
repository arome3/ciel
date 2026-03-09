"use client"

import { useEffect, useRef } from "react"
import { Terminal, ChevronDown, ChevronUp, Trash2, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { usePipelineBuilderStore, type ExecutionLogEntry } from "@/lib/pipeline-builder-store"
import { Button } from "@/components/ui/button"

function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }) +
    "." + String(d.getMilliseconds()).padStart(3, "0")
}

const LEVEL_STYLES: Record<ExecutionLogEntry["level"], { prefix: string; color: string }> = {
  info: { prefix: "INFO", color: "text-blue-400" },
  success: { prefix: " OK ", color: "text-green-400" },
  error: { prefix: "FAIL", color: "text-red-400" },
  warn: { prefix: "WARN", color: "text-yellow-400" },
}

export function ExecutionLog() {
  const executionLog = usePipelineBuilderStore((s) => s.executionLog)
  const isLogOpen = usePipelineBuilderStore((s) => s.isLogOpen)
  const toggleLog = usePipelineBuilderStore((s) => s.toggleLog)
  const clearLog = usePipelineBuilderStore((s) => s.clearLog)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    if (scrollRef.current && isLogOpen) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [executionLog.length, isLogOpen])

  if (executionLog.length === 0 && !isLogOpen) return null

  return (
    <div className={cn(
      "absolute bottom-0 left-0 right-0 z-30 flex flex-col border-t border-border bg-[#0d1117] transition-all duration-300",
      isLogOpen ? "h-48" : "h-8",
    )}>
      {/* Header bar */}
      <div
        className="flex h-8 shrink-0 cursor-pointer items-center gap-2 border-b border-border/50 px-3"
        onClick={toggleLog}
      >
        <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[11px] font-medium text-muted-foreground">
          Execution Log
        </span>
        {executionLog.length > 0 && (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
            {executionLog.length}
          </span>
        )}
        <div className="flex-1" />
        {isLogOpen && executionLog.length > 0 && (
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-muted-foreground hover:text-foreground"
            onClick={(e) => { e.stopPropagation(); clearLog() }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        )}
        {isLogOpen ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </div>

      {/* Log content */}
      {isLogOpen && (
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-1.5 font-mono text-[11px] leading-5"
        >
          {executionLog.length === 0 ? (
            <p className="text-muted-foreground/50">Waiting for execution...</p>
          ) : (
            executionLog.map((entry, i) => {
              const style = LEVEL_STYLES[entry.level]
              return (
                <div key={i} className="flex gap-2 whitespace-nowrap">
                  <span className="text-muted-foreground/50 shrink-0">
                    {formatTimestamp(entry.timestamp)}
                  </span>
                  <span className={cn("shrink-0 font-bold", style.color)}>
                    [{style.prefix}]
                  </span>
                  <span className="text-foreground/80 truncate">
                    {entry.message}
                  </span>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
