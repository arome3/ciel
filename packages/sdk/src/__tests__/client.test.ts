import { describe, test, expect, mock, afterEach, beforeAll } from "bun:test"

// ─────────────────────────────────────────────
// Mock global fetch
// ─────────────────────────────────────────────

const mockFetch = mock<typeof fetch>()

beforeAll(() => {
  globalThis.fetch = mockFetch as any
})

afterEach(() => {
  mockFetch.mockReset()
})

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

describe("CielSDK", () => {
  describe("discover()", () => {
    test("sends GET /api/discover and returns workflow array", async () => {
      const { CielSDK } = await import("../client")
      const sdk = new CielSDK({ apiUrl: "http://localhost:3001" })

      const workflows = [
        { workflowId: "uuid-1", name: "ETH Oracle" },
        { workflowId: "uuid-2", name: "Weather Alert" },
      ]
      mockFetch.mockResolvedValueOnce(jsonResponse(workflows))

      const result = await sdk.discover()

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [url] = mockFetch.mock.calls[0]
      expect(url).toBe("http://localhost:3001/api/discover")
      expect(result).toHaveLength(2)
      expect(result[0].name).toBe("ETH Oracle")
    })

    test("passes filter query params", async () => {
      const { CielSDK } = await import("../client")
      const sdk = new CielSDK({ apiUrl: "http://localhost:3001" })

      mockFetch.mockResolvedValueOnce(jsonResponse([]))

      await sdk.discover({ category: "core-defi", chain: "base-sepolia" })

      const [url] = mockFetch.mock.calls[0]
      expect(url).toContain("category=core-defi")
      expect(url).toContain("chain=base-sepolia")
    })

    test("works with no query params", async () => {
      const { CielSDK } = await import("../client")
      const sdk = new CielSDK({ apiUrl: "http://localhost:3001" })

      mockFetch.mockResolvedValueOnce(jsonResponse([]))

      const result = await sdk.discover()

      const [url] = mockFetch.mock.calls[0]
      expect(url).toBe("http://localhost:3001/api/discover")
      expect(result).toEqual([])
    })
  })

  describe("getWorkflow()", () => {
    test("sends GET /api/workflows/{id}", async () => {
      const { CielSDK } = await import("../client")
      const sdk = new CielSDK({ apiUrl: "http://localhost:3001" })

      const workflow = { id: "uuid-1", name: "ETH Oracle", code: "..." }
      mockFetch.mockResolvedValueOnce(jsonResponse(workflow))

      const result = await sdk.getWorkflow("uuid-1")

      const [url] = mockFetch.mock.calls[0]
      expect(url).toBe("http://localhost:3001/api/workflows/uuid-1")
      expect(result.name).toBe("ETH Oracle")
    })
  })

  describe("listWorkflows()", () => {
    test("builds correct query string", async () => {
      const { CielSDK } = await import("../client")
      const sdk = new CielSDK({ apiUrl: "http://localhost:3001" })

      const response = { workflows: [], total: 0, page: 1, limit: 20 }
      mockFetch.mockResolvedValueOnce(jsonResponse(response))

      await sdk.listWorkflows({ page: 2, limit: 10, category: "ai-powered" })

      const [url] = mockFetch.mock.calls[0]
      expect(url).toContain("page=2")
      expect(url).toContain("limit=10")
      expect(url).toContain("category=ai-powered")
    })
  })

  describe("execute()", () => {
    test("throws PAYMENT_NOT_CONFIGURED without privateKey", async () => {
      const { CielSDK } = await import("../client")
      const { CielSDKError } = await import("../types")
      const sdk = new CielSDK({ apiUrl: "http://localhost:3001" })

      try {
        await sdk.execute("uuid-1")
        expect(true).toBe(false) // should not reach
      } catch (err) {
        expect(err).toBeInstanceOf(CielSDKError)
        expect((err as CielSDKError).code).toBe("PAYMENT_NOT_CONFIGURED")
      }
    })

    test("throws WORKFLOW_NOT_PUBLISHED when x402Endpoint is null", async () => {
      const { CielSDK } = await import("../client")
      const { CielSDKError } = await import("../types")
      const sdk = new CielSDK({
        apiUrl: "http://localhost:3001",
        privateKey: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      })

      // getWorkflow returns a workflow with no x402Endpoint
      mockFetch.mockResolvedValueOnce(jsonResponse({
        id: "uuid-1",
        name: "Test",
        x402Endpoint: null,
      }))

      try {
        await sdk.execute("uuid-1")
        expect(true).toBe(false)
      } catch (err) {
        expect(err).toBeInstanceOf(CielSDKError)
        expect((err as CielSDKError).code).toBe("WORKFLOW_NOT_PUBLISHED")
      }
    })
  })

  describe("error handling", () => {
    test("API errors extracted correctly from body.error.message", async () => {
      const { CielSDK } = await import("../client")
      const { CielSDKError } = await import("../types")
      const sdk = new CielSDK({ apiUrl: "http://localhost:3001" })

      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { code: "WORKFLOW_NOT_FOUND", message: "Workflow not found" } }),
          { status: 404 },
        ),
      )

      try {
        await sdk.getWorkflow("nonexistent")
        expect(true).toBe(false)
      } catch (err) {
        expect(err).toBeInstanceOf(CielSDKError)
        expect((err as CielSDKError).code).toBe("API_ERROR")
        expect((err as CielSDKError).statusCode).toBe(404)
        expect((err as CielSDKError).message).toBe("Workflow not found")
      }
    })

    test("connection failures produce API_UNREACHABLE", async () => {
      const { CielSDK } = await import("../client")
      const { CielSDKError } = await import("../types")
      const sdk = new CielSDK({ apiUrl: "http://localhost:9999" })

      mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"))

      try {
        await sdk.discover()
        expect(true).toBe(false)
      } catch (err) {
        expect(err).toBeInstanceOf(CielSDKError)
        expect((err as CielSDKError).code).toBe("API_UNREACHABLE")
      }
    })
  })
})
