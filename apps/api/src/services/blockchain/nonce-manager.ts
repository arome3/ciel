/// Async mutex for serializing blockchain write transactions.
/// Prevents nonce collisions when multiple writes are in-flight.

type QueueEntry = {
  resolve: () => void
}

export class TxMutex {
  private _locked = false
  private _queue: QueueEntry[] = []

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await this._acquire()
    try {
      return await fn()
    } finally {
      this._release()
    }
  }

  private _acquire(): Promise<void> {
    if (!this._locked) {
      this._locked = true
      return Promise.resolve()
    }

    return new Promise<void>((resolve) => {
      this._queue.push({ resolve })
    })
  }

  private _release(): void {
    const next = this._queue.shift()
    if (next) {
      next.resolve()
    } else {
      this._locked = false
    }
  }
}

export const txMutex = new TxMutex()

/// Test-only reset
export function _resetTxMutex(): void {
  Object.assign(txMutex, { _locked: false, _queue: [] })
}
