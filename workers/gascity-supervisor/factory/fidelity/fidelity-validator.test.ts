// Tests for the Gas City fidelity validator verdict bijection.
// Covers IS-GC-FIDELITY-VALIDATION FV-02..FV-15.
//
// The validator is DOMAIN-NEUTRAL: the four universal checks live in code; every
// per-step-type check comes from the loaded fidelity-checks.toml (FV-12, Q2). These
// tests load that authoritative config in setup and exercise the coding-formula
// checks through it — the same path production uses.
//
// Run: bun test factory/fidelity/fidelity-validator.test.ts

import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { loadCheckConfig } from "./check-config.ts"
import { validate } from "./fidelity-validator.ts"
import type { CheckConfig, ResponseEnvelope, ValidateInput } from "./types.ts"

// The authoritative coding-formula check table — loaded once, as production does.
const CHECKS: CheckConfig = loadCheckConfig(join(import.meta.dir, "..", "fidelity-checks.toml"))

// A fully-passing completed envelope for a generic step with one declared output.
function okEnvelope(): ResponseEnvelope {
  return {
    status: "completed",
    artifact_manifest: [{ name: "out.txt", state: "produced", checksum: "abc123" }],
    policy_events: [],
    completion_claimed_without_manifest: false,
  }
}

function baseInput(overrides: Partial<ValidateInput> = {}): ValidateInput {
  return {
    response: okEnvelope(),
    step_name: "seed",
    check_config: CHECKS,
    prior_step_verdicts: [],
    declared_outputs: ["out.txt"],
    ...overrides,
  }
}

describe("FV-05/FV-06 approved path", () => {
  test("all universal checks pass → approved with empty remediation", () => {
    const v = validate(baseInput())
    expect(v.outcome).toBe("approved")
    expect(v.remediation).toBe("")
    expect(v.gate_class).toBeUndefined()
    expect(v.failing_count).toBe(0)
  })

  test("FV-06 bijection: extra unread fields do not change verdict", () => {
    const a = validate(baseInput())
    const withNoise = baseInput()
    withNoise.response.session_archive_ref = "r2://noise"
    withNoise.response.model_usage = { tokens: 999, cost: 1.23, model_id: "x" }
    const b = validate(withNoise)
    expect(b.outcome).toBe(a.outcome)
    expect(b.remediation).toBe(a.remediation)
  })

  test("FV-02 determinism: identical inputs → identical verdict", () => {
    const i = baseInput()
    expect(validate(i)).toEqual(validate(i))
  })
})

describe("FV-11 unknown step → universal checks only (no config match, not an error)", () => {
  test("a step name matching no [[check]] gets ONLY universal checks and approves", () => {
    const v = validate(baseInput({ step_name: "frobnicate" }))
    expect(v.outcome).toBe("approved")
    // no per-step-type check ran — only the four universal checks are recorded.
    expect(v.checks.map((c) => c.name)).toEqual([
      "provider_status_completed",
      "declared_outputs_produced",
      "no_unresolved_policy_violations",
      "stop_condition_externally_verifiable",
    ])
  })

  test("an unknown step still fails the universal checks when evidence is bad", () => {
    const env = okEnvelope()
    env.artifact_manifest = [{ name: "out.txt", state: "missing" }]
    const v = validate(baseInput({ step_name: "frobnicate", response: env }))
    expect(v.outcome).toBe("revise")
  })
})

describe("FV-09 universal required checks", () => {
  test("check 1 provider_status_completed: failed status → revise", () => {
    const env = okEnvelope()
    env.status = "failed"
    env.error = { code: "boom", message: "provider exploded" }
    const v = validate(baseInput({ response: env }))
    expect(v.outcome).toBe("revise")
    expect(v.remediation.length).toBeGreaterThan(0)
  })

  test("FV-10: non-completed builds remediation from structured error, no approved", () => {
    for (const status of ["failed", "policy_violation", "timeout", "cancelled"] as const) {
      const env = okEnvelope()
      env.status = status
      env.error = { code: "x", message: "y" }
      const v = validate(baseInput({ response: env }))
      expect(v.outcome).toBe("revise")
    }
  })

  test("check 2 declared_outputs_produced: missing declared output → revise (never approved on 'agent says done')", () => {
    const env = okEnvelope()
    env.artifact_manifest = [{ name: "out.txt", state: "missing" }]
    const v = validate(baseInput({ response: env }))
    expect(v.outcome).toBe("revise")
    expect(v.remediation).toContain("out.txt")
  })

  test("check 2: extra artifacts do NOT fail (AC-RS3)", () => {
    const env = okEnvelope()
    env.artifact_manifest = [
      { name: "out.txt", state: "produced", checksum: "abc" },
      { name: "scratch.tmp", state: "extra" },
    ]
    const v = validate(baseInput({ response: env }))
    expect(v.outcome).toBe("approved")
  })

  test("check 2: produced without checksum → fail-closed revise (FV-07)", () => {
    const env = okEnvelope()
    env.artifact_manifest = [{ name: "out.txt", state: "produced" }] // no checksum
    const v = validate(baseInput({ response: env }))
    expect(v.outcome).toBe("revise")
  })

  test("check 3 no_unresolved_policy_violations: unresolved violation → revise", () => {
    const env = okEnvelope()
    env.policy_events = [{ kind: "violation", rule: "filesystem_scope", resolved: false }]
    const v = validate(baseInput({ response: env }))
    expect(v.outcome).toBe("revise")
  })

  test("check 3: resolved violation and allow/deny/escalation do NOT fail", () => {
    const env = okEnvelope()
    env.policy_events = [
      { kind: "violation", rule: "x", resolved: true },
      { kind: "allow" },
      { kind: "deny" },
      { kind: "escalation" },
    ]
    const v = validate(baseInput({ response: env }))
    expect(v.outcome).toBe("approved")
  })

  test("check 4 stop_condition_externally_verifiable: completion_claimed_without_manifest → revise", () => {
    const env = okEnvelope()
    env.completion_claimed_without_manifest = true
    const v = validate(baseInput({ response: env }))
    expect(v.outcome).toBe("revise")
  })
})

describe("FV-07 fail-closed", () => {
  test("missing artifact_manifest entirely → revise (cannot compute check 2)", () => {
    const env = okEnvelope()
    delete env.artifact_manifest
    const v = validate(baseInput({ response: env }))
    expect(v.outcome).toBe("revise")
  })

  test("missing policy_events array → check 3 treats absence conservatively but does not crash", () => {
    const env = okEnvelope()
    delete env.policy_events
    const v = validate(baseInput({ response: env }))
    expect(["approved", "revise"]).toContain(v.outcome)
  })
})

// ---- Config-driven per-step-type checks (FV-12). These exercise the coding-formula
// checks loaded from fidelity-checks.toml — the validator itself has no knowledge of them.

describe("FV-12 PATCH step checks (from fidelity-checks.toml)", () => {
  function patchInput(stepOutputs: Record<string, unknown> = {}): ValidateInput {
    return baseInput({
      step_name: "code",
      declared_outputs: ["CandidatePatch"],
      response: {
        status: "completed",
        artifact_manifest: [{ name: "CandidatePatch", state: "produced", checksum: "deadbeef" }],
        policy_events: [],
        completion_claimed_without_manifest: false,
        step_outputs: {
          patch_diff: "diff --git a/x b/x\n+hello\n",
          patch_applies_cleanly: true,
          ...stepOutputs,
        },
      },
    })
  }

  test("patch_non_empty: empty diff → revise (Revision gate)", () => {
    const v = validate(patchInput({ patch_diff: "" }))
    expect(v.outcome).toBe("revise")
    expect(v.gate_class).toBe("revision")
  })

  test("patch_applies_cleanly: conflict → revise with regenerate guidance (DEFECT-1)", () => {
    const v = validate(patchInput({ patch_applies_cleanly: false }))
    expect(v.outcome).toBe("revise")
    expect(v.gate_class).toBe("revision")
    expect(v.remediation.toLowerCase()).toContain("regenerate")
  })

  test("patch_applies_cleanly: absent apply result → fail-closed revise (FV-07)", () => {
    const v = validate(patchInput({ patch_applies_cleanly: undefined }))
    expect(v.outcome).toBe("revise")
    expect(v.gate_class).toBe("revision")
  })

  test("layer3 substrate violation → escalation (universal check 3 fires)", () => {
    const input = patchInput()
    input.response.policy_events = [
      { kind: "violation", rule: "filesystem_scope", resolved: false, source_layer: "layer3" },
    ]
    const v = validate(input)
    expect(v.outcome).toBe("revise")
    expect(["escalation", "revision"]).toContain(v.gate_class)
  })

  test("clean non-empty patch → approved", () => {
    const v = validate(patchInput())
    expect(v.outcome).toBe("approved")
  })
})

describe("FV-12 VERIFY step checks (from fidelity-checks.toml)", () => {
  function verifyInput(stepOutputs: Record<string, unknown> = {}): ValidateInput {
    return baseInput({
      step_name: "verify",
      declared_outputs: ["VerifierReport"],
      response: {
        status: "completed",
        artifact_manifest: [{ name: "VerifierReport", state: "produced", checksum: "feed" }],
        policy_events: [],
        completion_claimed_without_manifest: false,
        step_outputs: {
          verifier_report_present: true,
          verifier_accepts: true,
          tests_section_present: true,
          ...stepOutputs,
        },
      },
    })
  }

  test("verifier_report_present: absent → revise (Pre-flight)", () => {
    const v = validate(verifyInput({ verifier_report_present: false }))
    expect(v.outcome).toBe("revise")
    expect(v.gate_class).toBe("preflight")
  })

  test("verifier_accepts: rejected → revise with Abort gate", () => {
    const v = validate(verifyInput({ verifier_accepts: false }))
    expect(v.outcome).toBe("revise")
    expect(v.gate_class).toBe("abort")
    expect(v.remediation.toLowerCase()).toContain("verification")
  })

  test("tests_support_claims: missing tests section → revise (Revision gate)", () => {
    const v = validate(verifyInput({ tests_section_present: false }))
    expect(v.outcome).toBe("revise")
    expect(v.gate_class).toBe("revision")
  })

  test("verifier_distinct_from_author: equal models → escalation", () => {
    const v = validate(verifyInput({ patch_model_id: "kimi-k2", verify_model_id: "kimi-k2" }))
    expect(v.outcome).toBe("revise")
    expect(v.gate_class).toBe("escalation")
  })

  test("verifier_distinct_from_author: distinct models → approved", () => {
    const v = validate(verifyInput({ patch_model_id: "kimi-k2", verify_model_id: "glm-5" }))
    expect(v.outcome).toBe("approved")
  })

  test("verifier_distinct_from_author: missing identities → not-applicable, not fabricated fail (FV-12 exception)", () => {
    const v = validate(verifyInput()) // no model ids in step_outputs
    expect(v.outcome).toBe("approved")
    const check = v.checks.find((c) => c.name === "verifier_distinct_from_author")
    expect(check?.result).toBe("not-applicable")
  })

  test("clean verify → approved", () => {
    expect(validate(verifyInput()).outcome).toBe("approved")
  })
})

describe("FV-12 MAP step content adequacy (from fidelity-checks.toml)", () => {
  function mapInput(stepOutputs: Record<string, unknown> = {}): ValidateInput {
    return baseInput({
      step_name: "map",
      declared_outputs: ["RepoMap"],
      response: {
        status: "completed",
        artifact_manifest: [{ name: "RepoMap", state: "produced", checksum: "m1" }],
        policy_events: [],
        completion_claimed_without_manifest: false,
        step_outputs: { ...stepOutputs },
      },
    })
  }

  test("map_content_adequate absent → not-applicable (na_unless_present), approved", () => {
    const v = validate(mapInput())
    expect(v.outcome).toBe("approved")
    const check = v.checks.find((c) => c.name === "repo_map_content_adequate")
    expect(check?.result).toBe("not-applicable")
  })

  test("map_content_adequate=false → revise (Revision)", () => {
    const v = validate(mapInput({ map_content_adequate: false }))
    expect(v.outcome).toBe("revise")
    expect(v.gate_class).toBe("revision")
  })
})

describe("FV-08 RELEASE step molecule-AND (is_release_step pre-flight)", () => {
  function releaseInput(priors: ValidateInput["prior_step_verdicts"], stepOutputs: Record<string, unknown> = {}): ValidateInput {
    return baseInput({
      step_name: "release",
      is_release_step: true,
      declared_outputs: ["FinalPatch"],
      prior_step_verdicts: priors,
      response: {
        status: "completed",
        artifact_manifest: [{ name: "FinalPatch", state: "produced", checksum: "f1" }],
        policy_events: [],
        completion_claimed_without_manifest: false,
        step_outputs: { final_matches_verified: true, ...stepOutputs },
      },
    })
  }

  test("all prior approved → approved", () => {
    const v = releaseInput([
      { step_index: 0, step_name: "plan", outcome: "approved", remediation: "" },
      { step_index: 1, step_name: "code", outcome: "approved", remediation: "" },
      { step_index: 2, step_name: "verify", outcome: "approved", remediation: "" },
    ])
    expect(validate(v).outcome).toBe("approved")
  })

  test("any prior revise → molecule revise with earliest-failing remediation (FV-08)", () => {
    const v = releaseInput([
      { step_index: 0, step_name: "plan", outcome: "approved", remediation: "" },
      { step_index: 1, step_name: "code", outcome: "revise", remediation: "EARLIEST fix the patch", gate_class: "revision" },
      { step_index: 2, step_name: "verify", outcome: "revise", remediation: "later issue", gate_class: "abort" },
    ])
    const out = validate(v)
    expect(out.outcome).toBe("revise")
    expect(out.remediation).toContain("EARLIEST")
    expect(out.gate_class).toBe("preflight") // all_prior_steps_approved is the RELEASE pre-flight
  })

  test("final_patch_matches_verified_candidate: mismatch → revise Abort", () => {
    const v = releaseInput(
      [{ step_index: 0, step_name: "verify", outcome: "approved", remediation: "" }],
      { final_matches_verified: false },
    )
    const out = validate(v)
    expect(out.outcome).toBe("revise")
    expect(out.gate_class).toBe("abort")
  })
})

describe("FV-15 no provider internals in remediation", () => {
  test("remediation contains no container ids, R2 keys, or absolute paths", () => {
    const env = okEnvelope()
    env.status = "failed"
    env.error = { code: "PI_PATH_GUARD_BLOCKED", message: "blocked /workspace/secret on container abc-123 (r2://runs/x)" }
    const v = validate(baseInput({ response: env }))
    expect(v.outcome).toBe("revise")
    expect(v.remediation).not.toContain("r2://")
    expect(v.remediation).not.toContain("/workspace/")
    expect(v.remediation).not.toContain("abc-123")
    expect(v.remediation).not.toContain("PI_PATH_GUARD_BLOCKED")
  })
})
