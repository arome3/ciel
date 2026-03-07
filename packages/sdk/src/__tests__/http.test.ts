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

describe("HttpClient", () => {
  test("makes GET request and returns parsed JSON", async () => {
    const { HttpClient } = await import("../http")
    const client = new HttpClient("http://localhost:3001")

    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }))
    const result = await client.request<{ ok: boolean }>("/api/test")

    expect(result).toEqual({ ok: true })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url] = mockFetch.mock.calls[0]
    expect(url).toBe("http://localhost:3001/api/test")
  })

  test("strips trailing slash from baseUrl", async () => {
    const { HttpClient } = await import("../http")
    const client = new HttpClient("http://localhost:3001/")

    mockFetch.mockResolvedValueOnce(jsonResponse({}))
    await client.request("/api/test")

    const [url] = mockFetch.mock.calls[0]
    expect(url).toBe("http://localhost:3001/api/test")
  })

  test("throws CielSDKError on non-OK response with error.message", async () => {
    const { HttpClient } = await import("../http")
    const { CielSDKError } = await import("../types")
    const client = new HttpClient("http://localhost:3001")

    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { message: "Not found" } }),
        { status: 404 },
      ),
    )

    try {
      await client.request("/api/missing")
      expect(true).toBe(false) // should not reach
    } catch (err) {
      expect(err).toBeInstanceOf(CielSDKError)
      expect((err as any).code).toBe("API_ERROR")
      expect((err as any).statusCode).toBe(404)
      expect((err as any).message).toBe("Not found")
    }
  })

  test("throws CielSDKError with default message on unparseable error body", async () => {
    const { HttpClient } = await import("../http")
    const { CielSDKError } = await import("../types")
    const client = new HttpClient("http://localhost:3001")

    mockFetch.mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 }),
    )

    try {
      await client.request("/api/broken")
      expect(true).toBe(false)
    } catch (err) {
      expect(err).toBeInstanceOf(CielSDKError)
      expect((err as any).message).toContain("500")
    }
  })

  test("throws API_UNREACHABLE on connection failure", async () => {
    const { HttpClient } = await import("../http")
    const { CielSDKError } = await import("../types")
    const client = new HttpClient("http://localhost:3001")

    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"))

    try {
      await client.request("/api/test")
      expect(true).toBe(false)
    } catch (err) {
      expect(err).toBeInstanceOf(CielSDKError)
      expect((err as any).code).toBe("API_UNREACHABLE")
    }
  })
})

describe("qs()", () => {
  test("returns empty string for undefined params", async () => {
    const { qs } = await import("../http")
    expect(qs()).toBe("")
    expect(qs(undefined)).toBe("")
  })

  test("returns empty string for empty params", async () => {
    const { qs } = await import("../http")
    expect(qs({})).toBe("")
  })

  test("builds query string from params", async () => {
    const { qs } = await import("../http")
    const result = qs({ category: "core-defi", page: 1 })
    expect(result).toContain("category=core-defi")
    expect(result).toContain("page=1")
    expect(result.startsWith("?")).toBe(true)
  })

  test("skips undefined values", async () => {
    const { qs } = await import("../http")
    const result = qs({ category: "core-defi", chain: undefined })
    expect(result).toBe("?category=core-defi")
  })
})
