import { describe, expect, it, vi } from "vitest"
import { ensureGasCityCollections } from "./collection-schema.js"

describe("Gas City collection schema", () => {
  it("ensures Gas City collections with lifecycle transitions as an edge collection", async () => {
    const db = {
      ensureCollection: vi.fn(async () => {}),
      ensureIndex: vi.fn(async () => {}),
    }

    await ensureGasCityCollections(db)

    expect(db.ensureCollection).toHaveBeenCalledWith("completion_events", { type: "document" })
    expect(db.ensureCollection).toHaveBeenCalledWith("fidelity_verdicts", { type: "document" })
    expect(db.ensureCollection).toHaveBeenCalledWith("webhook_rejections", { type: "document" })
    expect(db.ensureCollection).toHaveBeenCalledWith("lifecycle_transitions", { type: "edge" })
  })

  it("ensures the critical Gas City query indexes", async () => {
    const db = {
      ensureCollection: vi.fn(async () => {}),
      ensureIndex: vi.fn(async () => {}),
    }

    await ensureGasCityCollections(db)

    expect(db.ensureIndex).toHaveBeenCalledWith("completion_events", expect.objectContaining({
      fields: ["bead_id"],
      unique: true,
    }))
    expect(db.ensureIndex).toHaveBeenCalledWith("completion_events", expect.objectContaining({
      fields: ["fn_id", "factory_attempt"],
    }))
    expect(db.ensureIndex).toHaveBeenCalledWith("fidelity_verdicts", expect.objectContaining({
      fields: ["bead_id"],
    }))
    expect(db.ensureIndex).toHaveBeenCalledWith("fidelity_verdicts", expect.objectContaining({
      fields: ["function_id", "overall"],
    }))
    expect(db.ensureIndex).toHaveBeenCalledWith("lifecycle_transitions", expect.objectContaining({
      fields: ["_from"],
    }))
    expect(db.ensureIndex).toHaveBeenCalledWith("lifecycle_transitions", expect.objectContaining({
      type: "skiplist",
      fields: ["timestamp"],
    }))
    expect(db.ensureIndex).toHaveBeenCalledWith("webhook_rejections", expect.objectContaining({
      type: "skiplist",
      fields: ["received_at"],
    }))
    expect(db.ensureIndex).toHaveBeenCalledWith("webhook_rejections", expect.objectContaining({
      fields: ["reason"],
    }))
  })
})
