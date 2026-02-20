import { describe, test, expect, mock, beforeAll } from "bun:test"
import { resolve } from "path"

// ─────────────────────────────────────────────
// Mocks — external boundaries only
// ─────────────────────────────────────────────

const SRC = resolve(import.meta.dir, "..")

// ── Logger mock ──
mock.module(resolve(SRC, "lib/logger.ts"), () => ({
  createLogger: () => ({
    debug: () => {},
    info: mock(),
    warn: mock(),
    error: () => {},
  }),
}))

// ── @x402/extensions/bazaar mock ──
const mockRegisterExtension = mock()
const mockDeclareDiscoveryExtension = mock(
  (config: any) => ({ discovery: { info: config, schema: {} } }),
)
const mockBazaarResourceServerExtension = { name: "bazaar" }

mock.module("@x402/extensions/bazaar", () => ({
  bazaarResourceServerExtension: mockBazaarResourceServerExtension,
  declareDiscoveryExtension: mockDeclareDiscoveryExtension,
}))

// ── Dynamic import ──
let registerBazaarExtension: any
let getWorkflowDiscoveryExtension: any
beforeAll(async () => {
  const mod = await import("../services/x402/bazaar")
  registerBazaarExtension = mod.registerBazaarExtension
  getWorkflowDiscoveryExtension = mod.getWorkflowDiscoveryExtension
})

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

describe("Bazaar — registerBazaarExtension", () => {
  test("calls registerExtension on resource server with bazaar extension", () => {
    const mockServer = { registerExtension: mock() }
    registerBazaarExtension(mockServer)
    expect(mockServer.registerExtension).toHaveBeenCalledWith(
      mockBazaarResourceServerExtension,
    )
  })
})

describe("Bazaar — getWorkflowDiscoveryExtension", () => {
  test("returns an object from declareDiscoveryExtension", () => {
    const result = getWorkflowDiscoveryExtension()
    expect(result).toBeDefined()
    expect(typeof result).toBe("object")
  })

  test("calls declareDiscoveryExtension with input example", () => {
    getWorkflowDiscoveryExtension()
    const lastCall =
      mockDeclareDiscoveryExtension.mock.calls[
        mockDeclareDiscoveryExtension.mock.calls.length - 1
      ]
    expect(lastCall[0].input).toBeDefined()
    expect(lastCall[0].input.workflowId).toBe("uuid")
  })

  test("includes inputSchema with workflowId property", () => {
    getWorkflowDiscoveryExtension()
    const lastCall =
      mockDeclareDiscoveryExtension.mock.calls[
        mockDeclareDiscoveryExtension.mock.calls.length - 1
      ]
    expect(lastCall[0].inputSchema.properties.workflowId).toBeDefined()
  })

  test("includes output with example and schema", () => {
    getWorkflowDiscoveryExtension()
    const lastCall =
      mockDeclareDiscoveryExtension.mock.calls[
        mockDeclareDiscoveryExtension.mock.calls.length - 1
      ]
    expect(lastCall[0].output.example).toBeDefined()
    expect(lastCall[0].output.schema).toBeDefined()
  })
})

