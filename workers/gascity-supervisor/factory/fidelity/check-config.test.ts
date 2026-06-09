// Tests for the fidelity check-config loader (fidelity-checks.toml).
//
// The loader reads the per-step-type check table that lives in city
// configuration (IS-GC-FIDELITY-VALIDATION Q2). It is runtime-portable: it uses
// Bun.TOML.parse when available (the production container ships bun) and falls
// back to a minimal built-in parser for the bounded [[check]] schema elsewhere.
//
// Run: bun test factory/fidelity/check-config.test.ts

import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { loadCheckConfig, parseCheckConfig } from "./check-config.ts"

const TOML = `
[[check]]
step_pattern = "verif"
check_id = "verifier_accepts"
gate_class = "abort"
condition = { field = "verifier_accepts", predicate = "truthy" }
remediation = "Independent verification rejected the result."

[[check]]
step_pattern = "(^|[^a-z])patch|code"
check_id = "patch_non_empty"
gate_class = "revision"
condition = { field = "patch_diff", predicate = "non_empty_string" }
remediation = "The candidate patch was empty."
`

describe("parseCheckConfig", () => {
  test("parses [[check]] tables into typed CheckSpec entries", () => {
    const cfg = parseCheckConfig(TOML)
    expect(cfg.check.length).toBe(2)
    const first = cfg.check[0]!
    expect(first.check_id).toBe("verifier_accepts")
    expect(first.step_pattern).toBe("verif")
    expect(first.gate_class).toBe("abort")
    expect(first.condition.field).toBe("verifier_accepts")
    expect(first.condition.predicate).toBe("truthy")
    expect(first.remediation).toContain("rejected")
  })

  test("preserves file order (FV-12 ordered evaluation)", () => {
    const cfg = parseCheckConfig(TOML)
    expect(cfg.check.map((c) => c.check_id)).toEqual(["verifier_accepts", "patch_non_empty"])
  })

  test("rejects a malformed gate_class (fail-closed config validation)", () => {
    const bad = `
[[check]]
step_pattern = "x"
check_id = "y"
gate_class = "not_a_gate"
condition = { field = "f", predicate = "truthy" }
remediation = "r"
`
    expect(() => parseCheckConfig(bad)).toThrow()
  })

  test("rejects a check missing a required field", () => {
    const bad = `
[[check]]
step_pattern = "x"
gate_class = "abort"
condition = { field = "f", predicate = "truthy" }
remediation = "r"
`
    expect(() => parseCheckConfig(bad)).toThrow()
  })

  test("an empty table is valid (zero per-step-type checks)", () => {
    const cfg = parseCheckConfig("")
    expect(cfg.check).toEqual([])
  })
})

describe("loadCheckConfig", () => {
  test("loads the authoritative fidelity-checks.toml from disk", () => {
    const path = join(import.meta.dir, "..", "fidelity-checks.toml")
    const cfg = loadCheckConfig(path)
    expect(cfg.check.length).toBeGreaterThan(0)
    // The coding-formula checks that were previously hardcoded must all be present.
    const ids = cfg.check.map((c) => c.check_id)
    expect(ids).toContain("patch_non_empty")
    expect(ids).toContain("patch_applies_cleanly")
    expect(ids).toContain("verifier_report_present")
    expect(ids).toContain("verifier_accepts")
    expect(ids).toContain("tests_support_claims")
    expect(ids).toContain("verifier_distinct_from_author")
    expect(ids).toContain("repo_map_content_adequate")
    expect(ids).toContain("final_patch_matches_verified_candidate")
  })
})
