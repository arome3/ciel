import { describe, test, expect, mock, beforeAll, beforeEach, afterEach } from "bun:test"
import { resolve } from "path"
import { createHash } from "crypto"

// ─────────────────────────────────────────────
// Mocks — external boundaries only
// ─────────────────────────────────────────────

const SRC = resolve(import.meta.dir, "..")

const TEST_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
const TEST_GATEWAY_URL = "https://gateway.test/api"

mock.module(resolve(SRC, "config.ts"), () => ({
  config: {
    PRIVATE_KEY: TEST_PRIVATE_KEY,
    CRE_GATEWAY_URL: TEST_GATEWAY_URL,
    NODE_ENV: "test",
  },
}))

mock.module(resolve(SRC, "lib/logger.ts"), () => ({
  createLogger: () => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }),
}))

// ─────────────────────────────────────────────
// Dynamic import
// ─────────────────────────────────────────────

let stableStringify: (obj: unknown) => string
let sha256Hex: (data: string) => string
let createGatewayJWT: (request: Record<string, unknown>) => Promise<string>
let triggerWorkflow: (donWorkflowId: string, input?: Record<string, unknown>) => Promise<any>

let originalFetch: typeof globalThis.fetch

beforeAll(async () => {
  const mod = await import("../services/cre/gateway-client")
  stableStringify = mod.stableStringify
  sha256Hex = mod.sha256Hex
  createGatewayJWT = mod.createGatewayJWT
  triggerWorkflow = mod.triggerWorkflow
  originalFetch = globalThis.fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

// ─────────────────────────────────────────────
// stableStringify
// ─────────────────────────────────────────────

describe("stableStringify", () => {
  test("sorts keys recursively with no whitespace", () => {
    const obj = { z: 1, a: { c: 3, b: 2 } }
    const result = stableStringify(obj)
    expect(result).toBe('{"a":{"b":2,"c":3},"z":1}')
  })

  test("handles arrays (preserves order, no sorting)", () => {
    const obj = { items: [3, 1, 2], name: "test" }
    const result = stableStringify(obj)
    expect(result).toBe('{"items":[3,1,2],"name":"test"}')
  })

  test("handles null, string, number, boolean", () => {
    expect(stableStringify(null)).toBe("null")
    expect(stableStringify("hello")).toBe('"hello"')
    expect(stableStringify(42)).toBe("42")
    expect(stableStringify(true)).toBe("true")
  })

  test("handles nested objects and arrays", () => {
    const obj = { b: [{ z: 1, a: 2 }], a: "first" }
    const result = stableStringify(obj)
    expect(result).toBe('{"a":"first","b":[{"a":2,"z":1}]}')
  })

  test("matches Python json.dumps(sort_keys=True, separators=(',',':'))", () => {
    // Python: json.dumps({"method": "workflows.execute", "params": {"input": {}, "workflow": {"workflowID": "abc"}}}, sort_keys=True, separators=(',',':'))
    const obj = {
      method: "workflows.execute",
      params: { input: {}, workflow: { workflowID: "abc" } },
    }
    const result = stableStringify(obj)
    expect(result).toBe('{"method":"workflows.execute","params":{"input":{},"workflow":{"workflowID":"abc"}}}')
  })
})

// ─────────────────────────────────────────────
// sha256Hex
// ─────────────────────────────────────────────

describe("sha256Hex", () => {
  test("produces correct SHA-256 hex digest", () => {
    const input = "hello world"
    const expected = createHash("sha256").update(input).digest("hex")
    expect(sha256Hex(input)).toBe(expected)
  })
})

// ─────────────────────────────────────────────
// createGatewayJWT
// ─────────────────────────────────────────────

describe("createGatewayJWT", () => {
  test("returns a 3-part JWT string", async () => {
    const jwt = await createGatewayJWT({ test: true })
    const parts = jwt.split(".")
    expect(parts.length).toBe(3)
  })

  test("header is base64url-encoded {alg:ETH,typ:JWT}", async () => {
    const jwt = await createGatewayJWT({ test: true })
    const headerB64 = jwt.split(".")[0]
    const header = JSON.parse(Buffer.from(headerB64, "base64url").toString())
    expect(header).toEqual({ alg: "ETH", typ: "JWT" })
  })

  test("payload contains digest, iss, iat, exp, jti", async () => {
    const jwt = await createGatewayJWT({ test: true })
    const payloadB64 = jwt.split(".")[1]
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString())

    expect(payload.digest).toStartWith("0x")
    expect(payload.iss).toStartWith("0x")
    expect(payload.iat).toBeNumber()
    expect(payload.exp).toBe(payload.iat + 300)
    expect(payload.jti).toBeString()
  })

  test("signature is 65 bytes with v = 0 or 1", async () => {
    const jwt = await createGatewayJWT({ test: true })
    const sigB64 = jwt.split(".")[2]
    const sigBytes = Buffer.from(sigB64, "base64url")

    expect(sigBytes.length).toBe(65)
    expect(sigBytes[64]).toBeLessThanOrEqual(1)
  })
})

// ─────────────────────────────────────────────
// triggerWorkflow
// ─────────────────────────────────────────────

describe("triggerWorkflow", () => {
  test("success: sends POST with Bearer JWT and returns result", async () => {
    const mockResponse = {
      jsonrpc: "2.0",
      id: "test-id",
      result: { data: "success" },
    }

    globalThis.fetch = mock(async () => new Response(
      JSON.stringify(mockResponse),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as any

    const result = await triggerWorkflow("don-workflow-123")

    expect(result.result).toEqual({ data: "success" })

    const fetchCall = (globalThis.fetch as any).mock.calls[0]
    expect(fetchCall[0]).toBe(TEST_GATEWAY_URL)
    expect(fetchCall[1].method).toBe("POST")
    expect(fetchCall[1].headers.Authorization).toStartWith("Bearer ")
    expect(fetchCall[1].headers["Content-Type"]).toBe("application/json")
  })

  test("gateway HTTP error throws GATEWAY_ERROR", async () => {
    globalThis.fetch = mock(async () => new Response(
      JSON.stringify({ error: { message: "Internal error" } }),
      { status: 500 },
    )) as any

    try {
      await triggerWorkflow("don-workflow-123")
      expect(true).toBe(false) // should not reach
    } catch (err: any) {
      expect(err.code).toBe("GATEWAY_ERROR")
      expect(err.statusCode).toBe(502)
    }
  })

  test("timeout throws GATEWAY_TIMEOUT", async () => {
    const abortError = new Error("The operation was aborted")
    abortError.name = "AbortError"

    globalThis.fetch = mock(async () => { throw abortError }) as any

    try {
      await triggerWorkflow("don-workflow-123")
      expect(true).toBe(false)
    } catch (err: any) {
      expect(err.code).toBe("GATEWAY_TIMEOUT")
      expect(err.statusCode).toBe(504)
    }
  })

  test("RPC error in response throws GATEWAY_ERROR", async () => {
    globalThis.fetch = mock(async () => new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "test",
        error: { code: -32000, message: "workflow not found" },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as any

    try {
      await triggerWorkflow("don-workflow-123")
      expect(true).toBe(false)
    } catch (err: any) {
      expect(err.code).toBe("GATEWAY_ERROR")
      expect(err.message).toContain("workflow not found")
    }
  })

  test("invalid JSON response throws GATEWAY_ERROR", async () => {
    globalThis.fetch = mock(async () => new Response(
      "not json",
      { status: 200 },
    )) as any

    try {
      await triggerWorkflow("don-workflow-123")
      expect(true).toBe(false)
    } catch (err: any) {
      expect(err.code).toBe("GATEWAY_ERROR")
      expect(err.message).toContain("invalid JSON")
    }
  })

  test("network error throws GATEWAY_ERROR", async () => {
    globalThis.fetch = mock(async () => { throw new Error("ECONNREFUSED") }) as any

    try {
      await triggerWorkflow("don-workflow-123")
      expect(true).toBe(false)
    } catch (err: any) {
      expect(err.code).toBe("GATEWAY_ERROR")
      expect(err.statusCode).toBe(502)
    }
  })
})
