import { describe, test, expect, beforeEach } from "bun:test"
import { TxMutex, _resetTxMutex, txMutex } from "../services/blockchain/nonce-manager"

describe("TxMutex", () => {
  let mutex: TxMutex

  beforeEach(() => {
    mutex = new TxMutex()
  })

  test("allows first caller through immediately", async () => {
    const result = await mutex.withLock(async () => "done")
    expect(result).toBe("done")
  })

  test("queues second caller until first completes", async () => {
    const order: number[] = []
    let resolveFirst: (() => void) | undefined

    const firstDone = new Promise<void>((r) => {
      resolveFirst = r
    })

    // Start first lock (will block)
    const first = mutex.withLock(async () => {
      await firstDone
      order.push(1)
      return "first"
    })

    // Start second lock (should queue)
    const second = mutex.withLock(async () => {
      order.push(2)
      return "second"
    })

    // Let first complete
    resolveFirst!()

    const [r1, r2] = await Promise.all([first, second])
    expect(r1).toBe("first")
    expect(r2).toBe("second")
    expect(order).toEqual([1, 2])
  })

  test("maintains FIFO order for multiple waiters", async () => {
    const order: number[] = []
    let resolveFirst: (() => void) | undefined

    const firstDone = new Promise<void>((r) => {
      resolveFirst = r
    })

    const p1 = mutex.withLock(async () => {
      await firstDone
      order.push(1)
    })

    const p2 = mutex.withLock(async () => {
      order.push(2)
    })

    const p3 = mutex.withLock(async () => {
      order.push(3)
    })

    resolveFirst!()
    await Promise.all([p1, p2, p3])

    expect(order).toEqual([1, 2, 3])
  })

  test("releases lock on error", async () => {
    // First call throws
    await expect(
      mutex.withLock(async () => {
        throw new Error("boom")
      })
    ).rejects.toThrow("boom")

    // Second call should still work (lock released in finally)
    const result = await mutex.withLock(async () => "recovered")
    expect(result).toBe("recovered")
  })

  test("singleton reset works for tests", () => {
    // Verify the exported singleton exists and can be reset
    expect(txMutex).toBeInstanceOf(TxMutex)
    _resetTxMutex()
    // After reset, should work normally
    const result = txMutex.withLock(async () => "ok")
    expect(result).resolves.toBe("ok")
  })
})
