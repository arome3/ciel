import { describe, test, expect } from "bun:test"
import { validateWorkflow, quickFix } from "../services/ai-engine/validator"

// ─────────────────────────────────────────────
// Test Fixtures
// ─────────────────────────────────────────────

/** Minimal valid CRE workflow that passes all 6 checks */
const VALID_CODE = `
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
  cronSchedule: z.string().default("0 */5 * * * *"),
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
    const price: number = data.price

    return { price: Math.round(price * 1e8), alert: price < rt.config.threshold }
  })

  consensusMedianAggregation({
    fields: ["price"],
    reportId: "test_monitor",
  })
}

export async function main() {
  runner.run(initWorkflow)
}
`

const VALID_CONFIG = JSON.stringify({
  apiUrl: "https://api.coingecko.com/api/v3/simple/price",
  threshold: 3000,
  cronSchedule: "0 */5 * * * *",
})

// ─────────────────────────────────────────────
// Suite 1: Validation — Happy Path
// ─────────────────────────────────────────────

describe("validateWorkflow — valid code", () => {
  test("valid code passes all checks", async () => {
    const result = await validateWorkflow(VALID_CODE, VALID_CONFIG)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────
// Suite 2: Check (a) — Import Whitelist
// ─────────────────────────────────────────────

describe("Check (a): import whitelist", () => {
  test("forbidden ESM import caught with [IMPORT] prefix", async () => {
    const code = `import axios from "axios"\n` + VALID_CODE
    const result = await validateWorkflow(code, VALID_CONFIG)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.startsWith("[IMPORT]") && e.includes("axios"))).toBe(true)
  })

  test("forbidden CJS require caught with [IMPORT] prefix", async () => {
    const code = `const axios = require("axios")\n` + VALID_CODE
    const result = await validateWorkflow(code, VALID_CONFIG)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.startsWith("[IMPORT]") && e.includes("require"))).toBe(true)
  })

  test("multiple forbidden imports all caught", async () => {
    const code = `import axios from "axios"\nconst fs = require("fs")\n` + VALID_CODE
    const result = await validateWorkflow(code, VALID_CONFIG)
    const importErrors = result.errors.filter((e) => e.startsWith("[IMPORT]"))
    expect(importErrors.length).toBe(2)
  })

  test("allowed imports pass (cre-sdk, zod, viem)", async () => {
    const code = VALID_CODE.replace(
      'import { z } from "zod"',
      'import { z } from "zod"\nimport { parseAbi } from "viem"',
    )
    const result = await validateWorkflow(code, VALID_CONFIG)
    const importErrors = result.errors.filter((e) => e.startsWith("[IMPORT]"))
    expect(importErrors).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────
// Suite 3: Check (b) — No Async Callbacks
// ─────────────────────────────────────────────

describe("Check (b): no async callbacks", () => {
  test("async handler callback caught (parameter-name agnostic)", async () => {
    // Uses 'ctx' not 'rt' — must still be caught
    const code = VALID_CODE.replace(
      "handler(cronTrigger, (rt) => {",
      "handler(cronTrigger, async (ctx) => {",
    ).replace(/\brt\./g, "ctx.")
    const result = await validateWorkflow(code, VALID_CONFIG)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.startsWith("[ASYNC]"))).toBe(true)
  })

  test("await inside handler caught even without async keyword", async () => {
    const code = VALID_CODE.replace(
      "const resp = httpClient.fetch(rt.config.apiUrl, {",
      "const resp = await httpClient.fetch(rt.config.apiUrl, {",
    )
    const result = await validateWorkflow(code, VALID_CONFIG)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.startsWith("[ASYNC]") && e.includes("await"))).toBe(true)
  })

  test(".then(async) pattern caught", async () => {
    const code = VALID_CODE.replace(
      "return { price: Math.round(price * 1e8), alert: price < rt.config.threshold }",
      "return Promise.resolve(42).then(async (x) => x)",
    )
    const result = await validateWorkflow(code, VALID_CONFIG)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.startsWith("[ASYNC]") && e.includes(".then"))).toBe(true)
  })

  test("export async function main() is NOT flagged", async () => {
    // VALID_CODE already has `export async function main()` — should not trigger [ASYNC]
    const result = await validateWorkflow(VALID_CODE, VALID_CONFIG)
    expect(result.errors.some((e) => e.startsWith("[ASYNC]"))).toBe(false)
  })
})

// ─────────────────────────────────────────────
// Suite 4: Check (c) — main() Export
// ─────────────────────────────────────────────

describe("Check (c): main() export", () => {
  test("missing export caught with [MAIN] prefix", async () => {
    const code = VALID_CODE.replace("export async function main()", "async function main()")
    const result = await validateWorkflow(code, VALID_CONFIG)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.startsWith("[MAIN]"))).toBe(true)
  })
})

// ─────────────────────────────────────────────
// Suite 5: Check (d) — Zod configSchema
// ─────────────────────────────────────────────

describe("Check (d): Zod configSchema", () => {
  test("missing z.object() caught with [ZOD] prefix", async () => {
    const code = VALID_CODE.replace("z.object(", "zObject(")
    const result = await validateWorkflow(code, VALID_CONFIG)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.startsWith("[ZOD]"))).toBe(true)
  })

  test("z.object in a comment does NOT satisfy the check", async () => {
    // Replace the actual z.object call but leave a comment containing it
    const code = VALID_CODE
      .replace("const configSchema = z.object({", "// configSchema should use z.object(\nconst configSchema = zObject({")
    const result = await validateWorkflow(code, VALID_CONFIG)
    expect(result.errors.some((e) => e.startsWith("[ZOD]"))).toBe(true)
  })
})

// ─────────────────────────────────────────────
// Suite 6: Check (e) — TypeScript Compilation
// ─────────────────────────────────────────────

describe("Check (e): TypeScript compilation", () => {
  test("type error caught with [TSC] prefix", async () => {
    const code = VALID_CODE.replace(
      "const price: number = data.price",
      "const price: number = data.price\n    const broken: string = 42",
    )
    const result = await validateWorkflow(code, VALID_CONFIG)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.startsWith("[TSC]"))).toBe(true)
  }, 30_000)

  test("non-existent API method caught by typed stubs", async () => {
    const code = VALID_CODE.replace(
      "const resp = httpClient.fetch(",
      "const bad = httpClient.nonExistentMethod()\n    const resp = httpClient.fetch(",
    )
    const result = await validateWorkflow(code, VALID_CONFIG)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.startsWith("[TSC]") && e.includes("nonExistentMethod"))).toBe(true)
  }, 30_000)
})

// ─────────────────────────────────────────────
// Suite 7: Check (f) — Config JSON
// ─────────────────────────────────────────────

describe("Check (f): config JSON validity", () => {
  test("invalid JSON caught with [CONFIG]", async () => {
    const result = await validateWorkflow(VALID_CODE, "not json")
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.startsWith("[CONFIG]"))).toBe(true)
  })

  test("EVM code without chain config caught", async () => {
    const evmCode = VALID_CODE.replace(
      "return { price: Math.round(price * 1e8), alert: price < rt.config.threshold }",
      "EVMClient.callContract({ contractAddress: '0x0', calldata: '0x' })\n    return { price: 0 }",
    )
    const configNoChain = JSON.stringify({ apiUrl: "https://example.com" })
    const result = await validateWorkflow(evmCode, configNoChain)
    expect(result.errors.some((e) => e.startsWith("[CONFIG]") && e.includes("EVMClient"))).toBe(true)
  })

  test("CronCapability usage without schedule config caught", async () => {
    const configNoSchedule = JSON.stringify({ apiUrl: "https://example.com", threshold: 3000 })
    const result = await validateWorkflow(VALID_CODE, configNoSchedule)
    expect(result.errors.some((e) => e.startsWith("[CONFIG]") && e.includes("schedule"))).toBe(true)
  })

  test("HTTPClient usage without URL config caught", async () => {
    const configNoUrl = JSON.stringify({ threshold: 3000, cronSchedule: "0 */5 * * * *" })
    const result = await validateWorkflow(VALID_CODE, configNoUrl)
    expect(result.errors.some((e) => e.startsWith("[CONFIG]") && e.includes("URL"))).toBe(true)
  })
})

// ─────────────────────────────────────────────
// Suite 8: quickFix — Deterministic Auto-Repair
// ─────────────────────────────────────────────

describe("quickFix — deterministic auto-repair", () => {
  test("removes forbidden ESM imports", () => {
    const code = `import axios from "axios"\nimport { z } from "zod"\nconsole.log("hi")`
    const { code: fixed, fixes } = quickFix(code)
    expect(fixed).not.toContain("axios")
    expect(fixed).toContain("zod")
    expect(fixes.some((f) => f.includes("axios"))).toBe(true)
  })

  test("removes forbidden CJS requires", () => {
    const code = `const fs = require("fs")\nimport { z } from "zod"`
    const { code: fixed, fixes } = quickFix(code)
    expect(fixed).not.toContain("require")
    expect(fixed).toContain("zod")
    expect(fixes.some((f) => f.includes("fs"))).toBe(true)
  })

  test("strips async from handler callback (any param name)", () => {
    const code = `handler(trigger, async (ctx) => { return ctx })`
    const { code: fixed, fixes } = quickFix(code)
    expect(fixed).toContain("handler(trigger, (ctx)")
    expect(fixed).not.toMatch(/async/)
    expect(fixes.some((f) => f.includes("async"))).toBe(true)
  })

  test("strips await from handler body after removing async", () => {
    const code = `handler(trigger, async (rt) => { const x = await fetch("url"); return x })`
    const { code: fixed } = quickFix(code)
    expect(fixed).not.toContain("await")
    expect(fixed).toContain('const x = fetch("url")')
  })

  test("adds missing export to function main", () => {
    const code = `function main() { runner.run(init) }`
    const { code: fixed, fixes } = quickFix(code)
    expect(fixed).toContain("export function main()")
    expect(fixes.some((f) => f.includes("export"))).toBe(true)
  })

  test("no-op on valid code", () => {
    const { code: fixed, fixes } = quickFix(VALID_CODE)
    expect(fixed).toBe(VALID_CODE)
    expect(fixes).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────
// Suite 9: Cheap-First Ordering
// ─────────────────────────────────────────────

describe("cheap-first validation ordering", () => {
  test("fast check failure skips tsc (no [TSC] error when [IMPORT] fails)", async () => {
    const code = `import axios from "axios"\n` + VALID_CODE
    const result = await validateWorkflow(code, VALID_CONFIG)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.startsWith("[IMPORT]"))).toBe(true)
    expect(result.errors.some((e) => e.startsWith("[TSC]"))).toBe(false)
  })
})

// ─────────────────────────────────────────────
// Suite 10: Multiple Errors in Single Validation
// ─────────────────────────────────────────────

describe("multiple errors reported", () => {
  test("both [IMPORT] and [MAIN] errors reported in single validation", async () => {
    // Code with forbidden import AND missing export on main
    const code = `import axios from "axios"\n` +
      VALID_CODE.replace("export async function main()", "async function main()")
    const result = await validateWorkflow(code, VALID_CONFIG)
    expect(result.valid).toBe(false)
    const categories = result.errors.map((e) => e.match(/^\[([A-Z]+)\]/)?.[1]).filter(Boolean)
    expect(categories).toContain("IMPORT")
    expect(categories).toContain("MAIN")
  })
})

// ─────────────────────────────────────────────
// Suite 11: async function handler variant
// ─────────────────────────────────────────────

describe("async function handler variant", () => {
  test("handler(trigger, async function(rt) {...}) caught with [ASYNC]", async () => {
    const code = VALID_CODE.replace(
      "handler(cronTrigger, (rt) => {",
      "handler(cronTrigger, async function(rt) {",
    ).replace(
      // Close the function expression properly
      "  })\n\n  consensusMedianAggregation",
      "  })\n\n  consensusMedianAggregation",
    )
    const result = await validateWorkflow(code, VALID_CONFIG)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.startsWith("[ASYNC]"))).toBe(true)
  })

  test("quickFix strips async from function expression handler", () => {
    const code = `handler(trigger, async function(rt) { const x = rt.config; return x })`
    const { code: fixed, fixes } = quickFix(code)
    expect(fixed).toContain("handler(trigger, function(rt)")
    expect(fixed).not.toMatch(/async\s+function/)
    expect(fixes.some((f) => f.includes("async"))).toBe(true)
  })

  test("quickFix reports await removal message", () => {
    const code = `handler(trigger, async (rt) => { const x = await fetch("url"); return x })`
    const { fixes } = quickFix(code)
    expect(fixes.some((f) => f.includes("await"))).toBe(true)
  })
})
