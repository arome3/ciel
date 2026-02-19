import { describe, test, expect } from "bun:test"
import {
  parseSimulationOutput,
  toApiTrace,
  formatTraceForLog,
  type SimulationStep,
} from "../services/cre/parser"

// ─────────────────────────────────────────────
// Pattern Matching
// ─────────────────────────────────────────────

describe("parseSimulationOutput — pattern matching", () => {
  test("parses [TRIGGER] lines", () => {
    const result = parseSimulationOutput("[TRIGGER] Cron trigger fired at 2024-01-01T00:00:00Z")
    expect(result.executionTrace).toHaveLength(1)
    expect(result.executionTrace[0].capability).toBe("trigger")
    expect(result.executionTrace[0].action).toContain("Cron trigger fired")
  })

  test("parses [HTTP] lines with method and status", () => {
    const result = parseSimulationOutput("[HTTP] GET https://api.example.com/data -> 200")
    expect(result.executionTrace).toHaveLength(1)
    const step = result.executionTrace[0]
    expect(step.capability).toBe("HTTPClient")
    expect(step.data?.method).toBe("GET")
    expect(step.data?.url).toBe("https://api.example.com/data")
    expect(step.data?.statusCode).toBe(200)
  })

  test("parses [HTTPClient] lines", () => {
    const result = parseSimulationOutput("[HTTPClient] sendRequest -> 200")
    expect(result.executionTrace).toHaveLength(1)
    expect(result.executionTrace[0].capability).toBe("HTTPClient")
    expect(result.executionTrace[0].data?.statusCode).toBe(200)
  })

  test("parses [EVM] callContract lines", () => {
    const result = parseSimulationOutput("[EVM] callContract 0x1234 -> latestAnswer()")
    expect(result.executionTrace).toHaveLength(1)
    expect(result.executionTrace[0].capability).toBe("EVMClient")
    expect(result.executionTrace[0].data?.type).toBe("callContract")
  })

  test("parses [EVMClient] writeReport lines", () => {
    const result = parseSimulationOutput("[EVMClient] writeReport -> 0xabcd")
    expect(result.executionTrace).toHaveLength(1)
    expect(result.executionTrace[0].data?.type).toBe("writeReport")
  })

  test("parses [CONSENSUS] lines with aggregation type", () => {
    const result = parseSimulationOutput("[CONSENSUS] median aggregation -> 1850.50")
    expect(result.executionTrace).toHaveLength(1)
    expect(result.executionTrace[0].capability).toBe("consensus")
    expect(result.executionTrace[0].data?.aggregationType).toBe("median")
  })

  test("parses [NODE_MODE] lines", () => {
    const result = parseSimulationOutput("[NODE_MODE] Executing on node 1/3")
    expect(result.executionTrace).toHaveLength(1)
    expect(result.executionTrace[0].capability).toBe("runInNodeMode")
    expect(result.executionTrace[0].action).toContain("Executing on node 1/3")
  })

  test("numbers steps sequentially across different patterns", () => {
    const raw = [
      "[TRIGGER] Cron fired",
      "[HTTP] GET https://api.test.com -> 200",
      "[CONSENSUS] median -> 1000",
    ].join("\n")

    const result = parseSimulationOutput(raw)
    expect(result.executionTrace).toHaveLength(3)
    expect(result.executionTrace[0].step).toBe(1)
    expect(result.executionTrace[1].step).toBe(2)
    expect(result.executionTrace[2].step).toBe(3)
  })

  test("filters noise lines (bun, npm, installing, etc.)", () => {
    const raw = [
      "bun install v1.0.0",
      "npm WARN deprecated",
      "installing dependencies...",
      "resolving packages...",
      "done",
      "42 packages installed",
      "[TRIGGER] Cron fired",
    ].join("\n")

    const result = parseSimulationOutput(raw)
    expect(result.executionTrace).toHaveLength(1)
    expect(result.executionTrace[0].capability).toBe("trigger")
  })

  test("adds unrecognized meaningful lines as generic steps", () => {
    const result = parseSimulationOutput("Custom CRE output that is long enough to not be filtered")
    expect(result.executionTrace).toHaveLength(1)
    expect(result.executionTrace[0].capability).toBe("unknown")
    expect(result.executionTrace[0].data?.raw).toBeDefined()
  })

  test("returns empty trace for empty input", () => {
    const result = parseSimulationOutput("")
    expect(result.executionTrace).toHaveLength(0)
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })

  test("truncates generic step action at 200 characters", () => {
    const longLine = "x".repeat(300)
    const result = parseSimulationOutput(longLine)
    expect(result.executionTrace).toHaveLength(1)
    expect(result.executionTrace[0].action.length).toBe(200)
  })
})

// ─────────────────────────────────────────────
// Error / Warning Detection
// ─────────────────────────────────────────────

describe("parseSimulationOutput — error/warning detection", () => {
  test("extracts ERROR lines", () => {
    const result = parseSimulationOutput("ERROR: Something went wrong")
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toBe("Something went wrong")
  })

  test("extracts FATAL lines as errors", () => {
    const result = parseSimulationOutput("FATAL: Process crashed")
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toBe("Process crashed")
  })

  test("extracts FAILED lines as errors", () => {
    const result = parseSimulationOutput("FAILED: Compilation error")
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toBe("Compilation error")
  })

  test("extracts WARNING lines", () => {
    const result = parseSimulationOutput("WARNING: Deprecated function")
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toBe("Deprecated function")
  })

  test("does not double-count error inside a pattern line", () => {
    // A line matching [HTTP] that also contains "error" should be a step, not an error
    const result = parseSimulationOutput("[HTTP] GET https://api.test.com -> error 500")
    expect(result.errors).toHaveLength(0)
    expect(result.executionTrace).toHaveLength(1)
    expect(result.executionTrace[0].status).toBe("error")
  })

  test("handles mixed errors, warnings, and steps", () => {
    const raw = [
      "[TRIGGER] Cron fired",
      "WARNING: Rate limit approaching",
      "[HTTP] GET https://api.test.com -> 200",
      "ERROR: Timeout exceeded",
      "[EVM] callContract 0x1234",
    ].join("\n")

    const result = parseSimulationOutput(raw)
    expect(result.executionTrace).toHaveLength(3)
    expect(result.errors).toHaveLength(1)
    expect(result.warnings).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────
// Duration Extraction
// ─────────────────────────────────────────────

describe("parseSimulationOutput — duration extraction", () => {
  test("extracts duration in milliseconds", () => {
    const result = parseSimulationOutput("[HTTP] GET https://api.test.com -> 200 duration: 150ms")
    expect(result.executionTrace[0].duration).toBe(150)
  })

  test("converts seconds to milliseconds", () => {
    const result = parseSimulationOutput("[HTTP] GET https://api.test.com -> 200 took: 2.5 seconds")
    expect(result.executionTrace[0].duration).toBe(2500)
  })

  test("returns undefined duration when not present", () => {
    const result = parseSimulationOutput("[TRIGGER] Cron fired")
    expect(result.executionTrace[0].duration).toBeUndefined()
  })

  test("detects error status from line content", () => {
    const result = parseSimulationOutput("[HTTP] GET https://api.test.com -> error connection refused")
    expect(result.executionTrace[0].status).toBe("error")
  })

  test("detects skipped status from line content", () => {
    const result = parseSimulationOutput("[HTTP] GET https://api.test.com skipped due to config")
    expect(result.executionTrace[0].status).toBe("skipped")
  })
})

// ─────────────────────────────────────────────
// toApiTrace
// ─────────────────────────────────────────────

describe("toApiTrace", () => {
  test("maps SimulationStep[] to API trace shape", () => {
    const steps: SimulationStep[] = [
      {
        step: 1,
        action: "GET https://api.test.com",
        capability: "HTTPClient",
        status: "success",
        data: { method: "GET", url: "https://api.test.com" },
        duration: 150,
      },
    ]

    const result = toApiTrace(steps)
    expect(result).toHaveLength(1)
    expect(result[0].step).toBe("1. [HTTPClient] GET https://api.test.com")
    expect(result[0].status).toBe("success")
    expect(result[0].duration).toBe(150)
  })

  test("uses JSON.stringify for data output, action as fallback", () => {
    const withData: SimulationStep[] = [{
      step: 1,
      action: "test action",
      capability: "unknown",
      status: "success",
      data: { key: "value" },
    }]
    const withoutData: SimulationStep[] = [{
      step: 1,
      action: "test action",
      capability: "unknown",
      status: "success",
    }]

    expect(toApiTrace(withData)[0].output).toBe('{"key":"value"}')
    expect(toApiTrace(withoutData)[0].output).toBe("test action")
  })

  test("defaults duration to 0 when undefined", () => {
    const steps: SimulationStep[] = [{
      step: 1,
      action: "test",
      capability: "unknown",
      status: "success",
    }]
    expect(toApiTrace(steps)[0].duration).toBe(0)
  })
})

// ─────────────────────────────────────────────
// formatTraceForLog
// ─────────────────────────────────────────────

describe("formatTraceForLog", () => {
  test("formats trace steps with step number, capability, action, and status", () => {
    const steps: SimulationStep[] = [
      { step: 1, action: "Cron fired", capability: "trigger", status: "success" },
      { step: 2, action: "GET https://api.test.com", capability: "HTTPClient", status: "success" },
    ]

    const output = formatTraceForLog(steps)
    expect(output).toContain("[1] trigger: Cron fired (success)")
    expect(output).toContain("[2] HTTPClient: GET https://api.test.com (success)")
  })

  test("includes duration when present", () => {
    const steps: SimulationStep[] = [
      { step: 1, action: "Request", capability: "HTTPClient", status: "success", duration: 250 },
    ]

    const output = formatTraceForLog(steps)
    expect(output).toContain("250ms")
  })
})
