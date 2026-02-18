import { describe, test, expect } from "bun:test"
import { validateWorkflow, type ValidationResult } from "../services/ai-engine/code-validator"

// ─────────────────────────────────────────────
// Test Fixtures
// ─────────────────────────────────────────────

/** A valid CRE workflow that passes all 6 checks */
const VALID_WORKFLOW = `
import { z } from "zod"
import {
  Runner,
  Runtime,
  CronCapability,
  HTTPClient,
  handler,
  consensusMedianAggregation,
} from "@chainlink/cre-sdk"

const configSchema = z.object({
  apiUrl: z.string(),
  threshold: z.number(),
})

type Config = z.infer<typeof configSchema>

const runner = Runner.newRunner<Config>({ configSchema })

function initWorkflow(runtime: Runtime<Config>) {
  const cronTrigger = new CronCapability().trigger({
    cronSchedule: runtime.config.cronSchedule,
  })

  const httpClient = new HTTPClient()

  handler(cronTrigger, (rt) => {
    const resp = httpClient.fetch(rt.config.apiUrl, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    }).result()

    const data = JSON.parse(resp.body)
    const price = data.price as number

    if (price < rt.config.threshold) {
      return { alert: true, price }
    }

    return { alert: false, price }
  })

  consensusMedianAggregation({
    fields: ["price"],
    reportId: "price_monitor",
  })
}

export function main() {
  runner.run(initWorkflow)
}
`

/** Workflow with async handler — should fail check 2 */
const ASYNC_HANDLER_WORKFLOW = `
import { z } from "zod"
import { Runner, Runtime, CronCapability, HTTPClient, handler } from "@chainlink/cre-sdk"

const configSchema = z.object({ apiUrl: z.string() })
type Config = z.infer<typeof configSchema>
const runner = Runner.newRunner<Config>({ configSchema })

function initWorkflow(runtime: Runtime<Config>) {
  const cron = new CronCapability().trigger({ cronSchedule: "0 */5 * * * *" })
  const http = new HTTPClient()

  handler(cron, async (rt) => {
    const resp = await http.fetch(rt.config.apiUrl).result()
    return JSON.parse(resp.body)
  })
}

export function main() { runner.run(initWorkflow) }
`

/** Workflow with unauthorized import — should fail check 1 */
const BAD_IMPORT_WORKFLOW = `
import { z } from "zod"
import { Runner, Runtime, CronCapability, handler } from "@chainlink/cre-sdk"
import axios from "axios"

const configSchema = z.object({ apiUrl: z.string() })
type Config = z.infer<typeof configSchema>
const runner = Runner.newRunner<Config>({ configSchema })

function initWorkflow(runtime: Runtime<Config>) {
  const cron = new CronCapability().trigger({ cronSchedule: "0 */5 * * * *" })

  handler(cron, (rt) => {
    return { value: rt.config.apiUrl }
  })
}

export function main() { runner.run(initWorkflow) }
`

/** Workflow missing Runner.newRunner — should fail check 3 */
const NO_RUNNER_WORKFLOW = `
import { z } from "zod"
import { Runtime, CronCapability, HTTPClient, handler } from "@chainlink/cre-sdk"

const configSchema = z.object({ apiUrl: z.string() })

function initWorkflow(runtime: Runtime<any>) {
  const cron = new CronCapability().trigger({ cronSchedule: "0 */5 * * * *" })
  const http = new HTTPClient()

  handler(cron, (rt) => {
    const resp = http.fetch(rt.config.apiUrl).result()
    return JSON.parse(resp.body)
  })
}

export function main() { initWorkflow(null as any) }
`

/** Workflow missing export main() — should fail check 4 */
const NO_EXPORT_MAIN_WORKFLOW = `
import { z } from "zod"
import { Runner, Runtime, CronCapability, HTTPClient, handler } from "@chainlink/cre-sdk"

const configSchema = z.object({ apiUrl: z.string() })
type Config = z.infer<typeof configSchema>
const runner = Runner.newRunner<Config>({ configSchema })

function initWorkflow(runtime: Runtime<Config>) {
  const cron = new CronCapability().trigger({ cronSchedule: "0 */5 * * * *" })
  const http = new HTTPClient()

  handler(cron, (rt) => {
    const resp = http.fetch(rt.config.apiUrl).result()
    return JSON.parse(resp.body)
  })
}

function main() { runner.run(initWorkflow) }
`

/** Workflow missing handler() — should fail check 5 */
const NO_HANDLER_WORKFLOW = `
import { z } from "zod"
import { Runner, Runtime, CronCapability } from "@chainlink/cre-sdk"

const configSchema = z.object({ apiUrl: z.string() })
type Config = z.infer<typeof configSchema>
const runner = Runner.newRunner<Config>({ configSchema })

function initWorkflow(runtime: Runtime<Config>) {
  const cron = new CronCapability().trigger({ cronSchedule: "0 */5 * * * *" })
  // Missing handler wiring!
  return { trigger: cron }
}

export function main() { runner.run(initWorkflow) }
`

/** Workflow using deprecated getConfig() — should fail check 6 */
const GETCONFIG_WORKFLOW = `
import { z } from "zod"
import { Runner, Runtime, CronCapability, HTTPClient, handler } from "@chainlink/cre-sdk"

const configSchema = z.object({ apiUrl: z.string() })
type Config = z.infer<typeof configSchema>
const runner = Runner.newRunner<Config>({ configSchema })

function initWorkflow(runtime: Runtime<Config>) {
  const cron = new CronCapability().trigger({ cronSchedule: "0 */5 * * * *" })
  const http = new HTTPClient()

  handler(cron, (rt) => {
    const url = rt.getConfig("apiUrl")
    const resp = http.fetch(url).result()
    return JSON.parse(resp.body)
  })
}

export function main() { runner.run(initWorkflow) }
`

// ─────────────────────────────────────────────
// Suite 1: Full Validation (happy path)
// ─────────────────────────────────────────────

describe("validateWorkflow — valid code", () => {
  test("valid workflow passes all 6 checks", () => {
    const result = validateWorkflow(VALID_WORKFLOW)
    expect(result.valid).toBe(true)
    expect(result.score).toBe(6)
    expect(result.issues.filter((i) => i.severity === "error")).toHaveLength(0)
  })

  test("score is exactly 6 for valid code", () => {
    const result = validateWorkflow(VALID_WORKFLOW)
    expect(result.score).toBe(6)
  })

  test("may have warnings but zero errors", () => {
    const result = validateWorkflow(VALID_WORKFLOW)
    const errors = result.issues.filter((i) => i.severity === "error")
    expect(errors).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────
// Suite 2: Check 1 — Import Whitelist
// ─────────────────────────────────────────────

describe("Check 1: import whitelist", () => {
  test("rejects unauthorized imports", () => {
    const result = validateWorkflow(BAD_IMPORT_WORKFLOW)
    const importErrors = result.issues.filter(
      (i) => i.check === "import-whitelist" && i.severity === "error",
    )
    expect(importErrors.length).toBeGreaterThanOrEqual(1)
    expect(importErrors[0].message).toContain("axios")
  })

  test("allows @chainlink/cre-sdk import", () => {
    const result = validateWorkflow(VALID_WORKFLOW)
    const importErrors = result.issues.filter((i) => i.check === "import-whitelist")
    expect(importErrors).toHaveLength(0)
  })

  test("allows viem subpath imports", () => {
    const code = VALID_WORKFLOW.replace(
      'import { z } from "zod"',
      'import { z } from "zod"\nimport { encodeAbiParameters } from "viem"',
    )
    const result = validateWorkflow(code)
    const importErrors = result.issues.filter((i) => i.check === "import-whitelist")
    expect(importErrors).toHaveLength(0)
  })

  test("rejects multiple unauthorized imports", () => {
    const code = `
import { z } from "zod"
import { Runner, handler } from "@chainlink/cre-sdk"
import axios from "axios"
import fs from "fs"
import path from "path"

const configSchema = z.object({ x: z.string() })
const runner = Runner.newRunner({ configSchema })
function init(rt: any) { handler(null, (r) => { return { v: r.config.x } }) }
export function main() { runner.run(init) }
`
    const result = validateWorkflow(code)
    const importErrors = result.issues.filter(
      (i) => i.check === "import-whitelist" && i.severity === "error",
    )
    expect(importErrors.length).toBe(3) // axios, fs, path
  })
})

// ─────────────────────────────────────────────
// Suite 3: Check 2 — No async/await in handlers
// ─────────────────────────────────────────────

describe("Check 2: no async in handlers", () => {
  test("rejects async handler callback", () => {
    const result = validateWorkflow(ASYNC_HANDLER_WORKFLOW)
    const asyncErrors = result.issues.filter(
      (i) => i.check === "no-async-handlers" && i.severity === "error",
    )
    expect(asyncErrors.length).toBeGreaterThanOrEqual(1)
  })

  test("valid workflow has no async handler errors", () => {
    const result = validateWorkflow(VALID_WORKFLOW)
    const asyncErrors = result.issues.filter((i) => i.check === "no-async-handlers")
    expect(asyncErrors).toHaveLength(0)
  })

  test("detects await inside handler block", () => {
    const result = validateWorkflow(ASYNC_HANDLER_WORKFLOW)
    const awaitErrors = result.issues.filter(
      (i) => i.check === "no-async-handlers" && i.message.includes("await"),
    )
    expect(awaitErrors.length).toBeGreaterThanOrEqual(1)
  })
})

// ─────────────────────────────────────────────
// Suite 4: Check 3 — Runner.newRunner pattern
// ─────────────────────────────────────────────

describe("Check 3: Runner.newRunner pattern", () => {
  test("rejects code without Runner.newRunner", () => {
    const result = validateWorkflow(NO_RUNNER_WORKFLOW)
    const runnerErrors = result.issues.filter(
      (i) => i.check === "runner-pattern" && i.severity === "error",
    )
    expect(runnerErrors.length).toBeGreaterThanOrEqual(1)
    expect(runnerErrors[0].message).toContain("Runner.newRunner")
  })

  test("valid workflow passes runner check", () => {
    const result = validateWorkflow(VALID_WORKFLOW)
    const runnerErrors = result.issues.filter(
      (i) => i.check === "runner-pattern" && i.severity === "error",
    )
    expect(runnerErrors).toHaveLength(0)
  })

  test("warns when configSchema is missing", () => {
    const code = `
import { Runner, handler } from "@chainlink/cre-sdk"
import { z } from "zod"
const runner = Runner.newRunner({ configSchema: z.object({}) })
function init(rt: any) { handler(null, (r) => { return { v: r.config.x } }) }
export function main() { runner.run(init) }
`
    const result = validateWorkflow(code)
    const warnings = result.issues.filter(
      (i) => i.check === "runner-pattern" && i.severity === "warning",
    )
    // Should warn about missing `const configSchema = z.` pattern
    expect(warnings.length).toBeGreaterThanOrEqual(1)
  })
})

// ─────────────────────────────────────────────
// Suite 5: Check 4 — export main()
// ─────────────────────────────────────────────

describe("Check 4: export main()", () => {
  test("rejects code without export main", () => {
    const result = validateWorkflow(NO_EXPORT_MAIN_WORKFLOW)
    const mainErrors = result.issues.filter(
      (i) => i.check === "export-main" && i.severity === "error",
    )
    expect(mainErrors).toHaveLength(1)
    expect(mainErrors[0].message).toContain("export function main()")
  })

  test("valid workflow passes export main check", () => {
    const result = validateWorkflow(VALID_WORKFLOW)
    const mainErrors = result.issues.filter((i) => i.check === "export-main")
    expect(mainErrors).toHaveLength(0)
  })

  test("accepts export const main = arrow function", () => {
    const code = `
import { z } from "zod"
import { Runner, handler } from "@chainlink/cre-sdk"
const configSchema = z.object({ x: z.string() })
const runner = Runner.newRunner({ configSchema })
function init(rt: any) { handler(null, (r) => { return { v: r.config.x } }) }
export const main = () => { runner.run(init) }
`
    const result = validateWorkflow(code)
    const mainErrors = result.issues.filter(
      (i) => i.check === "export-main" && i.severity === "error",
    )
    expect(mainErrors).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────
// Suite 6: Check 5 — handler() wiring
// ─────────────────────────────────────────────

describe("Check 5: handler() wiring", () => {
  test("rejects code without handler()", () => {
    const result = validateWorkflow(NO_HANDLER_WORKFLOW)
    const handlerErrors = result.issues.filter(
      (i) => i.check === "handler-wiring" && i.severity === "error",
    )
    expect(handlerErrors).toHaveLength(1)
    expect(handlerErrors[0].message).toContain("handler(trigger, callback)")
  })

  test("valid workflow passes handler check", () => {
    const result = validateWorkflow(VALID_WORKFLOW)
    const handlerErrors = result.issues.filter((i) => i.check === "handler-wiring")
    expect(handlerErrors).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────
// Suite 7: Check 6 — runtime.config access
// ─────────────────────────────────────────────

describe("Check 6: config access", () => {
  test("rejects deprecated getConfig() usage", () => {
    const result = validateWorkflow(GETCONFIG_WORKFLOW)
    const configErrors = result.issues.filter(
      (i) => i.check === "config-access" && i.severity === "error",
    )
    expect(configErrors.length).toBeGreaterThanOrEqual(1)
    expect(configErrors[0].message).toContain("getConfig")
  })

  test("valid workflow passes config access check", () => {
    const result = validateWorkflow(VALID_WORKFLOW)
    const configErrors = result.issues.filter(
      (i) => i.check === "config-access" && i.severity === "error",
    )
    expect(configErrors).toHaveLength(0)
  })

  test("warns when no runtime.config.* usage found", () => {
    const code = `
import { z } from "zod"
import { Runner, handler } from "@chainlink/cre-sdk"
const configSchema = z.object({ x: z.string() })
const runner = Runner.newRunner({ configSchema })
function init(rt: any) { handler(null, (r) => { return { value: 42 } }) }
export function main() { runner.run(init) }
`
    const result = validateWorkflow(code)
    const warnings = result.issues.filter(
      (i) => i.check === "config-access" && i.severity === "warning",
    )
    expect(warnings.length).toBeGreaterThanOrEqual(1)
  })
})

// ─────────────────────────────────────────────
// Suite 8: Score Calculation
// ─────────────────────────────────────────────

describe("score calculation", () => {
  test("valid code scores 6/6", () => {
    const result = validateWorkflow(VALID_WORKFLOW)
    expect(result.score).toBe(6)
  })

  test("one failing check reduces score to 5", () => {
    const result = validateWorkflow(BAD_IMPORT_WORKFLOW)
    expect(result.score).toBe(5)
    expect(result.valid).toBe(false)
  })

  test("multiple failing checks reduce score accordingly", () => {
    // This workflow fails: no runner, no export main, no handler, no config access
    const code = `
import { z } from "zod"
import { Runtime } from "@chainlink/cre-sdk"
const configSchema = z.object({ apiUrl: z.string() })
function doStuff() { return 42 }
`
    const result = validateWorkflow(code)
    expect(result.score).toBeLessThanOrEqual(3)
    expect(result.valid).toBe(false)
  })

  test("empty string fails structural checks", () => {
    const result = validateWorkflow("")
    expect(result.valid).toBe(false)
    expect(result.score).toBe(3)
    // Passes: import-whitelist (no imports = no violations),
    //         no-async (no handlers = no async),
    //         config-access (no getConfig = no error, just warning)
    // Fails: runner-pattern, export-main, handler-wiring
  })

  test("warnings do not reduce score", () => {
    // Code with a warning (no rt.config usage) but no errors
    const code = `
import { z } from "zod"
import { Runner, handler } from "@chainlink/cre-sdk"
const configSchema = z.object({ x: z.string() })
const runner = Runner.newRunner({ configSchema })
function init(rt: any) { handler(null, (r) => { return { value: 42 } }) }
export function main() { runner.run(init) }
`
    const result = validateWorkflow(code)
    // Should be valid (warnings don't block)
    expect(result.valid).toBe(true)
    expect(result.score).toBe(6)
  })
})

// ─────────────────────────────────────────────
// Suite 9: Edge Cases
// ─────────────────────────────────────────────

describe("edge cases", () => {
  test("handles code with template literals containing braces", () => {
    const code = `
import { z } from "zod"
import { Runner, Runtime, CronCapability, HTTPClient, handler } from "@chainlink/cre-sdk"
const configSchema = z.object({ apiUrl: z.string() })
type Config = z.infer<typeof configSchema>
const runner = Runner.newRunner<Config>({ configSchema })
function initWorkflow(runtime: Runtime<Config>) {
  const cron = new CronCapability().trigger({ cronSchedule: "0 */5 * * * *" })
  const http = new HTTPClient()
  handler(cron, (rt) => {
    const msg = "result: " + JSON.stringify({ a: 1, b: 2 })
    const resp = http.fetch(rt.config.apiUrl).result()
    return JSON.parse(resp.body)
  })
}
export function main() { runner.run(initWorkflow) }
`
    const result = validateWorkflow(code)
    expect(result.valid).toBe(true)
  })

  test("handles multiple handler() calls", () => {
    const code = `
import { z } from "zod"
import { Runner, Runtime, CronCapability, HTTPClient, handler } from "@chainlink/cre-sdk"
const configSchema = z.object({ apiUrl: z.string(), backupUrl: z.string() })
type Config = z.infer<typeof configSchema>
const runner = Runner.newRunner<Config>({ configSchema })
function initWorkflow(runtime: Runtime<Config>) {
  const cron1 = new CronCapability().trigger({ cronSchedule: "0 */5 * * * *" })
  const cron2 = new CronCapability().trigger({ cronSchedule: "0 */10 * * * *" })
  const http = new HTTPClient()
  handler(cron1, (rt) => {
    const resp = http.fetch(rt.config.apiUrl).result()
    return JSON.parse(resp.body)
  })
  handler(cron2, (rt) => {
    const resp = http.fetch(rt.config.backupUrl).result()
    return JSON.parse(resp.body)
  })
}
export function main() { runner.run(initWorkflow) }
`
    const result = validateWorkflow(code)
    expect(result.valid).toBe(true)
  })

  test("detects mixed violations (multiple checks fail)", () => {
    const code = `
import { z } from "zod"
import { Runtime, CronCapability, HTTPClient, handler } from "@chainlink/cre-sdk"
import lodash from "lodash"

function initWorkflow(runtime: Runtime<any>) {
  const cron = new CronCapability().trigger({ cronSchedule: "0 */5 * * * *" })
  const http = new HTTPClient()
  handler(cron, async (rt) => {
    const url = rt.getConfig("apiUrl")
    const resp = await http.fetch(url).result()
    return JSON.parse(resp.body)
  })
}

function main() { initWorkflow(null as any) }
`
    const result = validateWorkflow(code)
    expect(result.valid).toBe(false)

    const checksFailed = new Set(
      result.issues
        .filter((i) => i.severity === "error")
        .map((i) => i.check),
    )

    // Should fail: import-whitelist (lodash), no-async-handlers, runner-pattern,
    // export-main, config-access (getConfig)
    expect(checksFailed.has("import-whitelist")).toBe(true)
    expect(checksFailed.has("no-async-handlers")).toBe(true)
    expect(checksFailed.has("runner-pattern")).toBe(true)
    expect(checksFailed.has("export-main")).toBe(true)
    expect(checksFailed.has("config-access")).toBe(true)
  })
})
