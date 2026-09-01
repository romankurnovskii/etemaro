/**
 * @file mutex.ts
 * @description Lightweight in-process async mutex for serializing asynchronous critical sections.
 */

export class Mutex {
  private queue: Promise<void> = Promise.resolve()
  private _locked = false

  /**
   * Return true if the mutex is currently locked.
   */
  isLocked(): boolean {
    return this._locked
  }

  /**
   * Execute an asynchronous or synchronous callback exclusively under the mutex lock.
   */
  async runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const release = await this.acquire()
    try {
      return await fn()
    } finally {
      release()
    }
  }

  /**
   * Acquire lock manually. Returns a release function that MUST be called when finished.
   */
  async acquire(): Promise<() => void> {
    let release!: () => void
    const waiter = new Promise<void>((resolve) => {
      release = resolve
    })

    const previous = this.queue
    this.queue = previous.then(
      () => waiter,
      () => waiter,
    )

    await previous
    this._locked = true
    return () => {
      this._locked = false
      release?.()
    }
  }
}
