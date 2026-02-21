import { describe, test, expect } from "bun:test"
import { Semaphore } from "../lib/semaphore"

// ─────────────────────────────────────────────
// Pure unit tests — no mocks needed
// ─────────────────────────────────────────────

describe("Semaphore", () => {
  test("acquire increments activeCount up to max", async () => {
    const sem = new Semaphore(2)

    await sem.acquire()
    expect(sem._getState().activeCount).toBe(1)

    await sem.acquire()
    expect(sem._getState().activeCount).toBe(2)
  })

  test("acquire queues when at max capacity", async () => {
    const sem = new Semaphore(1)
    await sem.acquire()

    let acquired = false
    const p = sem.acquire().then(() => { acquired = true })

    // Should be queued, not acquired yet
    expect(sem._getState().queueLength).toBe(1)
    expect(acquired).toBe(false)

    sem.release()
    await p

    expect(acquired).toBe(true)
    expect(sem._getState().activeCount).toBe(1)
    expect(sem._getState().queueLength).toBe(0)
  })

  test("release decrements and dequeues next waiter", async () => {
    const sem = new Semaphore(1)
    await sem.acquire()

    const order: number[] = []
    const p1 = sem.acquire().then(() => { order.push(1) })
    const p2 = sem.acquire().then(() => { order.push(2) })

    expect(sem._getState().queueLength).toBe(2)

    sem.release()
    await p1
    expect(order).toEqual([1])

    sem.release()
    await p2
    expect(order).toEqual([1, 2])
  })

  test("floor guard: release on count 0 is no-op", () => {
    const sem = new Semaphore(3)

    // Release without any acquire — should not go negative
    sem.release()
    sem.release()
    sem.release()

    expect(sem._getState().activeCount).toBe(0)
    expect(sem._getState().queueLength).toBe(0)
  })

  test("concurrent: N+1 tasks with max N all complete", async () => {
    const sem = new Semaphore(2)
    const results: number[] = []

    const task = async (id: number) => {
      await sem.acquire()
      // Simulate async work
      await new Promise((r) => setTimeout(r, 5))
      results.push(id)
      sem.release()
    }

    await Promise.all([task(1), task(2), task(3)])

    expect(results).toHaveLength(3)
    expect(results.sort()).toEqual([1, 2, 3])
    expect(sem._getState().activeCount).toBe(0)
    expect(sem._getState().queueLength).toBe(0)
  })

  test("acquire with timeout rejects when semaphore full", async () => {
    const sem = new Semaphore(1)
    await sem.acquire()

    // Try to acquire with a short timeout — should reject
    let rejected = false
    try {
      await sem.acquire(50)
    } catch (err: any) {
      rejected = true
      expect(err.message).toContain("timed out")
    }

    expect(rejected).toBe(true)
    // The timed-out waiter should be removed from queue
    expect(sem._getState().queueLength).toBe(0)

    sem.release()
  })

  test("acquire with timeout succeeds when released in time", async () => {
    const sem = new Semaphore(1)
    await sem.acquire()

    // Release after 10ms — acquire with 200ms timeout should succeed
    setTimeout(() => sem.release(), 10)

    await sem.acquire(200) // Should not throw
    expect(sem._getState().activeCount).toBe(1)

    sem.release()
  })

  test("acquire without timeout preserves existing behavior", async () => {
    const sem = new Semaphore(1)
    await sem.acquire()

    let acquired = false
    const p = sem.acquire().then(() => { acquired = true })

    expect(acquired).toBe(false)
    sem.release()
    await p
    expect(acquired).toBe(true)

    sem.release()
  })

  test("_getState returns correct shape", () => {
    const sem = new Semaphore(5)
    const state = sem._getState()

    expect(state).toHaveProperty("activeCount")
    expect(state).toHaveProperty("queueLength")
    expect(typeof state.activeCount).toBe("number")
    expect(typeof state.queueLength).toBe("number")
  })
})
