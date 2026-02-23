import { describe, test, expect } from "bun:test"
import { requestId } from "../middleware/request-id"

// ─────────────────────────────────────────────
// Helpers — minimal Express-like mocks
// ─────────────────────────────────────────────

function createMockReq(headers: Record<string, string> = {}): any {
  return { headers, requestId: undefined }
}

function createMockRes(): any {
  const _headers: Record<string, string> = {}
  return {
    setHeader(key: string, value: string) { _headers[key] = value },
    getHeader(key: string) { return _headers[key] },
    _headers,
  }
}

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

describe("requestId middleware", () => {
  test("generates a UUID when no X-Request-Id header is present", () => {
    const req = createMockReq()
    const res = createMockRes()
    let nextCalled = false

    requestId(req, res, () => { nextCalled = true })

    expect(nextCalled).toBe(true)
    expect(req.requestId).toBeDefined()
    expect(typeof req.requestId).toBe("string")
    expect(req.requestId!.length).toBe(36) // UUID format
    expect(res._headers["X-Request-Id"]).toBe(req.requestId)
  })

  test("uses existing X-Request-Id header when present", () => {
    const customId = "my-custom-request-id-123"
    const req = createMockReq({ "x-request-id": customId })
    const res = createMockRes()

    requestId(req, res, () => {})

    expect(req.requestId).toBe(customId)
    expect(res._headers["X-Request-Id"]).toBe(customId)
  })

  test("always calls next()", () => {
    const req = createMockReq()
    const res = createMockRes()
    let nextCalled = false

    requestId(req, res, () => { nextCalled = true })

    expect(nextCalled).toBe(true)
  })

  test("echoes request ID in response header", () => {
    const req = createMockReq()
    const res = createMockRes()

    requestId(req, res, () => {})

    expect(res._headers["X-Request-Id"]).toBe(req.requestId)
  })
})
