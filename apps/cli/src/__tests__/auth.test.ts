import { describe, it, expect } from "bun:test"
import { requireAuth, tryAuth, workflowAuthHeaders, pipelineAuthHeaders } from "../auth"
import type { CliConfig } from "../config"

function makeConfig(overrides?: Partial<CliConfig>): CliConfig {
  return {
    apiUrl: "http://localhost:3001",
    privateKey: undefined,
    timeout: 5000,
    jsonMode: false,
    noColor: false,
    defaultChain: "base-sepolia",
    ...overrides,
  }
}

// Known test private key (do not use in production)
const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
const EXPECTED_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"

describe("auth", () => {
  describe("requireAuth", () => {
    it("throws when no private key is set", () => {
      expect(() => requireAuth(makeConfig())).toThrow("authentication")
    })

    it("returns auth context with valid private key", () => {
      const auth = requireAuth(makeConfig({ privateKey: TEST_KEY }))
      expect(auth.address).toBe(EXPECTED_ADDRESS)
      expect(typeof auth.sign).toBe("function")
    })
  })

  describe("tryAuth", () => {
    it("returns null when no private key", () => {
      const result = tryAuth(makeConfig())
      expect(result).toBeNull()
    })

    it("returns auth context when key is available", () => {
      const result = tryAuth(makeConfig({ privateKey: TEST_KEY }))
      expect(result).not.toBeNull()
      expect(result!.address).toBe(EXPECTED_ADDRESS)
    })
  })

  describe("workflowAuthHeaders", () => {
    it("returns correct header shape", async () => {
      const auth = requireAuth(makeConfig({ privateKey: TEST_KEY }))
      const headers = await workflowAuthHeaders(auth, "workflow-123")

      expect(headers["X-Owner-Address"]).toBe(EXPECTED_ADDRESS)
      expect(headers["X-Owner-Signature"]).toBeDefined()
      expect(headers["X-Owner-Signature"].startsWith("0x")).toBe(true)
    })

    it("signs the workflow ID", async () => {
      const auth = requireAuth(makeConfig({ privateKey: TEST_KEY }))
      const h1 = await workflowAuthHeaders(auth, "wf-1")
      const h2 = await workflowAuthHeaders(auth, "wf-2")

      // Different workflow IDs produce different signatures
      expect(h1["X-Owner-Signature"]).not.toBe(h2["X-Owner-Signature"])
    })
  })

  describe("pipelineAuthHeaders", () => {
    it("returns correct header shape with timestamp", async () => {
      const auth = requireAuth(makeConfig({ privateKey: TEST_KEY }))
      const headers = await pipelineAuthHeaders(auth, "pipeline-123")

      expect(headers["X-Owner-Address"]).toBe(EXPECTED_ADDRESS)
      expect(headers["X-Owner-Signature"]).toBeDefined()
      expect(headers["X-Owner-Timestamp"]).toBeDefined()

      const ts = Number(headers["X-Owner-Timestamp"])
      expect(Number.isNaN(ts)).toBe(false)
      expect(Math.abs(Date.now() - ts)).toBeLessThan(5000)
    })

    it("produces different signatures for different pipeline IDs", async () => {
      const auth = requireAuth(makeConfig({ privateKey: TEST_KEY }))
      const h1 = await pipelineAuthHeaders(auth, "p-1")
      const h2 = await pipelineAuthHeaders(auth, "p-2")

      expect(h1["X-Owner-Signature"]).not.toBe(h2["X-Owner-Signature"])
    })
  })
})
