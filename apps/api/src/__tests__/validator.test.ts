import { describe, test, expect } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"
import { validateWorkflow, quickFix, extractSecretNames, buildSecretsYaml } from "../services/ai-engine/validator"
import type { ParsedIntent } from "../services/ai-engine/types"
import { getTemplateById } from "../services/ai-engine/template-matcher"

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

// ─────────────────────────────────────────────
// Suite 12: Check (g) — State Patterns
// ─────────────────────────────────────────────

describe("Check (g): State Patterns", () => {
  const KV_CONFIG = JSON.stringify({
    apiUrl: "https://api.coingecko.com/api/v3/simple/price",
    threshold: 3000,
    cronSchedule: "0 */5 * * * *",
    kvStoreUrl: "https://your-kv-store.upstash.io",
    kvApiKey: "kv-api-key-placeholder",
    stateKey: "ciel-history-data",
  })

  test("code with kvStoreUrl + ConfidentialHTTPClient passes", async () => {
    const code = VALID_CODE.replace(
      "const httpClient = new HTTPClient()",
      "const httpClient = new HTTPClient()\n  const kvClient = new ConfidentialHTTPClient()",
    )
    const result = await validateWorkflow(code, KV_CONFIG)
    expect(result.errors.some((e) => e.startsWith("[STATE]"))).toBe(false)
  })

  test("code with kvStoreUrl but only HTTPClient produces [STATE] error", async () => {
    const result = await validateWorkflow(VALID_CODE, KV_CONFIG)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.startsWith("[STATE]"))).toBe(true)
    expect(result.errors.some((e) => e.includes("ConfidentialHTTPClient"))).toBe(true)
  })

  test("code with empty kvStoreUrl does not trigger [STATE] error", async () => {
    const emptyKvConfig = JSON.stringify({
      apiUrl: "https://api.coingecko.com/api/v3/simple/price",
      threshold: 3000,
      cronSchedule: "0 */5 * * * *",
      kvStoreUrl: "",
      kvApiKey: "",
      stateKey: "",
    })
    const result = await validateWorkflow(VALID_CODE, emptyKvConfig)
    expect(result.errors.some((e) => e.startsWith("[STATE]"))).toBe(false)
  })

  test("code without kvStoreUrl in config produces no [STATE] error", async () => {
    const result = await validateWorkflow(VALID_CODE, VALID_CONFIG)
    expect(result.errors.some((e) => e.startsWith("[STATE]"))).toBe(false)
  })

  test("ConfidentialHTTPClient referenced in comment but not instantiated produces [STATE] error", async () => {
    const code = VALID_CODE.replace(
      "const httpClient = new HTTPClient()",
      "const httpClient = new HTTPClient()\n  // TODO: use ConfidentialHTTPClient for KV access",
    )
    const result = await validateWorkflow(code, KV_CONFIG)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.startsWith("[STATE]"))).toBe(true)
  })

  test("ConfidentialHTTPClient imported but not instantiated produces [STATE] error", async () => {
    const code = VALID_CODE.replace(
      'import {\n  Runner,\n  Runtime,\n  CronCapability,\n  HTTPClient,\n  handler,\n  consensusMedianAggregation,\n} from "@chainlink/cre-sdk"',
      'import {\n  Runner,\n  Runtime,\n  CronCapability,\n  HTTPClient,\n  ConfidentialHTTPClient,\n  handler,\n  consensusMedianAggregation,\n} from "@chainlink/cre-sdk"',
    )
    const result = await validateWorkflow(code, KV_CONFIG)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.startsWith("[STATE]"))).toBe(true)
  })

  test("new ConfidentialHTTPClient() instantiated passes [STATE] check", async () => {
    const code = VALID_CODE.replace(
      "const httpClient = new HTTPClient()",
      "const httpClient = new HTTPClient()\n  const kvClient = new ConfidentialHTTPClient()",
    )
    const result = await validateWorkflow(code, KV_CONFIG)
    expect(result.errors.some((e) => e.startsWith("[STATE]"))).toBe(false)
  })

  test("quickFix does NOT auto-fix state issues", () => {
    // State issues are left for LLM retry, not deterministic quickFix
    const { code: fixed, fixes } = quickFix(VALID_CODE)
    expect(fixes.some((f) => f.includes("STATE"))).toBe(false)
    expect(fixes.some((f) => f.includes("ConfidentialHTTPClient"))).toBe(false)
    expect(fixed).toBe(VALID_CODE)
  })
})

// ─────────────────────────────────────────────
// Suite 12b: Official SDK Pattern Support
// ─────────────────────────────────────────────

describe("Official CRE SDK pattern support", () => {
  const OFFICIAL_CODE = `
import { z } from "zod"
import {
  cre,
  Runner,
  type Runtime,
  type CronPayload,
  getNetwork,
} from "@chainlink/cre-sdk"

const configSchema = z.object({
  apiUrl: z.string(),
  threshold: z.number(),
  schedule: z.string().default("0 */5 * * * *"),
  consumerContract: z.string(),
  chainSelectorName: z.string().default("base-sepolia"),
})

type Config = z.infer<typeof configSchema>

const onCronTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
  runtime.log("Starting price check...")
  const httpClient = new cre.capabilities.HTTPClient()
  const resp = httpClient.sendRequest(runtime, {
    url: runtime.config.apiUrl,
    method: "GET",
    headers: { "Content-Type": "application/json" },
  }).result()
  const data = JSON.parse(resp.body)
  const price: number = data.price
  return JSON.stringify({ price: Math.round(price * 1e8), alert: price < runtime.config.threshold })
}

const initWorkflow = (config: Config) => {
  const cronCapability = new cre.capabilities.CronCapability()
  return [cre.handler(cronCapability.trigger({ schedule: config.schedule }), onCronTrigger)]
}

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema })
  await runner.run(initWorkflow)
}
`

  const OFFICIAL_CONFIG = JSON.stringify({
    apiUrl: "https://api.coingecko.com/api/v3/simple/price",
    threshold: 3000,
    schedule: "0 */5 * * * *",
    consumerContract: "0x0000000000000000000000000000000000000000",
    chainSelectorName: "base-sepolia",
  })

  test("official SDK pattern passes all checks", async () => {
    const result = await validateWorkflow(OFFICIAL_CODE, OFFICIAL_CONFIG)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  }, 30_000)

  test("cre.handler() not flagged as async", async () => {
    const result = await validateWorkflow(OFFICIAL_CODE, OFFICIAL_CONFIG)
    expect(result.errors.some((e) => e.startsWith("[ASYNC]"))).toBe(false)
  })

  test("@noble/hashes import allowed", async () => {
    const code = `import { sha256 } from "@noble/hashes/sha2"\nimport { hmac } from "@noble/hashes/hmac"\n` + OFFICIAL_CODE
    const result = await validateWorkflow(code, OFFICIAL_CONFIG)
    const importErrors = result.errors.filter((e) => e.startsWith("[IMPORT]"))
    expect(importErrors).toHaveLength(0)
  })

  test("cre.handler() with async callback caught", async () => {
    const code = OFFICIAL_CODE.replace(
      "cre.handler(cronCapability.trigger({ schedule: config.schedule }), onCronTrigger)",
      "cre.handler(cronCapability.trigger({ schedule: config.schedule }), async (rt) => { return '' })",
    )
    const result = await validateWorkflow(code, OFFICIAL_CONFIG)
    expect(result.errors.some((e) => e.startsWith("[ASYNC]"))).toBe(true)
  })

  test("quickFix strips async from cre.handler callback", () => {
    const code = `cre.handler(trigger, async (ctx) => { return ctx })`
    const { code: fixed, fixes } = quickFix(code)
    expect(fixed).toContain("cre.handler(trigger, (ctx)")
    expect(fixed).not.toMatch(/async/)
    expect(fixes.some((f) => f.includes("async"))).toBe(true)
  })
})

// ─────────────────────────────────────────────
// Suite 13: Template 11 Integration Validation
// ─────────────────────────────────────────────

describe("Template 11 integration validation", () => {
  test("template-11.ts passes 6-point validation", async () => {
    const code = readFileSync(join(__dirname, "../../templates/template-11.ts"), "utf-8")
    const config = readFileSync(join(__dirname, "../../templates/template-11.config.json"), "utf-8")
    const result = await validateWorkflow(code, config)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  }, 30_000)
})

// ─────────────────────────────────────────────
// Suite 14: Template 12 Integration Validation
// ─────────────────────────────────────────────

describe("Template 12 integration validation", () => {
  test("template-12.ts passes 6-point validation", async () => {
    const code = readFileSync(join(__dirname, "../../templates/template-12.ts"), "utf-8")
    const config = readFileSync(join(__dirname, "../../templates/template-12.config.json"), "utf-8")
    const result = await validateWorkflow(code, config)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  }, 30_000)
})

// ─────────────────────────────────────────────
// Suite 15: Templates 13-14 Integration Validation
// ─────────────────────────────────────────────

describe("Template 13 integration validation", () => {
  test("template-13.ts passes 6-point validation", async () => {
    const code = readFileSync(join(__dirname, "../../templates/template-13.ts"), "utf-8")
    const config = readFileSync(join(__dirname, "../../templates/template-13.config.json"), "utf-8")
    const result = await validateWorkflow(code, config)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  }, 30_000)
})

describe("Template 14 integration validation", () => {
  test("template-14.ts passes 6-point validation", async () => {
    const code = readFileSync(join(__dirname, "../../templates/template-14.ts"), "utf-8")
    const config = readFileSync(join(__dirname, "../../templates/template-14.config.json"), "utf-8")
    const result = await validateWorkflow(code, config)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  }, 30_000)
})

describe("Template 15 integration validation", () => {
  test("template-15.ts passes 6-point validation", async () => {
    const code = readFileSync(join(__dirname, "../../templates/template-15.ts"), "utf-8")
    const config = readFileSync(join(__dirname, "../../templates/template-15.config.json"), "utf-8")
    const result = await validateWorkflow(code, config)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  }, 30_000)
})

describe("Template 16 integration validation", () => {
  test("template-16.ts passes 6-point validation", async () => {
    const code = readFileSync(join(__dirname, "../../templates/template-16.ts"), "utf-8")
    const config = readFileSync(join(__dirname, "../../templates/template-16.config.json"), "utf-8")
    const result = await validateWorkflow(code, config)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  }, 30_000)
})

// ─────────────────────────────────────────────
// Suite 16: Templates 17-22 Integration Validation
// ─────────────────────────────────────────────

describe("Template 17 integration validation", () => {
  test("template-17.ts passes 6-point validation", async () => {
    const code = readFileSync(join(__dirname, "../../templates/template-17.ts"), "utf-8")
    const config = readFileSync(join(__dirname, "../../templates/template-17.config.json"), "utf-8")
    const result = await validateWorkflow(code, config)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  }, 30_000)
})

describe("Template 18 integration validation", () => {
  test("template-18.ts passes 6-point validation", async () => {
    const code = readFileSync(join(__dirname, "../../templates/template-18.ts"), "utf-8")
    const config = readFileSync(join(__dirname, "../../templates/template-18.config.json"), "utf-8")
    const result = await validateWorkflow(code, config)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  }, 30_000)
})

describe("Template 19 integration validation", () => {
  test("template-19.ts passes 6-point validation", async () => {
    const code = readFileSync(join(__dirname, "../../templates/template-19.ts"), "utf-8")
    const config = readFileSync(join(__dirname, "../../templates/template-19.config.json"), "utf-8")
    const result = await validateWorkflow(code, config)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  }, 30_000)
})

describe("Template 20 integration validation", () => {
  test("template-20.ts passes 6-point validation", async () => {
    const code = readFileSync(join(__dirname, "../../templates/template-20.ts"), "utf-8")
    const config = readFileSync(join(__dirname, "../../templates/template-20.config.json"), "utf-8")
    const result = await validateWorkflow(code, config)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  }, 30_000)
})

describe("Template 21 integration validation", () => {
  test("template-21.ts passes 6-point validation", async () => {
    const code = readFileSync(join(__dirname, "../../templates/template-21.ts"), "utf-8")
    const config = readFileSync(join(__dirname, "../../templates/template-21.config.json"), "utf-8")
    const result = await validateWorkflow(code, config)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  }, 30_000)
})

describe("Template 22 integration validation", () => {
  test("template-22.ts passes 6-point validation", async () => {
    const code = readFileSync(join(__dirname, "../../templates/template-22.ts"), "utf-8")
    const config = readFileSync(join(__dirname, "../../templates/template-22.config.json"), "utf-8")
    const result = await validateWorkflow(code, config)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  }, 30_000)
})

// ─────────────────────────────────────────────
// Suite 17: Check (h) — Non-Determinism
// ─────────────────────────────────────────────

describe("Check (h): Non-Determinism", () => {
  test("Date.now() caught with [NONDET] prefix", async () => {
    const code = VALID_CODE.replace(
      "return { price: Math.round(price * 1e8), alert: price < rt.config.threshold }",
      "return { price: Math.round(price * 1e8), timestamp: Date.now() }",
    )
    const result = await validateWorkflow(code, VALID_CONFIG)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.startsWith("[NONDET]") && e.includes("Date.now()"))).toBe(true)
  })

  test("new Date() caught with [NONDET] prefix", async () => {
    const code = VALID_CODE.replace(
      "return { price: Math.round(price * 1e8), alert: price < rt.config.threshold }",
      "const now = new Date()\n    return { price: 0, ts: now.toISOString() }",
    )
    const result = await validateWorkflow(code, VALID_CONFIG)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.startsWith("[NONDET]") && e.includes("new Date()"))).toBe(true)
  })

  test("Math.random() caught with [NONDET] prefix", async () => {
    const code = VALID_CODE.replace(
      "return { price: Math.round(price * 1e8), alert: price < rt.config.threshold }",
      "return { price: Math.round(price * 1e8), nonce: Math.random() }",
    )
    const result = await validateWorkflow(code, VALID_CONFIG)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.startsWith("[NONDET]") && e.includes("Math.random()"))).toBe(true)
  })

  test("Promise.race() caught with [NONDET] prefix", async () => {
    const code = VALID_CODE.replace(
      "return { price: Math.round(price * 1e8), alert: price < rt.config.threshold }",
      "const r = Promise.race([Promise.resolve(1)])\n    return { price: 0 }",
    )
    const result = await validateWorkflow(code, VALID_CONFIG)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.startsWith("[NONDET]") && e.includes("Promise.race()"))).toBe(true)
  })

  test("setTimeout() caught with [NONDET] prefix", async () => {
    const code = VALID_CODE.replace(
      "return { price: Math.round(price * 1e8), alert: price < rt.config.threshold }",
      "setTimeout(() => {}, 1000)\n    return { price: 0 }",
    )
    const result = await validateWorkflow(code, VALID_CONFIG)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.startsWith("[NONDET]") && e.includes("setTimeout()"))).toBe(true)
  })

  test("runtime.now() is NOT flagged as non-deterministic", async () => {
    const code = VALID_CODE.replace(
      "return { price: Math.round(price * 1e8), alert: price < rt.config.threshold }",
      "return { price: Math.round(price * 1e8), timestamp: rt.now().getTime() }",
    )
    const result = await validateWorkflow(code, VALID_CONFIG)
    expect(result.errors.some((e) => e.startsWith("[NONDET]"))).toBe(false)
  })

  test("quickFix replaces Date.now() with runtime.now().getTime() in handler blocks", () => {
    const code = `handler(trigger, (rt) => { return { ts: Date.now() } })`
    const { code: fixed, fixes } = quickFix(code)
    expect(fixed).toContain("runtime.now().getTime()")
    expect(fixed).not.toContain("Date.now()")
    expect(fixes.some((f) => f.includes("Date.now()"))).toBe(true)
  })

  test("quickFix replaces new Date() with runtime.now() in handler blocks", () => {
    const code = `handler(trigger, (rt) => { const now = new Date(); return { ts: now.toISOString() } })`
    const { code: fixed, fixes } = quickFix(code)
    expect(fixed).toContain("runtime.now()")
    expect(fixed).not.toContain("new Date()")
    expect(fixes.some((f) => f.includes("new Date()"))).toBe(true)
  })
})

// ─────────────────────────────────────────────
// Suite 18: SDK Stub Type Completeness
// ─────────────────────────────────────────────

describe("SDK stub type completeness", () => {
  const BASE_CODE = `
import { z } from "zod"
import {
  cre,
  Runner,
  type Runtime,
  type CronPayload,
  getNetwork,
  ConfidenceLevel,
  LAST_FINALIZED_BLOCK_NUMBER,
  encodeCallMsg,
  bytesToHex,
  type HTTPPayload,
  decodeJson,
} from "@chainlink/cre-sdk"
import { encodeFunctionData, parseAbi } from "viem"

const configSchema = z.object({
  schedule: z.string(),
  feedAddress: z.string(),
  consumerContract: z.string(),
  chainSelectorName: z.string(),
})
type Config = z.infer<typeof configSchema>
`

  const HANDLER_WRAPPER = (body: string) => `
${BASE_CODE}
const onTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: runtime.config.chainSelectorName, isTestnet: true })
  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)
  ${body}
  return JSON.stringify({ ok: true })
}

const initWorkflow = (config: Config) => {
  const cron = new cre.capabilities.CronCapability()
  return [cre.handler(cron.trigger({ schedule: config.schedule }), onTrigger)]
}

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema })
  await runner.run(initWorkflow)
}
`

  const STUB_CONFIG = JSON.stringify({
    schedule: "0 */5 * * * *",
    feedAddress: "0x0000000000000000000000000000000000000000",
    consumerContract: "0x0000000000000000000000000000000000000000",
    chainSelectorName: "ethereum-testnet-sepolia",
  })

  test("balanceAt compiles without TSC error", async () => {
    const code = HANDLER_WRAPPER(
      `const bal = evmClient.balanceAt(runtime, { address: "0x0", blockNumber: ConfidenceLevel.FINALIZED }).result()`
    )
    const result = await validateWorkflow(code, STUB_CONFIG)
    expect(result.errors.some((e) => e.startsWith("[TSC]") && e.includes("balanceAt"))).toBe(false)
  }, 30_000)

  test("filterLogs compiles without TSC error", async () => {
    const code = HANDLER_WRAPPER(
      `const logs = evmClient.filterLogs(runtime, { addresses: ["0x0"], fromBlock: "0x0" }).result()`
    )
    const result = await validateWorkflow(code, STUB_CONFIG)
    expect(result.errors.some((e) => e.startsWith("[TSC]") && e.includes("filterLogs"))).toBe(false)
  }, 30_000)

  test("getTransactionReceipt compiles without TSC error", async () => {
    const code = HANDLER_WRAPPER(
      `const receipt = evmClient.getTransactionReceipt(runtime, { txHash: "0xabc" }).result()`
    )
    const result = await validateWorkflow(code, STUB_CONFIG)
    expect(result.errors.some((e) => e.startsWith("[TSC]") && e.includes("getTransactionReceipt"))).toBe(false)
  }, 30_000)

  test("ConfidenceLevel enum compiles without TSC error", async () => {
    const code = HANDLER_WRAPPER(
      `const resp = evmClient.callContract(runtime, {
        call: encodeCallMsg({ from: "0x0", to: runtime.config.feedAddress, data: "0x" }),
        blockNumber: ConfidenceLevel.SAFE,
      }).result()`
    )
    const result = await validateWorkflow(code, STUB_CONFIG)
    expect(result.errors.some((e) => e.startsWith("[TSC]") && e.includes("ConfidenceLevel"))).toBe(false)
  }, 30_000)

  test("HTTPPayload and decodeJson compile without TSC error", async () => {
    const code = `
${BASE_CODE}
const onHTTP = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
  const data = decodeJson(payload.input)
  const key = payload.key?.publicKey
  return JSON.stringify({ data, key })
}

const initWorkflow = (config: Config) => {
  const http = new cre.capabilities.HTTPCapability()
  return [cre.handler(http.trigger({ authorizedKeys: [{ type: "ECDSA_EVM", publicKey: "0x" }] }), onHTTP)]
}

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema })
  await runner.run(initWorkflow)
}
`
    const result = await validateWorkflow(code, STUB_CONFIG)
    expect(result.errors.some((e) => e.startsWith("[TSC]") && e.includes("decodeJson"))).toBe(false)
    expect(result.errors.some((e) => e.startsWith("[TSC]") && e.includes("HTTPPayload"))).toBe(false)
  }, 30_000)

  test("runtime.now() compiles without TSC error", async () => {
    const code = HANDLER_WRAPPER(
      `const ts = runtime.now().getTime()
  const isoDate = runtime.now().toISOString()`
    )
    const result = await validateWorkflow(code, STUB_CONFIG)
    expect(result.errors.some((e) => e.startsWith("[TSC]") && e.includes("now"))).toBe(false)
  }, 30_000)
})

// ─────────────────────────────────────────────
// Suite 19: Secrets Extraction & YAML Generation
// ─────────────────────────────────────────────

describe("Secrets extraction & YAML generation", () => {
  test("extracts secret names from getSecret({ id }) pattern", () => {
    const code = `
      const apiKey = runtime.getSecret({ id: "API_KEY" }).result().value
      const dbPass = runtime.getSecret({ id: "DB_PASSWORD" }).result().value
    `
    const names = extractSecretNames(code)
    expect(names).toContain("API_KEY")
    expect(names).toContain("DB_PASSWORD")
    expect(names).toHaveLength(2)
  })

  test("extracts secret names from getSecret(string) pattern", () => {
    const code = `
      const key = nodeRuntime.getSecret("OPENAI_API_KEY")
    `
    const names = extractSecretNames(code)
    expect(names).toContain("OPENAI_API_KEY")
    expect(names).toHaveLength(1)
  })

  test("deduplicates secret names", () => {
    const code = `
      const key1 = runtime.getSecret({ id: "API_KEY" }).result().value
      const key2 = runtime.getSecret({ id: "API_KEY" }).result().value
      const key3 = nodeRuntime.getSecret("API_KEY")
    `
    const names = extractSecretNames(code)
    expect(names).toEqual(["API_KEY"])
  })

  test("returns empty array when no secrets", () => {
    const code = `const x = runtime.config.apiUrl`
    const names = extractSecretNames(code)
    expect(names).toHaveLength(0)
  })

  test("buildSecretsYaml returns null for empty names", () => {
    expect(buildSecretsYaml([])).toBeNull()
  })

  test("buildSecretsYaml generates valid YAML with placeholders", () => {
    const yaml = buildSecretsYaml(["API_KEY", "DB_PASSWORD"])
    expect(yaml).not.toBeNull()
    expect(yaml).toContain('API_KEY: "PLACEHOLDER_API_KEY"')
    expect(yaml).toContain('DB_PASSWORD: "PLACEHOLDER_DB_PASSWORD"')
    expect(yaml).toContain("# CRE Workflow Secrets")
  })
})

// ─────────────────────────────────────────────
// Suite 20: quickFix — Math.random, setTimeout, setInterval (Change #3)
// ─────────────────────────────────────────────

describe("quickFix — expanded non-determinism repair", () => {
  test("replaces Math.random() with deterministic placeholder in handler blocks", () => {
    const code = `handler(trigger, (rt) => { const nonce = Math.random(); return { nonce } })`
    const { code: fixed, fixes } = quickFix(code)
    expect(fixed).toContain("0 /* FIXME: use deterministic logic */")
    expect(fixed).not.toContain("Math.random()")
    expect(fixes.some((f) => f.includes("Math.random()"))).toBe(true)
  })

  test("Math.random() outside handler blocks is NOT replaced", () => {
    const code = `const seed = Math.random()\nhandler(trigger, (rt) => { return { seed } })`
    const { code: fixed } = quickFix(code)
    // Only replaces inside handler blocks
    expect(fixed).toContain("Math.random()")
  })

  test("removes setTimeout inside handler blocks", () => {
    const code = `handler(trigger, (rt) => { setTimeout(() => {}, 1000); return { ok: true } })`
    const { code: fixed, fixes } = quickFix(code)
    expect(fixed).toContain("/* setTimeout removed")
    expect(fixed).not.toMatch(/\bsetTimeout\s*\(/)
    expect(fixes.some((f) => f.includes("setTimeout"))).toBe(true)
  })

  test("removes setInterval inside handler blocks", () => {
    const code = `handler(trigger, (rt) => { setInterval(() => {}, 5000); return { ok: true } })`
    const { code: fixed, fixes } = quickFix(code)
    expect(fixed).toContain("/* setInterval removed")
    expect(fixed).not.toMatch(/\bsetInterval\s*\(/)
    expect(fixes.some((f) => f.includes("setInterval") || f.includes("setTimeout"))).toBe(true)
  })

  test("does not touch setTimeout outside handler blocks", () => {
    const code = `setTimeout(() => console.log("warmup"), 100)\nhandler(trigger, (rt) => { return {} })`
    const { code: fixed } = quickFix(code)
    expect(fixed).toContain("setTimeout")
  })
})

// ─────────────────────────────────────────────
// Suite 21: Check (i) — Config-Code Consistency (Change #5)
// ─────────────────────────────────────────────

describe("Check (i): Config-Code Consistency", () => {
  test("detects runtime.config.X referencing non-existent config field", async () => {
    const code = VALID_CODE.replace(
      "rt.config.apiUrl",
      "rt.config.nonExistentField",
    )
    const result = await validateWorkflow(code, VALID_CONFIG)
    expect(result.errors.some((e) => e.startsWith("[CONFIG_MISMATCH]"))).toBe(true)
    expect(result.errors.some((e) => e.includes("nonExistentField"))).toBe(true)
  })

  test("passes when all config references exist", async () => {
    const result = await validateWorkflow(VALID_CODE, VALID_CONFIG)
    expect(result.errors.some((e) => e.startsWith("[CONFIG_MISMATCH]"))).toBe(false)
  })

  test("lists available config fields in error message", async () => {
    const code = VALID_CODE.replace(
      "rt.config.apiUrl",
      "rt.config.priceEndpoint",
    )
    const result = await validateWorkflow(code, VALID_CONFIG)
    const mismatchError = result.errors.find((e) => e.startsWith("[CONFIG_MISMATCH]"))
    expect(mismatchError).toBeDefined()
    expect(mismatchError).toContain("apiUrl")
    expect(mismatchError).toContain("threshold")
  })

  test("detects multiple missing config fields", async () => {
    const code = VALID_CODE
      .replace("rt.config.apiUrl", "rt.config.endpoint")
      .replace("rt.config.threshold", "rt.config.limit")
    const result = await validateWorkflow(code, VALID_CONFIG)
    const mismatchError = result.errors.find((e) => e.startsWith("[CONFIG_MISMATCH]"))
    expect(mismatchError).toBeDefined()
    expect(mismatchError).toContain("endpoint")
    expect(mismatchError).toContain("limit")
  })

  test("handles empty config JSON gracefully", async () => {
    const result = await validateWorkflow(VALID_CODE, "{}")
    // Empty config should not crash, but will show mismatches
    expect(result.errors.some((e) => e.startsWith("[CONFIG_MISMATCH]"))).toBe(true)
  })

  test("skips check when config JSON is invalid", async () => {
    const result = await validateWorkflow(VALID_CODE, "not json")
    // Invalid JSON caught by checkConfigJson, not by config-code consistency
    expect(result.errors.some((e) => e.startsWith("[CONFIG]"))).toBe(true)
  })
})

// ─────────────────────────────────────────────
// Suite 22: Check (j) — Intent Alignment (Change #6)
// ─────────────────────────────────────────────

describe("Check (j): Intent Alignment", () => {
  const makeIntent = (overrides: Partial<ParsedIntent> = {}): ParsedIntent => ({
    triggerType: "cron",
    confidence: 0.9,
    dataSources: ["price-feed"],
    conditions: [],
    actions: ["alert"],
    chains: ["base-sepolia"],
    keywords: ["monitor", "price"],
    negated: false,
    entities: {},
    ...overrides,
  })

  test("detects trigger type mismatch (cron template but no CronCapability)", async () => {
    const intent = makeIntent({ triggerType: "cron" })
    const templateDef = getTemplateById(1)! // T1 is cron-triggered
    // Code that has no CronCapability
    const badCode = `
import { z } from "zod"
import { cre, Runner, type Runtime, type HTTPPayload, getNetwork } from "@chainlink/cre-sdk"
const configSchema = z.object({ apiUrl: z.string(), schedule: z.string() })
type Config = z.infer<typeof configSchema>
const onHTTP = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
  return JSON.stringify({ ok: true })
}
const initWorkflow = (config: Config) => {
  const http = new cre.capabilities.HTTPCapability()
  return [cre.handler(http.trigger(), onHTTP)]
}
export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema })
  await runner.run(initWorkflow)
}
`
    const result = await validateWorkflow(badCode, '{"apiUrl":"https://example.com","schedule":"0 * * * * *"}', intent, templateDef)
    expect(result.errors.some((e) => e.startsWith("[ALIGN]") && e.includes("cron"))).toBe(true)
  })

  test("passes when trigger type matches", async () => {
    const intent = makeIntent({ triggerType: "cron" })
    const templateDef = getTemplateById(1)!
    const result = await validateWorkflow(VALID_CODE, VALID_CONFIG, intent, templateDef)
    expect(result.errors.some((e) => e.startsWith("[ALIGN]") && e.includes("trigger"))).toBe(false)
  })

  test("detects missing action implementation (dexSwap without swap code)", async () => {
    const intent = makeIntent({ actions: ["dexSwap"] })
    const templateDef = getTemplateById(5)! // T5 = DeFi swap
    const result = await validateWorkflow(VALID_CODE, VALID_CONFIG, intent, templateDef)
    expect(result.errors.some((e) => e.startsWith("[ALIGN]") && e.includes("dexSwap"))).toBe(true)
  })

  test("detects missing HTTPClient for HTTP data sources", async () => {
    const intent = makeIntent({ dataSources: ["news-api", "sports-api"] })
    const templateDef = getTemplateById(10)!
    // Code with no HTTPClient
    const noHttpCode = `
import { z } from "zod"
import { cre, Runner, type Runtime, type CronPayload } from "@chainlink/cre-sdk"
const configSchema = z.object({ schedule: z.string() })
type Config = z.infer<typeof configSchema>
const onCron = (runtime: Runtime<Config>, payload: CronPayload): string => {
  return JSON.stringify({ ok: true })
}
const initWorkflow = (config: Config) => {
  const cron = new cre.capabilities.CronCapability()
  return [cre.handler(cron.trigger({ schedule: config.schedule }), onCron)]
}
export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema })
  await runner.run(initWorkflow)
}
`
    const result = await validateWorkflow(noHttpCode, '{"schedule":"0 * * * * *"}', intent, templateDef)
    expect(result.errors.some((e) => e.startsWith("[ALIGN]") && e.includes("HTTPClient"))).toBe(true)
  })

  test("skips alignment check when intent/templateDef not provided", async () => {
    // Backward compatible — no alignment errors without intent
    const result = await validateWorkflow(VALID_CODE, VALID_CONFIG)
    expect(result.errors.some((e) => e.startsWith("[ALIGN]"))).toBe(false)
  })

  test("chainlink-feeds data source does not require HTTPClient", async () => {
    const intent = makeIntent({ dataSources: ["chainlink-feeds"] })
    const templateDef = getTemplateById(13)!
    const result = await validateWorkflow(VALID_CODE, VALID_CONFIG, intent, templateDef)
    expect(result.errors.some((e) => e.startsWith("[ALIGN]") && e.includes("HTTPClient"))).toBe(false)
  })
})
