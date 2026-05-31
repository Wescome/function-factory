// RELEASE webhook payload construction + HMAC.
//
// Implements IS-GC-FIDELITY-VALIDATION FV-19..FV-22.
//
// The Factory webhook receiver (webhook-receiver.ts, FROZEN) verifies the HMAC
// over the RAW request body bytes BEFORE JSON parse, then requires
// Number.isInteger(payload.factory_attempt). Therefore:
//   - factory_attempt MUST be a bare JSON integer (FV-20).
//   - JSON field order is load-bearing: fn_id, is_id, es_id, ep_id, form_id,
//     factory_attempt, bead_id, outcome, then remediation LAST if present (FV-21).
//   - The signed bytes MUST be byte-identical to the posted bytes; we emit the
//     exact string and sign its utf8 bytes with no trailing newline.

import { createHmac } from "node:crypto"
import type { Outcome } from "./types.ts"

/** Lineage fields transcribed from already-substituted formula vars (FV-20). */
export interface Lineage {
  fn_id: string
  is_id: string
  es_id: string
  ep_id: string
  form_id: string
  /** bare integer — Factory requires Number.isInteger (FV-20). */
  factory_attempt: number
  bead_id: string
}

const LINEAGE_STRING_FIELDS = ["fn_id", "is_id", "es_id", "ep_id", "form_id", "bead_id"] as const

/**
 * FV-19/FV-20/FV-21 — build the canonical RELEASE payload JSON string.
 *
 * Field order is fixed and load-bearing for HMAC reproducibility. We construct
 * the JSON by hand (not JSON.stringify of an object literal) so the order is
 * guaranteed independent of engine insertion-order quirks, and so factory_attempt
 * is emitted as a bare integer.
 *
 * Throws on malformed lineage or on a revise with empty remediation — the caller
 * MUST catch and emit a molecule.failed operational event instead of POSTing a
 * malformed payload (FV-20 fail-closed).
 */
export function buildReleasePayload(lineage: Lineage, outcome: Outcome, remediation: string): string {
  // Fail-closed validation (FV-20).
  for (const field of LINEAGE_STRING_FIELDS) {
    const v = lineage[field]
    if (typeof v !== "string" || v.trim().length === 0) {
      throw new Error(`malformed_lineage: ${field} is empty`)
    }
  }
  if (!Number.isInteger(lineage.factory_attempt) || lineage.factory_attempt <= 0) {
    throw new Error(`malformed_lineage: factory_attempt must be a positive integer, got ${lineage.factory_attempt}`)
  }
  if (outcome !== "approved" && outcome !== "revise") {
    throw new Error(`malformed_outcome: ${outcome}`)
  }
  if (outcome === "revise" && remediation.trim().length === 0) {
    throw new Error("malformed_remediation: revise outcome requires a non-empty remediation")
  }

  // Hand-built, fixed field order (FV-21). 2-space indent matches the formula heredoc style.
  const lines: string[] = ["{"]
  lines.push(`  "fn_id": ${JSON.stringify(lineage.fn_id)},`)
  lines.push(`  "is_id": ${JSON.stringify(lineage.is_id)},`)
  lines.push(`  "es_id": ${JSON.stringify(lineage.es_id)},`)
  lines.push(`  "ep_id": ${JSON.stringify(lineage.ep_id)},`)
  lines.push(`  "form_id": ${JSON.stringify(lineage.form_id)},`)
  // bare integer — NOT quoted (FV-20).
  lines.push(`  "factory_attempt": ${lineage.factory_attempt},`)
  lines.push(`  "bead_id": ${JSON.stringify(lineage.bead_id)},`)
  if (outcome === "revise") {
    lines.push(`  "outcome": ${JSON.stringify(outcome)},`)
    lines.push(`  "remediation": ${JSON.stringify(remediation)}`)
  } else {
    lines.push(`  "outcome": ${JSON.stringify(outcome)}`)
  }
  lines.push("}")
  return lines.join("\n")
}

/**
 * FV-21 — HMAC-SHA256 over the raw body bytes, hex-encoded. Byte-identical to the
 * frozen receiver's verifyGasCityHmac (crypto.subtle.sign HMAC SHA-256 over the
 * exact posted bytes).
 */
export function hmacHex(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex")
}

/** FV-21 — the headers the RELEASE POST must carry. */
export function signedHeaders(secret: string, body: string, keyId: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-GC-Signature": `sha256=${hmacHex(secret, body)}`,
    "X-GC-Key-ID": keyId,
  }
}
