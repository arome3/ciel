// apps/api/src/services/cre/parser.ts

// --- Types ---

export interface SimulationStep {
  step: number
  action: string
  capability: string
  status: "success" | "error" | "skipped"
  data?: Record<string, unknown>
  duration?: number
}

export interface ParsedSimulationOutput {
  executionTrace: SimulationStep[]
  errors: string[]
  warnings: string[]
}

export interface SimulationResult {
  success: boolean
  executionTrace: SimulationStep[]
  duration: number
  errors: string[]
  warnings: string[]
  rawOutput: string
}

// --- Pattern Matchers ---

interface PatternMatcher {
  pattern: RegExp
  capability: string
  extractAction: (match: RegExpMatchArray, line: string) => string
  extractData?: (match: RegExpMatchArray, line: string) => Record<string, unknown> | undefined
}

const PATTERNS: PatternMatcher[] = [
  {
    // [TRIGGER] Cron trigger fired at 2024-01-01T00:00:00Z
    pattern: /\[TRIGGER\]\s*(.*)/i,
    capability: "trigger",
    extractAction: (match) => match[1]?.trim() || "Trigger fired",
    extractData: (match) => ({
      message: match[1]?.trim(),
    }),
  },
  {
    // [HTTP] GET https://api.example.com/data -> 200
    // [HTTPClient] sendRequest -> 200
    pattern: /\[HTTP(?:Client)?\]\s*(.*)/i,
    capability: "HTTPClient",
    extractAction: (match) => match[1]?.trim() || "HTTP request",
    extractData: (match) => {
      const text = match[1]?.trim() || ""
      const urlMatch = text.match(/(GET|POST|PUT|DELETE|PATCH)\s+(\S+)/)
      const statusMatch = text.match(/(?:->|status:?)\s*(\d{3})/)
      return {
        method: urlMatch?.[1],
        url: urlMatch?.[2],
        statusCode: statusMatch ? parseInt(statusMatch[1], 10) : undefined,
        message: text,
      }
    },
  },
  {
    // [EVM] callContract 0x1234... -> latestAnswer()
    // [EVMClient] writeReport -> 0x1234...
    pattern: /\[EVM(?:Client)?\]\s*(.*)/i,
    capability: "EVMClient",
    extractAction: (match) => match[1]?.trim() || "EVM operation",
    extractData: (match) => {
      const text = match[1]?.trim() || ""
      const isWrite = text.toLowerCase().includes("writereport")
      const isCall = text.toLowerCase().includes("callcontract")
      return {
        type: isWrite ? "writeReport" : isCall ? "callContract" : "unknown",
        message: text,
      }
    },
  },
  {
    // [CONSENSUS] median aggregation -> 1850.50
    pattern: /\[CONSENSUS\]\s*(.*)/i,
    capability: "consensus",
    extractAction: (match) => match[1]?.trim() || "Consensus aggregation",
    extractData: (match) => {
      const text = match[1]?.trim() || ""
      const typeMatch = text.match(/(mode|median|identical)/i)
      return {
        aggregationType: typeMatch?.[1]?.toLowerCase(),
        message: text,
      }
    },
  },
  {
    // [NODE_MODE] Executing on node 1/3
    pattern: /\[NODE_MODE\]\s*(.*)/i,
    capability: "runInNodeMode",
    extractAction: (match) => match[1]?.trim() || "Node-mode execution",
    extractData: (match) => ({
      message: match[1]?.trim(),
    }),
  },
]

// --- Error and Warning Patterns ---

const ERROR_PATTERN = /(?:ERROR|Error|FATAL|FAIL(?:ED)?)\s*:?\s*(.*)/i
const WARNING_PATTERN = /WARN(?:ING)?\s*:?\s*(.*)/i
const DURATION_PATTERN = /(?:duration|took|elapsed)\s*:?\s*(\d+(?:\.\d+)?)\s*(ms|s|seconds?|milliseconds?)/i

// --- Parser Function ---

export function parseSimulationOutput(raw: string): ParsedSimulationOutput {
  const lines = raw.split("\n").filter((line) => line.trim().length > 0)

  const executionTrace: SimulationStep[] = []
  const errors: string[] = []
  const warnings: string[] = []

  let stepNumber = 0

  for (const line of lines) {
    const trimmed = line.trim()

    // Check for errors first
    const errorMatch = trimmed.match(ERROR_PATTERN)
    if (errorMatch && !trimmed.match(/\[(TRIGGER|HTTP|EVM|CONSENSUS|NODE_MODE)\]/i)) {
      errors.push(errorMatch[1]?.trim() || trimmed)
      continue
    }

    // Check for warnings
    const warningMatch = trimmed.match(WARNING_PATTERN)
    if (warningMatch && !trimmed.match(/\[(TRIGGER|HTTP|EVM|CONSENSUS|NODE_MODE)\]/i)) {
      warnings.push(warningMatch[1]?.trim() || trimmed)
      continue
    }

    // Try to match against known CRE output patterns
    let matched = false

    for (const matcher of PATTERNS) {
      const match = trimmed.match(matcher.pattern)
      if (match) {
        stepNumber++

        // Extract duration if present in the line
        const durationMatch = trimmed.match(DURATION_PATTERN)
        let duration: number | undefined
        if (durationMatch) {
          const value = parseFloat(durationMatch[1])
          const unit = durationMatch[2].toLowerCase()
          duration =
            unit.startsWith("s") && !unit.startsWith("ms")
              ? value * 1000
              : value
        }

        // Determine status from line content
        let status: "success" | "error" | "skipped" = "success"
        if (/error|fail|exception/i.test(trimmed)) {
          status = "error"
        } else if (/skip|skipped/i.test(trimmed)) {
          status = "skipped"
        }

        const step: SimulationStep = {
          step: stepNumber,
          action: matcher.extractAction(match, trimmed),
          capability: matcher.capability,
          status,
          data: matcher.extractData?.(match, trimmed),
          duration,
        }

        executionTrace.push(step)
        matched = true
        break
      }
    }

    // If no pattern matched and the line looks meaningful, add as generic step
    if (!matched && trimmed.length > 10 && !trimmed.startsWith("//")) {
      // Skip common noise lines
      const noisePatterns = [
        /^bun /i,
        /^npm /i,
        /^installing/i,
        /^resolving/i,
        /^done\s*$/i,
        /^\d+ packages/i,
      ]

      const isNoise = noisePatterns.some((p) => p.test(trimmed))
      if (!isNoise) {
        stepNumber++
        executionTrace.push({
          step: stepNumber,
          action: trimmed.slice(0, 200),
          capability: "unknown",
          status: "success",
          data: { raw: trimmed },
        })
      }
    }
  }

  return {
    executionTrace,
    errors,
    warnings,
  }
}

// --- Map Internal Trace -> API Response Shape ---
// SimulateResponse.trace uses a flat { step, status, duration, output } shape.
// The parser's internal SimulationStep is richer (capability, data, action).
// This function bridges the two.

export function toApiTrace(
  trace: SimulationStep[]
): Array<{ step: string; status: string; duration: number; output: string }> {
  return trace.map((s) => ({
    step: `${s.step}. [${s.capability}] ${s.action}`,
    status: s.status,
    duration: s.duration ?? 0,
    output: s.data ? JSON.stringify(s.data) : s.action,
  }))
}

// --- Utility: Format Trace for Logging ---

export function formatTraceForLog(trace: SimulationStep[]): string {
  return trace
    .map(
      (step) =>
        `  [${step.step}] ${step.capability}: ${step.action} (${step.status})` +
        (step.duration ? ` ${step.duration}ms` : "")
    )
    .join("\n")
}
