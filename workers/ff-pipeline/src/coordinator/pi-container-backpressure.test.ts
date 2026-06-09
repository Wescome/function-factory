import { describe, expect, it } from "vitest"
import {
  BoundedQueueTaskTimeoutError,
  BoundedSerialQueue,
  withTaskTimeout,
} from "./pi-container-backpressure.js"

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe("BoundedSerialQueue", () => {
  it("runs accepted tasks one at a time", async () => {
    const queue = new BoundedSerialQueue(4)
    const first = deferred()
    const order: string[] = []

    const firstRun = queue.run(async () => {
      order.push("first-start")
      await first.promise
      order.push("first-end")
      return "first"
    })
    const secondRun = queue.run(async () => {
      order.push("second-start")
      return "second"
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(order).toEqual(["first-start"])
    first.resolve()

    await expect(firstRun).resolves.toMatchObject({ accepted: true, value: "first" })
    await expect(secondRun).resolves.toMatchObject({ accepted: true, value: "second" })
    expect(order).toEqual(["first-start", "first-end", "second-start"])
  })

  it("rejects when the wait queue is full", async () => {
    const queue = new BoundedSerialQueue(1)
    const first = deferred()

    const firstRun = queue.run(async () => {
      await first.promise
      return "first"
    })
    const secondRun = queue.run(async () => "second")
    const thirdRun = await queue.run(async () => "third")

    expect(thirdRun).toEqual({
      accepted: false,
      reason: "queue_full",
      active: true,
      waiting: 1,
      maxQueued: 1,
    })

    first.resolve()
    await firstRun
    await secondRun
  })

  it("times out a hung task so callers can release singleton backpressure", async () => {
    await expect(withTaskTimeout(
      new Promise(() => {}),
      1,
      "hung task",
    )).rejects.toBeInstanceOf(BoundedQueueTaskTimeoutError)
  })
})
