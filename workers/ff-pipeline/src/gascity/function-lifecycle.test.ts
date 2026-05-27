import { describe, expect, it, vi } from "vitest"
import { assertFunctionTransition, transitionFunctionState } from "./function-lifecycle.js"

describe("Gas City Function lifecycle", () => {
  it("allows dispatched to accepted or rejected", () => {
    expect(() => assertFunctionTransition("dispatched", "accepted")).not.toThrow()
    expect(() => assertFunctionTransition("dispatched", "rejected")).not.toThrow()
  })

  it("rejects unobservable synthesis-era jumps", () => {
    expect(() => assertFunctionTransition("proposed", "accepted")).toThrow(/Invalid Function state transition/)
  })

  it("updates denormalized state and writes an append-only transition edge", async () => {
    const db = {
      update: vi.fn(async () => ({})),
      saveEdge: vi.fn(async () => ({})),
    }

    await transitionFunctionState(db, {
      functionId: "FN-GC-DISPATCH-WIRE",
      from: "dispatched",
      to: "accepted",
      evidenceKey: "VR-ABCDEF0123456789",
      trigger: "gascity-webhook",
      timestamp: "2026-05-27T23:30:00.000Z",
    })

    expect(db.update).toHaveBeenCalledWith("specs_functions", "FN-GC-DISPATCH-WIRE", {
      state: "accepted",
      state_updated_at: "2026-05-27T23:30:00.000Z",
      state_evidence_key: "VR-ABCDEF0123456789",
    })
    expect(db.saveEdge).toHaveBeenCalledWith(
      "lifecycle_transitions",
      "specs_functions/FN-GC-DISPATCH-WIRE",
      "specs_functions/FN-GC-DISPATCH-WIRE",
      expect.objectContaining({
        from: "dispatched",
        to: "accepted",
        evidence_key: "VR-ABCDEF0123456789",
      }),
    )
  })
})

