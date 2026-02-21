// apps/api/src/lib/semaphore.ts
// Reusable concurrency semaphore — limits parallel async operations.

export class Semaphore {
  private activeCount = 0
  private readonly waitQueue: Array<() => void> = []

  constructor(private readonly maxConcurrent: number) {}

  async acquire(timeoutMs?: number): Promise<void> {
    if (this.activeCount < this.maxConcurrent) {
      this.activeCount++
      return
    }

    return new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null

      const waiter = () => {
        if (timer) clearTimeout(timer)
        this.activeCount++
        resolve()
      }

      this.waitQueue.push(waiter)

      if (timeoutMs !== undefined) {
        timer = setTimeout(() => {
          const idx = this.waitQueue.indexOf(waiter)
          if (idx !== -1) this.waitQueue.splice(idx, 1)
          reject(new Error(`Semaphore acquire timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      }
    })
  }

  release(): void {
    if (this.activeCount <= 0) return // Floor guard: no-op on double-release
    this.activeCount--
    const next = this.waitQueue.shift()
    if (next) next()
  }

  // Test-only introspection (follows _prefix convention)
  _getState(): { activeCount: number; queueLength: number } {
    return { activeCount: this.activeCount, queueLength: this.waitQueue.length }
  }
}
