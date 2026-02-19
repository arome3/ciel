import { describe, test, expect } from "bun:test"
import { withRetry, isRetryableRpcError } from "../services/blockchain/retry"

describe("isRetryableRpcError", () => {
  test("returns true for timeout errors", () => {
    expect(isRetryableRpcError(new Error("ETIMEDOUT"))).toBe(true)
  })

  test("returns true for connection reset", () => {
    expect(isRetryableRpcError(new Error("ECONNRESET"))).toBe(true)
  })

  test("returns true for connection refused", () => {
    expect(isRetryableRpcError(new Error("ECONNREFUSED"))).toBe(true)
  })

  test("returns true for 429 rate limit", () => {
    expect(isRetryableRpcError(new Error("429 Too Many Requests"))).toBe(true)
  })

  test("returns true for 502/503/504 gateway errors", () => {
    expect(isRetryableRpcError(new Error("502 Bad Gateway"))).toBe(true)
    expect(isRetryableRpcError(new Error("503 Service Unavailable"))).toBe(true)
    expect(isRetryableRpcError(new Error("504 Gateway Timeout"))).toBe(true)
  })

  test("returns false for contract reverts", () => {
    expect(isRetryableRpcError(new Error("execution reverted"))).toBe(false)
    expect(isRetryableRpcError(new Error("ContractFunctionExecutionError: revert"))).toBe(false)
  })

  test("returns false for unknown errors", () => {
    expect(isRetryableRpcError(new Error("something unexpected"))).toBe(false)
  })
})

describe("withRetry", () => {
  test("returns on first success", async () => {
    let calls = 0
    const result = await withRetry(async () => {
      calls++
      return 42
    })

    expect(result).toBe(42)
    expect(calls).toBe(1)
  })

  test("retries on retryable error then succeeds", async () => {
    let calls = 0
    const result = await withRetry(
      async () => {
        calls++
        if (calls < 3) throw new Error("ECONNRESET")
        return "ok"
      },
      { maxRetries: 3, baseDelay: 10, maxDelay: 50 }
    )

    expect(result).toBe("ok")
    expect(calls).toBe(3)
  })

  test("throws after max retries exhausted", async () => {
    let calls = 0
    await expect(
      withRetry(
        async () => {
          calls++
          throw new Error("ETIMEDOUT")
        },
        { maxRetries: 2, baseDelay: 10, maxDelay: 50 }
      )
    ).rejects.toThrow("ETIMEDOUT")

    expect(calls).toBe(3) // initial + 2 retries
  })

  test("does not retry on contract revert", async () => {
    let calls = 0
    await expect(
      withRetry(
        async () => {
          calls++
          throw new Error("execution reverted: Unauthorized()")
        },
        { maxRetries: 3, baseDelay: 10 }
      )
    ).rejects.toThrow("execution reverted")

    expect(calls).toBe(1) // no retry
  })

  test("applies exponential backoff", async () => {
    const timestamps: number[] = []
    let calls = 0

    await expect(
      withRetry(
        async () => {
          timestamps.push(Date.now())
          calls++
          throw new Error("ECONNRESET")
        },
        { maxRetries: 2, baseDelay: 50, maxDelay: 500 }
      )
    ).rejects.toThrow()

    expect(calls).toBe(3)
    // Second call should be ~50ms after first, third ~100ms after second
    const gap1 = timestamps[1]! - timestamps[0]!
    const gap2 = timestamps[2]! - timestamps[1]!
    expect(gap1).toBeGreaterThanOrEqual(40) // ~50ms with tolerance
    expect(gap2).toBeGreaterThanOrEqual(80) // ~100ms with tolerance
  })

  test("caps delay at maxDelay", async () => {
    const timestamps: number[] = []
    let calls = 0

    await expect(
      withRetry(
        async () => {
          timestamps.push(Date.now())
          calls++
          throw new Error("ECONNRESET")
        },
        { maxRetries: 4, baseDelay: 50, maxDelay: 80 }
      )
    ).rejects.toThrow()

    // After attempt 2+, delay would be 200ms but capped at 80ms
    const lastGap = timestamps[timestamps.length - 1]! - timestamps[timestamps.length - 2]!
    expect(lastGap).toBeLessThan(150) // Should be ~80ms, not 200+
  })
})
