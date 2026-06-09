// Tests for the fidelity validator CLI orchestration.
//
// The CLI is what the formula RELEASE step invokes. It reads a JSON job spec on
// stdin (response envelope + step context + lineage + loop state), computes the
// verdict against the loaded per-step-type check config (fidelity-checks.toml),
// applies the convergence decision, and prints a JSON result describing the action
// to take: rerun, post a RELEASE webhook, or emit a molecule.failed fail-closed event.
//
// Run: bun test factory/fidelity/cli.test.ts

import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { loadCheckConfig } from "./check-config.ts"
import { runCli } from "./cli.ts"
import type { CliInput } from "./cli.ts"
import type { CheckConfig } from "./types.ts"

const SECRET = "test-secret"
const CHECKS: CheckConfig = loadCheckConfig(join(import.meta.dir, "..", "fidelity-checks.toml"))

function lineage() {
  return {
    fn_id: "FN-X",
    is_id: "IS-X",
    es_id: "ES-X",
    ep_id: "EP-X",
    form_id: "FORM-X",
    factory_attempt: 1,
    bead_id: "bead-1",
  }
}

function approvedReleaseJob(): CliInput {
  return {
    step_name: "release",
    is_release_step: true,
    lineage: lineage(),
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
    webhook: { url: "https://factory.example/webhooks/gascity", hmac_secret: SECRET, key_id: "v1" },
  }
}

describe("approved path → post_release approved", () => {
  test("emits a RELEASE POST with a valid HMAC and integer factory_attempt", () => {
    const out = runCli(approvedReleaseJob(), CHECKS)
    expect(out.action).toBe("post_release")
    if (out.action !== "post_release") throw new Error("unreachable")
    expect(out.outcome).toBe("approved")
    expect(out.body).toContain('"factory_attempt": 1')
    expect(out.body).not.toContain('"remediation"')
    expect(out.headers["X-GC-Signature"]).toMatch(/^sha256=[a-f0-9]{64}$/)
    expect(out.headers["X-GC-Key-ID"]).toBe("v1")
    expect(out.url).toBe("https://factory.example/webhooks/gascity")
  })
})

describe("revise path with depth remaining → rerun", () => {
  test("a Revision-gated failing verify returns rerun with remediation to inject", () => {
    const job = approvedReleaseJob()
    job.step_name = "verify"
    job.is_release_step = false
    job.prior_step_verdicts = []
    job.declared_outputs = ["VerifierReport"]
    job.response = {
      status: "completed",
      artifact_manifest: [{ name: "VerifierReport", state: "produced", checksum: "v" }],
      policy_events: [],
      completion_claimed_without_manifest: false,
      // verifier present + accepts, but tests section missing → Revision gate
      step_outputs: { verifier_report_present: true, verifier_accepts: true, tests_section_present: false },
    }
    job.convergence = { max_amendment_depth: 3, prior_failing_count: undefined }
    const out = runCli(job, CHECKS)
    expect(out.action).toBe("rerun")
    if (out.action !== "rerun") throw new Error("unreachable")
    expect(out.next_attempt).toBe(2)
    expect(out.remediation_to_inject.length).toBeGreaterThan(0)
  })
})

describe("Abort path → post_release revise (no rerun)", () => {
  test("verifier reject posts a revise webhook for the FN-V2 amendment path", () => {
    const job = approvedReleaseJob()
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
    expect(out.action).toBe("post_release")
    if (out.action !== "post_release") throw new Error("unreachable")
    expect(out.outcome).toBe("revise")
    expect(out.body).toContain('"remediation"')
    expect(out.body).toContain('"outcome": "revise"')
  })
})

describe("depth exhaustion → post_release revise with depth notice", () => {
  test("at max depth a Revision-gated verdict is emitted with a depth notice, not re-run", () => {
    // A patch conflict is a Revision gate (rerunnable). At factory_attempt == max,
    // the loop guard (>=) emits a terminal revise with the depth notice (FV-18a).
    const job = approvedReleaseJob()
    job.step_name = "code"
    job.is_release_step = false
    job.prior_step_verdicts = []
    job.declared_outputs = ["CandidatePatch"]
    job.lineage.factory_attempt = 3
    job.response = {
      status: "completed",
      artifact_manifest: [{ name: "CandidatePatch", state: "produced", checksum: "p" }],
      policy_events: [],
      completion_claimed_without_manifest: false,
      step_outputs: { patch_diff: "diff --git a/x b/x\n+y\n", patch_applies_cleanly: false }, // conflict → Revision
    }
    job.convergence = { max_amendment_depth: 3 }
    const out = runCli(job, CHECKS)
    expect(out.action).toBe("post_release")
    if (out.action !== "post_release") throw new Error("unreachable")
    expect(out.outcome).toBe("revise")
    expect(out.body).toContain('"factory_attempt": 3')
    expect(out.body.toLowerCase()).toContain("depth")
  })
})

describe("FV-20 fail-closed: malformed lineage → molecule_failed (not a malformed POST)", () => {
  test("empty fn_id yields molecule_failed event, no RELEASE POST", () => {
    const job = approvedReleaseJob()
    job.lineage.fn_id = ""
    const out = runCli(job, CHECKS)
    expect(out.action).toBe("molecule_failed")
    if (out.action !== "molecule_failed") throw new Error("unreachable")
    expect(out.event.event_type).toBe("molecule.failed")
    expect(out.event.bead_id).toBe("bead-1")
  })

  test("non-integer factory_attempt yields molecule_failed", () => {
    const job = approvedReleaseJob()
    job.lineage.factory_attempt = 2.5
    const out = runCli(job, CHECKS)
    expect(out.action).toBe("molecule_failed")
  })
})

describe("FV-07 fail-closed: malformed/absent evidence → revise, never approved", () => {
  test("missing artifact_manifest never yields approved (FV-07)", () => {
    const job = approvedReleaseJob()
    delete job.response.artifact_manifest
    const out = runCli(job, CHECKS)
    expect(out.action).not.toBe("molecule_failed")
    if (out.action === "post_release") {
      expect(out.outcome).toBe("revise")
    } else {
      expect(out.action).toBe("rerun")
    }
  })

  test("missing artifact_manifest at max depth posts a revise (never approved)", () => {
    const job = approvedReleaseJob()
    delete job.response.artifact_manifest
    job.lineage.factory_attempt = 3
    job.convergence = { max_amendment_depth: 3 }
    const out = runCli(job, CHECKS)
    expect(out.action).toBe("post_release")
    if (out.action !== "post_release") throw new Error("unreachable")
    expect(out.outcome).toBe("revise")
  })

  test("completely unparseable response shape is treated fail-closed (molecule_failed)", () => {
    const job = approvedReleaseJob()
    ;(job as unknown as { response: unknown }).response = null
    const out = runCli(job, CHECKS)
    expect(out.action).toBe("molecule_failed")
  })
})

describe("unknown step → universal checks only (FV-11), no per-step config", () => {
  test("a step name matching no [[check]] approves on clean universal evidence", () => {
    const job = approvedReleaseJob()
    job.step_name = "frobnicate"
    job.is_release_step = false
    job.prior_step_verdicts = []
    job.declared_outputs = ["out.txt"]
    job.response = {
      status: "completed",
      artifact_manifest: [{ name: "out.txt", state: "produced", checksum: "abc" }],
      policy_events: [],
      completion_claimed_without_manifest: false,
    }
    const out = runCli(job, CHECKS)
    expect(out.action).toBe("post_release")
    if (out.action !== "post_release") throw new Error("unreachable")
    expect(out.outcome).toBe("approved")
  })
})

describe("HMAC verifies end-to-end against the receiver algorithm", () => {
  test("the emitted body + signature pair verifies", async () => {
    const out = runCli(approvedReleaseJob(), CHECKS)
    if (out.action !== "post_release") throw new Error("expected post_release")
    const { createHmac } = await import("node:crypto")
    const expected = "sha256=" + createHmac("sha256", SECRET).update(out.body, "utf8").digest("hex")
    expect(out.headers["X-GC-Signature"]).toBe(expected)
  })
})
