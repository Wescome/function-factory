// Tests for RELEASE payload construction + HMAC (FV-19..FV-22).
// The HMAC must verify against the same algorithm webhook-receiver.ts uses
// (HMAC-SHA256 over raw body bytes). Field order is load-bearing.
//
// Run: bun test factory/fidelity/release-payload.test.ts

import { createHmac } from "node:crypto"
import { describe, expect, test } from "bun:test"
import { buildReleasePayload, hmacHex, signedHeaders } from "./release-payload.ts"
import type { Lineage } from "./release-payload.ts"

const lineage: Lineage = {
  fn_id: "FN-GC-FIDELITY-VALIDATION",
  is_id: "IS-GC-FIDELITY-VALIDATION",
  es_id: "ES-GC-FIDELITY-VALIDATION",
  ep_id: "EP-GC-001",
  form_id: "FORM-GC-001",
  factory_attempt: 1,
  bead_id: "bead-abc",
}

describe("FV-19/FV-21 payload field order is load-bearing", () => {
  test("approved payload field order: fn_id,is_id,es_id,ep_id,form_id,factory_attempt,bead_id,outcome", () => {
    const body = buildReleasePayload(lineage, "approved", "")
    const keys = Object.keys(JSON.parse(body))
    expect(keys).toEqual([
      "fn_id",
      "is_id",
      "es_id",
      "ep_id",
      "form_id",
      "factory_attempt",
      "bead_id",
      "outcome",
    ])
  })

  test("revise payload appends remediation LAST", () => {
    const body = buildReleasePayload(lineage, "revise", "fix the patch")
    const keys = Object.keys(JSON.parse(body))
    expect(keys).toEqual([
      "fn_id",
      "is_id",
      "es_id",
      "ep_id",
      "form_id",
      "factory_attempt",
      "bead_id",
      "outcome",
      "remediation",
    ])
  })

  test("FV-20: factory_attempt is a bare JSON integer, not a quoted string", () => {
    const body = buildReleasePayload(lineage, "approved", "")
    expect(body).toContain('"factory_attempt": 1')
    expect(body).not.toContain('"factory_attempt": "1"')
    const parsed = JSON.parse(body)
    expect(Number.isInteger(parsed.factory_attempt)).toBe(true)
  })

  test("approved payload omits remediation field entirely", () => {
    const body = buildReleasePayload(lineage, "approved", "")
    expect(JSON.parse(body).remediation).toBeUndefined()
  })
})

describe("FV-21 HMAC matches the frozen receiver algorithm", () => {
  const secret = "test-secret-value"

  test("hmacHex == HMAC-SHA256(secret, raw body bytes) hex — same as webhook-receiver verifyGasCityHmac", () => {
    const body = buildReleasePayload(lineage, "approved", "")
    const ours = hmacHex(secret, body)
    // Independent reference computation (what the receiver does over the raw bytes).
    const reference = createHmac("sha256", secret).update(Buffer.from(body, "utf8")).digest("hex")
    expect(ours).toBe(reference)
  })

  test("signedHeaders emit X-GC-Signature: sha256=<hex> and X-GC-Key-ID: v1", () => {
    const body = buildReleasePayload(lineage, "revise", "do better")
    const headers = signedHeaders(secret, body, "v1")
    expect(headers["X-GC-Signature"]).toMatch(/^sha256=[a-f0-9]{64}$/)
    expect(headers["X-GC-Key-ID"]).toBe("v1")
    expect(headers["Content-Type"]).toBe("application/json")
  })

  test("HMAC is over the EXACT bytes posted (no trailing newline)", () => {
    const body = buildReleasePayload(lineage, "approved", "")
    expect(body.endsWith("\n")).toBe(false)
    // signing the exact string == signing utf8 bytes of that string
    const sig = hmacHex(secret, body)
    const ref = createHmac("sha256", secret).update(body, "utf8").digest("hex")
    expect(sig).toBe(ref)
  })
})

describe("FV-20 fail-closed on malformed lineage", () => {
  test("non-integer factory_attempt throws (caller emits molecule.failed)", () => {
    const bad = { ...lineage, factory_attempt: 1.5 as unknown as number }
    expect(() => buildReleasePayload(bad, "approved", "")).toThrow()
  })

  test("empty lineage field throws", () => {
    const bad = { ...lineage, fn_id: "" }
    expect(() => buildReleasePayload(bad, "approved", "")).toThrow()
  })

  test("revise with empty remediation throws (FV-05/FV-14: revise must carry non-empty remediation)", () => {
    expect(() => buildReleasePayload(lineage, "revise", "")).toThrow()
  })
})
