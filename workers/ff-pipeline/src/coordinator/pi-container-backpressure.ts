export type BoundedSerialQueueAccepted<T> = {
  accepted: true
  value: T
  queued: boolean
  waitedMs: number
}

export type BoundedSerialQueueRejected = {
  accepted: false
  reason: "queue_full"
  active: boolean
  waiting: number
  maxQueued: number
}

export type BoundedSerialQueueResult<T> =
  | BoundedSerialQueueAccepted<T>
  | BoundedSerialQueueRejected

export class BoundedSerialQueue {
  private active = false
  private waiting = 0
  private tail: Promise<void> = Promise.resolve()

  constructor(private readonly maxQueued: number) {}

  snapshot(): { active: boolean; waiting: number; maxQueued: number } {
    return {
      active: this.active,
      waiting: this.waiting,
      maxQueued: this.maxQueued,
    }
  }

  async run<T>(task: () => Promise<T>): Promise<BoundedSerialQueueResult<T>> {
    const queued = this.active || this.waiting > 0
    if (queued && this.waiting >= this.maxQueued) {
      return {
        accepted: false,
        reason: "queue_full",
        ...this.snapshot(),
      }
    }

    if (queued) {
      this.waiting += 1
    } else {
      this.active = true
    }
    const queuedAt = Date.now()
    const previous = this.tail
    let release: () => void = () => {}
    this.tail = new Promise<void>((resolve) => {
      release = resolve
    })

    await previous.catch(() => {})
    if (queued) {
      this.waiting -= 1
      this.active = true
    }

    try {
      const value = await task()
      return {
        accepted: true,
        value,
        queued,
        waitedMs: Date.now() - queuedAt,
      }
    } finally {
      this.active = false
      release()
    }
  }
}
