// Integration test against the FROZEN Factory webhook receiver contract.
//
// The receiver (workers/ff-pipeline/src/gascity/webhook-receiver.ts) is the
// contract boundary and MUST NOT be modified. This test reproduces its EXACT
// verification predicates — verifyGasCityHmac (crypto.subtle HMAC-SHA256 over the
// raw request bytes) and parsePayload (field presence + Number.isInteger +
// outcome enum) — and asserts the bytes/signature our CLI emits pass both.
//
// Reproduced verbatim from webhook-receiver.ts so a drift in our emitter is caught.
//
// Run: bun test factory/fidelity/receiver-contract.test.ts

import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { loadCheckConfig } from "./check-config.ts"
import { runCli } from "./cli.ts"
import type { CliInput } from "./cli.ts"
import type { CheckConfig } from "./types.ts"

const SECRET = "factory-shared-secret"
const CHECKS: CheckConfig = loadCheckConfig(join(import.meta.dir, "..", "fidelity-checks.toml"))

// ---- verbatim reproductions of the frozen receiver predicates ----

// webhook-receiver.ts::hmacSha256Hex
async function receiverHmacSha256Hex(secret: string, rawBytes: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign("HMAC", key, rawBytes)
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("")
}

// webhook-receiver.ts::verifyGasCityHmac (header + signature checks)
async function receiverVerifyHmac(
  headers: Record<string, string>,
  secret: string,
  rawBytes: Uint8Array,
): Promise<{ ok: boolean; reason?: string }> {
  if (headers["X-GC-Key-ID"] !== "v1") return { ok: false, reason: "invalid_key_id" }
  if (!secret) return { ok: false, reason: "hmac_secret_unconfigured" }
  const supplied = headers["X-GC-Signature"] ?? ""
  const match = supplied.match(/^sha256=([a-fA-F0-9]{64})$/)
  if (!match) return { ok: false, reason: "invalid_signature" }
  const expected = await receiverHmacSha256Hex(secret, rawBytes)
  return match[1]!.toLowerCase() === expected ? { ok: true } : { ok: false, reason: "invalid_signature" }
}

// webhook-receiver.ts::stringValue
function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

// webhook-receiver.ts::parsePayload (the completion-payload acceptance predicate)
function receiverParsePayload(rawBytes: Uint8Array): { ok: boolean; reason?: string } {
  let body: unknown
  try {
    body = JSON.parse(new TextDecoder().decode(rawBytes))
  } catch {
    return { ok: false, reason: "payload_malformed" }
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "payload_malformed" }
  const record = body as Record<string, unknown>
  const payload = {
    fn_id: stringValue(record.fn_id),
    is_id: stringValue(record.is_id),
    es_id: stringValue(record.es_id),
    ep_id: stringValue(record.ep_id),
    form_id: stringValue(record.form_id),
    factory_attempt: record.factory_attempt,
    bead_id: stringValue(record.bead_id),
    outcome: record.outcome,
  }
  if (
    !payload.fn_id ||
    !payload.is_id ||
    !payload.es_id ||
    !payload.ep_id ||
    !payload.form_id ||
    !payload.bead_id ||
    !Number.isInteger(payload.factory_attempt) ||
    (payload.factory_attempt as number) <= 0 ||
    (payload.outcome !== "approved" && payload.outcome !== "revise")
  ) {
    return { ok: false, reason: "payload_malformed" }
  }
  return { ok: true }
}

function baseJob(): CliInput {
  return {
    step_name: "release",
    is_release_step: true,
    lineage: {
      fn_id: "FN-GC-FIDELITY-VALIDATION",
      is_id: "IS-GC-FIDELITY-VALIDATION",
      es_id: "ES-GC-FIDELITY-VALIDATION",
      ep_id: "EP-GC-001",
      form_id: "FORM-GC-001",
      factory_attempt: 1,
      bead_id: "bead-release-1",
    },
    declared_outputs: ["FinalPatch"],
    prior_step_verdicts: [
      { step_index: 0, step_name: "plan", outcome: "approved", remediation: "" },
      { step_index: 1, step_name: "code", outcome: "approved", remediation: "" },
      { step_index: 2, step_name: "verify", outcome: "approved", remediation: "" },
    ],
    response: {
      status: "completed",
      artifact_manifest: [{ name: "FinalPatch", state: "produced", checksum: "f1" }],
      policy_events: [],
      completion_claimed_without_manifest: false,
      step_outputs: { final_matches_verified: true },
    },
    convergence: { max_amendment_depth: 3 },
    webhook: { url: "https://factory/webhooks/gascity", hmac_secret: SECRET, key_id: "v1" },
  }
}

describe("emitted RELEASE payload passes the frozen receiver", () => {
  test("approved: HMAC verifies and parsePayload accepts", async () => {
    const out = runCli(baseJob(), CHECKS)
    if (out.action !== "post_release") throw new Error("expected post_release")
    const rawBytes = new TextEncoder().encode(out.body)

    const hmac = await receiverVerifyHmac(out.headers, SECRET, rawBytes)
    expect(hmac.ok).toBe(true)

    const parsed = receiverParsePayload(rawBytes)
    expect(parsed.ok).toBe(true)
  })

  test("revise: HMAC verifies and parsePayload accepts (remediation tolerated)", async () => {
    const job = baseJob()
    job.step_name = "verify"
    job.is_release_step = false
    job.prior_step_verdicts = []
    job.declared_outputs = ["VerifierReport"]
    job.response = {
      status: "completed",
      artifact_manifest: [{ name: "VerifierReport", state: "produced", checksum: "v" }],
      policy_events: [],
      completion_claimed_without_manifest: false,
      step_outputs: { verifier_report_present: true, verifier_accepts: false, tests_section_present: true },
    }
    const out = runCli(job, CHECKS)
    if (out.action !== "post_release") throw new Error("expected post_release")
    const rawBytes = new TextEncoder().encode(out.body)

    expect((await receiverVerifyHmac(out.headers, SECRET, rawBytes)).ok).toBe(true)
    expect(receiverParsePayload(rawBytes).ok).toBe(true)
  })

  test("a tampered body fails the receiver HMAC (proves we sign the exact bytes)", async () => {
    const out = runCli(baseJob(), CHECKS)
    if (out.action !== "post_release") throw new Error("expected post_release")
    const tampered = new TextEncoder().encode(out.body.replace("approved", "revise"))
    expect((await receiverVerifyHmac(out.headers, SECRET, tampered)).ok).toBe(false)
  })

  test("factory_attempt survives as an integer through the receiver's Number.isInteger gate", async () => {
    const job = baseJob()
    job.lineage.factory_attempt = 2
    const out = runCli(job, CHECKS)
    if (out.action !== "post_release") throw new Error("expected post_release")
    const rawBytes = new TextEncoder().encode(out.body)
    expect(receiverParsePayload(rawBytes).ok).toBe(true)
    // and it is genuinely a number, not "2"
    expect(typeof JSON.parse(out.body).factory_attempt).toBe("number")
  })

  test("the receiver's raw-byte HMAC matches our header byte-for-byte", async () => {
    const out = runCli(baseJob(), CHECKS)
    if (out.action !== "post_release") throw new Error("expected post_release")
    const rawBytes = new TextEncoder().encode(out.body)
    const expected = "sha256=" + (await receiverHmacSha256Hex(SECRET, rawBytes))
    expect(out.headers["X-GC-Signature"]).toBe(expected)
  })
})
