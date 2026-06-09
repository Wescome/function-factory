// Gas City fidelity validator CLI orchestration.
//
// Implements IS-GC-FIDELITY-VALIDATION end-to-end (verdict algorithm steps 1–7).
//
// This is the artifact the formula RELEASE step invokes. It is deterministic and
// performs NO network I/O itself — it RETURNS the action the supervisor/formula
// step must take. The actual HTTP POST is done by the formula's curl (Gas City
// has no native webhook emission — GOVD D8). Keeping the POST out of the CLI also
// keeps the CLI pure and trivially testable.
//
// Entry point: `runCli(input)` for tests; `main()` reads a JSON job on stdin and
// writes a JSON result on stdout when run as a script.

import { join } from "node:path"
import { loadCheckConfig } from "./check-config.ts"
import { decideConvergence } from "./convergence.ts"
import type { ConvergenceState } from "./convergence.ts"
import { validate } from "./fidelity-validator.ts"
import { buildReleasePayload, signedHeaders } from "./release-payload.ts"
import type { Lineage } from "./release-payload.ts"
import type { CheckConfig, PriorStepVerdict, ResponseEnvelope } from "./types.ts"

/** The JSON job spec read on stdin (assembled by the supervisor / formula step). */
export interface CliInput {
  /**
   * The raw step name from the formula step definition. The validator matches it
   * by regex against fidelity-checks.toml; it is NOT classified into a fixed enum.
   * Domain-neutral — any string is valid.
   */
  step_name: string
  lineage: Lineage
  declared_outputs: string[]
  prior_step_verdicts: PriorStepVerdict[]
  response: ResponseEnvelope
  convergence: { max_amendment_depth?: number; prior_failing_count?: number }
  webhook: { url: string; hmac_secret: string; key_id: string }
  /**
   * Optional explicit terminator flag. When omitted, the CLI infers it from the
   * role/step name (the formula's RELEASE step). Domain-neutral: "is this the
   * step that emits the molecule verdict" is a formula property.
   */
  is_release_step?: boolean
}

/** molecule.failed operational event (fail-closed; webhook-receiver GasCityOperationalEventPayload). */
export interface MoleculeFailedEvent {
  event_type: "molecule.failed"
  fn_id: string
  is_id?: string
  es_id?: string
  ep_id?: string
  form_id?: string
  bead_id: string
  severity: "sev2"
  message: string
}

export type CliResult =
  | {
      action: "post_release"
      url: string
      outcome: "approved" | "revise"
      body: string
      headers: Record<string, string>
    }
  | {
      action: "rerun"
      next_attempt: number
      remediation_to_inject: string
    }
  | {
      action: "molecule_failed"
      event: MoleculeFailedEvent
      /** the signed body for the operational event POST (the receiver verifies HMAC on ALL inbound). */
      body: string
      headers: Record<string, string>
    }

const DEFAULT_MAX_DEPTH = 3

/**
 * Deterministic orchestration. Pure: no clock, no random, no network. Same input → same result (FV-02).
 *
 * The per-step-type check table is passed IN (loaded from fidelity-checks.toml by
 * the caller / main()), never imported at module scope — so the orchestrator, like
 * the validator, carries zero domain knowledge.
 */
export function runCli(input: CliInput, checkConfig: CheckConfig): CliResult {
  // FV-07 fail-closed at the boundary: an unparseable response is not a pass.
  if (!isEnvelope(input.response)) {
    return moleculeFailed(input, "Provider response envelope was absent or malformed; cannot validate fidelity.")
  }

  const maxDepth = positiveIntOr(input.convergence?.max_amendment_depth, DEFAULT_MAX_DEPTH)

  // Verdict bijection (FV-06 / FV-09 / FV-12). Per-step-type checks come from config.
  const verdict = validate({
    response: input.response,
    step_name: input.step_name,
    check_config: checkConfig,
    prior_step_verdicts: input.prior_step_verdicts ?? [],
    declared_outputs: input.declared_outputs ?? [],
    is_release_step: input.is_release_step === true,
  })

  // Convergence decision (FV-16..FV-18a).
  const state: ConvergenceState = {
    factory_attempt: input.lineage.factory_attempt,
    max_amendment_depth: maxDepth,
    prior_failing_count: input.convergence?.prior_failing_count,
  }
  const decision = decideConvergence(verdict, state)

  if (decision.action === "rerun") {
    return {
      action: "rerun",
      next_attempt: decision.next_attempt!,
      remediation_to_inject: decision.remediation_to_inject!,
    }
  }

  // decision.action === "emit_release" → build + sign the RELEASE payload (FV-19..FV-21).
  const outcome = decision.outcome!
  const remediation = outcome === "approved" ? "" : (decision.remediation ?? verdict.remediation)
  let body: string
  try {
    body = buildReleasePayload(input.lineage, outcome, remediation)
  } catch (err) {
    // FV-20 fail-closed: never POST a malformed payload — emit molecule.failed.
    return moleculeFailed(input, `RELEASE payload could not be constructed: ${errMessage(err)}`)
  }

  return {
    action: "post_release",
    url: input.webhook.url,
    outcome,
    body,
    headers: signedHeaders(input.webhook.hmac_secret, body, input.webhook.key_id),
  }
}

function moleculeFailed(input: CliInput, message: string): CliResult {
  const event: MoleculeFailedEvent = {
    event_type: "molecule.failed",
    fn_id: stringOr(input.lineage?.fn_id, "FN-UNKNOWN"),
    bead_id: stringOr(input.lineage?.bead_id, "bead-unknown"),
    severity: "sev2",
    message,
  }
  if (input.lineage?.is_id) event.is_id = input.lineage.is_id
  if (input.lineage?.es_id) event.es_id = input.lineage.es_id
  if (input.lineage?.ep_id) event.ep_id = input.lineage.ep_id
  if (input.lineage?.form_id) event.form_id = input.lineage.form_id

  // The receiver verifies HMAC on ALL inbound bodies before routing (verifyGasCityHmac runs first),
  // so the operational event must also be signed. Field order is not load-bearing for operational
  // events (no integer-vs-string trap), but we still sign the exact emitted bytes.
  const body = JSON.stringify(event)
  return {
    action: "molecule_failed",
    event,
    body,
    headers: signedHeaders(input.webhook?.hmac_secret ?? "", body, input.webhook?.key_id ?? "v1"),
  }
}

function isEnvelope(value: unknown): value is ResponseEnvelope {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { status?: unknown }).status === "string"
  )
}

function positiveIntOr(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && (value as number) > 0 ? (value as number) : fallback
}

function stringOr(value: string | undefined, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ---- script entry point (run by the formula RELEASE step) ----

/**
 * Resolve the fidelity-checks.toml path. Configurable via FIDELITY_CHECKS_CONFIG;
 * defaults to factory/fidelity-checks.toml relative to this file's directory
 * (factory/fidelity/), i.e. the formula root's fidelity config.
 */
function resolveCheckConfigPath(): string {
  const fromEnv = process.env.FIDELITY_CHECKS_CONFIG
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim()
  return join(import.meta.dir, "..", "fidelity-checks.toml")
}

async function main(): Promise<void> {
  const chunks: Uint8Array[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Uint8Array)
  const raw = Buffer.concat(chunks).toString("utf8")
  let input: CliInput
  try {
    input = JSON.parse(raw) as CliInput
  } catch {
    process.stdout.write(JSON.stringify({ action: "molecule_failed", error: "stdin_not_json" }) + "\n")
    process.exit(1)
    return
  }

  // FV-07 fail-closed at the boundary: an unloadable/malformed check table is never
  // a pass — emit molecule.failed rather than validating with an unusable table.
  let checkConfig: CheckConfig
  try {
    checkConfig = loadCheckConfig(resolveCheckConfigPath())
  } catch (err) {
    const result = moleculeFailed(input, `Fidelity check configuration could not be loaded: ${errMessage(err)}`)
    process.stdout.write(JSON.stringify(result) + "\n")
    process.exit(20)
    return
  }

  const result = runCli(input, checkConfig)
  process.stdout.write(JSON.stringify(result) + "\n")
  // Exit code communicates the action to the shell without parsing JSON:
  //   0 = post_release, 10 = rerun, 20 = molecule_failed.
  process.exit(result.action === "post_release" ? 0 : result.action === "rerun" ? 10 : 20)
}

// Run main only when executed directly (not when imported by tests).
if (import.meta.main) {
  void main()
}
