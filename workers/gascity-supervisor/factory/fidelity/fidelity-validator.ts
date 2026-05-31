// Gas City fidelity validator — the deterministic verdict bijection.
//
// Implements IS-GC-FIDELITY-VALIDATION FV-02..FV-15.
//
// Non-negotiables enforced here:
//   - Deterministic, no LLM: pure function of its inputs. No clock, no random,
//     no network read, no model call (FV-02).
//   - Bijective: one evidence set → exactly one verdict (FV-06).
//   - Binary: outcome ∈ {approved, revise} only (FV-05).
//   - Fail-closed: an uncomputable required check is a FAIL (FV-07).
//   - No provider internals leak into remediation (FV-15).
//   - Domain-neutral: this module knows NOTHING about any specific domain's
//     pipeline stages or agent roles. The four universal checks are always
//     domain-agnostic; every per-step-type check comes from the CheckConfig
//     loaded from fidelity-checks.toml (FV-12, Q2). The validator only knows:
//     universal checks + config-driven checks.

import type {
  CheckResult,
  CheckSpec,
  GateClass,
  ResponseEnvelope,
  StepVerdict,
  ValidateInput,
} from "./types.ts"

/**
 * FV-02 — the verdict bijection. Pure function:
 *   validate({ response, step_name, check_config, prior_step_verdicts, … })
 *     → { outcome, remediation }.
 */
export function validate(input: ValidateInput): StepVerdict {
  const checks = buildCheckList(input)

  const failing = checks.filter((c) => c.result === "fail")
  if (failing.length === 0) {
    return {
      outcome: "approved",
      remediation: "",
      checks,
      failing_count: 0,
    }
  }

  // FV-06 — the FIRST failing check (in evaluation order) supplies remediation + gate class.
  const first = failing[0]!
  return {
    outcome: "revise",
    remediation: first.remediation ?? "Revision required.",
    gate_class: first.gate_class,
    checks,
    failing_count: failing.length,
  }
}

/**
 * Build the ordered check list (verdict algorithm step 2):
 *   2c. (RELEASE only) the all_prior_steps_approved pre-flight — prepended.
 *   a.  the four universal checks (FV-09) in order 1→4.
 *   b.  every configured per-step-type check whose step_pattern matches step_name,
 *       in file order (FV-12).
 */
function buildCheckList(input: ValidateInput): CheckResult[] {
  const checks: CheckResult[] = []

  // RELEASE pre-flight runs first (verdict algorithm step 2c / FV-08). This is a
  // universal, domain-neutral check: it reads prior_step_verdicts, not step names.
  if (input.is_release_step) {
    checks.push(allPriorStepsApproved(input))
  }

  // Universal checks (FV-09), order 1→4. Always domain-agnostic.
  checks.push(providerStatusCompleted(input.response))
  checks.push(declaredOutputsProduced(input.response, input.declared_outputs))
  checks.push(noUnresolvedPolicyViolations(input.response))
  checks.push(stopConditionExternallyVerifiable(input.response))

  // Config-driven per-step-type checks (FV-12). The validator carries zero
  // knowledge of which checks these are; the table is data.
  checks.push(...configuredChecks(input))

  return checks
}

// ---- Universal checks (FV-09) — domain-agnostic, stay in code ----

function providerStatusCompleted(env: ResponseEnvelope): CheckResult {
  if (env.status === "completed") return pass("provider_status_completed")
  // FV-10 — build remediation from the structured error, in Factory-domain terms.
  const detail = factoryDomainError(env.error)
  return fail(
    "provider_status_completed",
    `The step did not complete (status: ${env.status}). ${detail} The next attempt must finish the declared work cleanly.`,
    "revision",
  )
}

function declaredOutputsProduced(env: ResponseEnvelope, declared: string[]): CheckResult {
  // FV-07 — if the manifest is missing entirely, the check cannot be computed → FAIL.
  if (!env.artifact_manifest) {
    return fail(
      "declared_outputs_produced",
      "No artifact manifest was available to confirm the declared outputs were produced; produce the declared outputs and record them in the manifest before completing.",
      "preflight",
    )
  }
  const byName = new Map(env.artifact_manifest.map((m) => [m.name, m]))
  for (const name of declared) {
    const entry = byName.get(name)
    // missing entry, state !== produced, or produced without a computed checksum → fail-closed.
    if (!entry || entry.state !== "produced" || !entry.checksum) {
      return fail(
        "declared_outputs_produced",
        `Declared output ${safeName(name)} was not produced. Produce ${safeName(name)} before completing the step.`,
        "preflight",
      )
    }
  }
  return pass("declared_outputs_produced")
}

function noUnresolvedPolicyViolations(env: ResponseEnvelope): CheckResult {
  const events = env.policy_events ?? []
  const unresolved = events.find((e) => e.kind === "violation" && e.resolved !== true)
  if (!unresolved) return pass("no_unresolved_policy_violations")
  // A Layer-3 substrate boundary firing is a high-severity Signal → Escalation.
  const gate: GateClass = unresolved.source_layer === "layer3" ? "escalation" : "revision"
  return fail(
    "no_unresolved_policy_violations",
    `A governance boundary was breached (${safeRule(unresolved.rule)}) and was not resolved. The next attempt must stay within the declared write scope and policy.`,
    gate,
  )
}

function stopConditionExternallyVerifiable(env: ResponseEnvelope): CheckResult {
  if (env.completion_claimed_without_manifest === true) {
    return fail(
      "stop_condition_externally_verifiable",
      "Completion was claimed without a manifest-backed produced set. A step is complete only when every declared output is produced and verifiable, not when the agent reports it is done.",
      "preflight",
    )
  }
  return pass("stop_condition_externally_verifiable")
}

// ---- Config-driven per-step-type checks (FV-12, Q2) ----

/**
 * Evaluate every configured check whose step_pattern matches the step name, in
 * file order. The validator interprets ONLY the predicate grammar; it never
 * knows what a given check "means" in any domain.
 */
function configuredChecks(input: ValidateInput): CheckResult[] {
  const outputs = input.response.step_outputs ?? {}
  const results: CheckResult[] = []
  for (const spec of input.check_config.check) {
    if (!matchesStep(spec.step_pattern, input.step_name)) continue
    results.push(evaluateCheck(spec, outputs))
  }
  return results
}

/** Case-insensitive regex match of a configured step_pattern against the step name. */
function matchesStep(pattern: string, stepName: string): boolean {
  let re: RegExp
  try {
    re = new RegExp(pattern, "i")
  } catch {
    // A malformed pattern in config must not crash the validator; treat as no-match.
    return false
  }
  return re.test(stepName)
}

/**
 * Apply one configured check's predicate to the step_outputs map.
 * Fail-closed (FV-07): an absent field fails the predicate, EXCEPT the two
 * explicitly-not-applicable predicates (na_unless_present, distinct_from:*).
 */
function evaluateCheck(spec: CheckSpec, outputs: Record<string, unknown>): CheckResult {
  const verdict = evaluatePredicate(spec.condition.field, spec.condition.predicate, outputs)
  if (verdict === "not-applicable") return notApplicable(spec.check_id)
  if (verdict === "pass") return pass(spec.check_id)
  return fail(spec.check_id, spec.remediation, spec.gate_class)
}

type PredicateResult = "pass" | "fail" | "not-applicable"

function evaluatePredicate(
  field: string,
  predicate: string,
  outputs: Record<string, unknown>,
): PredicateResult {
  const value = readField(outputs, field)

  if (predicate === "non_empty_string") {
    return typeof value === "string" && value.trim().length > 0 ? "pass" : "fail"
  }
  if (predicate === "truthy") {
    return value === true ? "pass" : "fail"
  }
  if (predicate === "present") {
    return value !== undefined && value !== null ? "pass" : "fail"
  }
  if (predicate.startsWith("eq:")) {
    const expected = predicate.slice(3)
    return value !== undefined && value !== null && String(value) === expected ? "pass" : "fail"
  }
  if (predicate.startsWith("gte:")) {
    const n = Number(predicate.slice(4))
    return typeof value === "number" && Number.isFinite(value) && value >= n ? "pass" : "fail"
  }
  if (predicate === "na_unless_present") {
    // FV-12 exception: a check the envelope cannot witness is not-applicable, not a fail.
    if (value === undefined || value === null) return "not-applicable"
    return value === true ? "pass" : "fail"
  }
  if (predicate.startsWith("distinct_from:")) {
    // FV-12 exception (verifier_distinct_from_author): not-applicable unless BOTH
    // identities are present; FAILS only when they are equal.
    const other = readField(outputs, predicate.slice("distinct_from:".length))
    if (value === undefined || value === null || other === undefined || other === null) {
      return "not-applicable"
    }
    return String(value) === String(other) ? "fail" : "pass"
  }

  // FV-07 — an unknown predicate cannot be computed → fail-closed.
  return "fail"
}

/** Resolve a dot-path into the step_outputs map. Returns undefined when absent. */
function readField(outputs: Record<string, unknown>, path: string): unknown {
  let cursor: unknown = outputs
  for (const key of path.split(".")) {
    if (cursor === null || typeof cursor !== "object") return undefined
    cursor = (cursor as Record<string, unknown>)[key]
  }
  return cursor
}

// ---- RELEASE molecule-AND (FV-08) — universal, reads prior verdicts only ----

function allPriorStepsApproved(input: ValidateInput): CheckResult {
  const revised = input.prior_step_verdicts
    .filter((p) => p.outcome === "revise")
    .sort((a, b) => a.step_index - b.step_index)
  if (revised.length === 0) return pass("all_prior_steps_approved")
  // earliest-failing step supplies the molecule remediation (FV-08).
  const earliest = revised[0]!
  return fail("all_prior_steps_approved", earliest.remediation || "An earlier step failed verification.", "preflight")
}

// ---- Remediation hygiene (FV-15) — strip provider internals ----

/**
 * Translate a structured provider error into a Factory-domain statement.
 * Never passes raw error codes, paths, container ids, or R2 keys through.
 */
function factoryDomainError(error: ResponseEnvelope["error"]): string {
  if (!error) return "The provider reported no further detail."
  // Map known provider-internal codes to domain language; otherwise generic.
  const code = (error.code ?? "").toLowerCase()
  if (code.includes("path_guard") || code.includes("filesystem")) {
    return "A write fell outside the declared scope."
  }
  if (code.includes("declared_outputs_missing")) {
    return "One or more declared outputs were not produced."
  }
  if (code.includes("timeout")) {
    return "Execution exceeded its time budget."
  }
  return "Execution did not finish cleanly."
}

/** Remove provider-internal identifiers (FV-15). Defensive even for caller-supplied strings. */
function stripProviderInternals(s: string): string {
  return s
    .replace(/r2:\/\/\S+/gi, "the stored evidence")
    .replace(/(\/[A-Za-z0-9_.-]+)+\/?/g, "the declared path") // absolute fs paths
    .replace(/\bcontainer[-_ ]?[A-Za-z0-9-]+/gi, "the runtime")
    .replace(/\bPI_[A-Z_]+\b/g, "a runtime guard")
    .trim()
}

function safeName(name: string): string {
  return stripProviderInternals(name) || "the declared output"
}

function safeRule(rule: string | undefined): string {
  if (!rule) return "policy"
  return rule.replace(/[^A-Za-z0-9_]/g, "")
}

// ---- check-result constructors ----

function pass(name: string): CheckResult {
  return { name, result: "pass" }
}

function notApplicable(name: string): CheckResult {
  return { name, result: "not-applicable" }
}

function fail(name: string, remediation: string, gate_class: GateClass): CheckResult {
  return { name, result: "fail", remediation: stripProviderInternals(remediation), gate_class }
}
