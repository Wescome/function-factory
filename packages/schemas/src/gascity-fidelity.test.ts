import { describe, expect, it } from "vitest"
import { GasCityFidelityVerificationReport } from "./gascity-fidelity.js"

const report = {
  id: "VR-ABCDEF0123456789",
  verification: "fidelity",
  variant: "gascity",
  function_id: "FN-GC-DISPATCH-WIRE",
  timestamp: "2026-05-27T23:30:00.000Z",
  overall: "pass",
  gc_outcome: "approved",
  bead_id: "gc-11",
  form_id: "FORM-GC-DISPATCH-WIRE-001",
  ep_id: "EP-GC-DISPATCH-WIRE-001",
  es_id: "ES-GC-DISPATCH-WIRE",
  is_id: "IS-GC-DISPATCH-WIRE",
  factory_attempt: 1,
  intake_checks: {
    hmac_valid: true,
    payload_wellformed: true,
    lineage_resolved: true,
    dispatch_match: {
      dispatch_log_key: "dispatch-1",
      matched_on: "bead_id",
    },
  },
  verdict_authority: "gas-city-verify-stage",
  received_at: "2026-05-27T23:30:00.000Z",
  remediation: "none",
  source_refs: [
    "FN-GC-DISPATCH-WIRE",
    "IS-GC-DISPATCH-WIRE",
    "ES-GC-DISPATCH-WIRE",
    "EP-GC-DISPATCH-WIRE-001",
    "FORM-GC-DISPATCH-WIRE-001",
  ],
  explicitness: "explicit",
  rationale: "Gas City RELEASE callback was HMAC-valid and matched a dispatched bead.",
}

describe("GasCityFidelityVerificationReport", () => {
  it("parses a Gas City approved verdict as fidelity pass", () => {
    const parsed = GasCityFidelityVerificationReport.parse(report)

    expect(parsed.overall).toBe("pass")
    expect(parsed.gc_outcome).toBe("approved")
    expect(parsed.variant).toBe("gascity")
  })

  it("rejects legacy TEP packet IDs", () => {
    const parsed = GasCityFidelityVerificationReport.safeParse({
      ...report,
      ep_id: "TEP-GC-DISPATCH-WIRE-001",
      source_refs: [
        "FN-GC-DISPATCH-WIRE",
        "IS-GC-DISPATCH-WIRE",
        "ES-GC-DISPATCH-WIRE",
        "TEP-GC-DISPATCH-WIRE-001",
        "FORM-GC-DISPATCH-WIRE-001",
      ],
    })

    expect(parsed.success).toBe(false)
  })
})

