/**
 * formula-compiler.ts — Gas City Formula Compiler and Dispatch (IP-1)
 *
 * Implements IS-GC-EP-FORMULA-DISPATCH (v2). Turns an Execution Packet
 * (EP-* / TEP-* during the prefix transition) into a FormulaInstance
 * (FORM-*) and dispatches it to Gas City via the documented 3-call HTTP
 * sequence (version probe → bead create → sling attach).
 *
 * Hard rules (load-bearing):
 *   - No LLM calls. Forbidden imports: providers, callProvider,
 *     @anthropic-ai/sdk, openai, @weops/gdk-ai. (AC-19, V2.)
 *   - Deterministic output. Same EP content + same factory_attempt ⇒
 *     byte-identical vars, parameters_json, and FORM-* `_key`. (AC-4, V1.)
 *   - Atomic FORM-* + dispatch_log write before any Gas City call. (AC-7,
 *     AC-23, V3, V4.)
 *   - Idempotency is three-layer: durable barrier (dispatch_log), primary
 *     barrier (CALL 2 Idempotency-Key header), secondary barrier (CALL 3
 *     409 detection).
 *
 * The module exposes a pure orchestration function. All side-effects —
 * ArangoDB reads/writes, Gas City HTTP calls, clock, sleep — are injected
 * via the `FormulaCompilerDeps` adapter so the function is fully unit-
 * testable without a live Worker or database. The Worker entrypoint that
 * wires real deps lives separately (see harness-bridge / index.ts).
 */

import type { TrellisExecutionPacket } from "@factory/schemas"

// ─── Types ────────────────────────────────────────────────────────────────

/**
 * Subset of CF Worker env bindings this compiler reads. Names match
 * IS §Environment dependencies. The compiler never touches an env var
 * outside this set.
 */
export interface FormulaCompilerEnv {
  GAS_CITY_CITY_NAME: string
  GAS_CITY_BEARER_TOKEN: string
  GAS_CITY_AGENT_NAME: string
  GAS_CITY_RIG: string
  GAS_CITY_RIG_ROOT: string
  GAS_CITY_WEBHOOK_URL: string
  FACTORY_MAX_ITERATIONS?: string
  /**
   * Pinned formula version env vars. Lookup name is derived from the
   * template name: `template_name.toUpperCase().replace(/-/g, "_")`
   * prepended with `GAS_CITY_FORMULA_VERSION_`. The IS calls out
   * `GAS_CITY_FORMULA_VERSION_FACTORY_CODING_V1` for the coding adapter.
   */
  GAS_CITY_FORMULA_VERSION_FACTORY_CODING_V1?: string
  [k: `GAS_CITY_FORMULA_VERSION_${string}`]: string | undefined
  /** Git SHA injected at build time. Stamped into FORM-*.compiler. */
  BUILD_GIT_SHA?: string
}

/**
 * FORM-* artifact persisted in ArangoDB collection `formulas`. Fields per
 * AC-5; `_key` per AC-6. `vars` is `Record<string,string>` — every value
 * is a string, including JSON-stringified blobs.
 */
export interface FormArtifact {
  _key: string
  kind: "FormulaArtifact"
  tier: "procedural"
  template_name: string
  /** Initially `"pending"`; updated to GET response value after CALL 1 (AC-11). */
  formula_version: string
  vars: Record<string, string>
  parameters_json: string
  source_refs: string[]
  explicitness: "explicit"
  compiled_at: string
  /** `workers/ff-pipeline/src/compilers/formula-compiler.ts@<gitSha>`. */
  compiler: string
}

/** dispatch_log outcome enum — values match AC-9 / AC-9a. */
export type DispatchOutcome =
  | "pending"
  | "dispatched"
  | "failed"
  | "version_mismatch"
  | "rejected"
  | "in_flight"
  | "timeout_call_1"
  | "timeout_call_2"
  | "timeout_call_3"

/** dispatch_log row shape per AC-8 / AC-9. */
export interface DispatchLogRow {
  _key: string
  es_id: string
  ep_id: string
  form_id: string
  fn_id: string
  is_id: string
  factory_attempt: number
  idempotency_key: string
  started_at: string
  outcome: DispatchOutcome
  gc_bead_id: string | null
  gc_workflow_id: string | null
  gc_workflow_root_bead_id: string | null
  labels_sent: string[] | null
  sling_request_hash: string | null
  completed_at?: string
  error?: string
}

/** Top-level result returned to the caller. */
export interface FormulaCompilerResult {
  outcome: DispatchOutcome
  form_id?: string
  dispatch_log_key?: string
  gc_bead_id?: string
  gc_workflow_id?: string
  gc_workflow_root_bead_id?: string
  error?: string
}

/** UncertaintyEntry payload emitted by the compiler on halt conditions. */
export interface UncertaintyEmission {
  pass_or_skill: string
  source_ref?: string
  reason: string
  suggested_resolution: string
  blocking_for: string[]
  timestamp: string
}

/**
 * Coherence VR row shape consumed from `verification_reports` (AC-0).
 */
export interface CoherenceVRRow {
  _key: string
  source_refs: string[]
  kind: string
  status: string
  created_at: string
}

/**
 * Dependency adapter. Every external effect goes through here. The Worker
 * wires real adapters; tests inject mocks.
 */
export interface FormulaCompilerDeps {
  /**
   * AC-0 lookup: most-recent Coherence VR for the ES with
   * kind="coherence", status="passed". Returns null when absent.
   */
  fetchCoherenceVR(esId: string): Promise<CoherenceVRRow | null>
  /**
   * Idempotency pre-check: look up dispatch_log by
   * (idempotency_key, factory_attempt). Returns the row when one exists.
   *
   * `excludeKey` (optional) — when present, the adapter MUST NOT return a
   * row whose `_key` equals this value. This is used by the CALL 2 409
   * handler to avoid matching the just-written `pending` row for the
   * current invocation (which has `gc_bead_id: null` and would
   * incorrectly cause the 409 to be treated as hard failure).
   */
  getDispatchLogByIdempotencyKey(
    idempotencyKey: string,
    factoryAttempt: number,
    excludeKey?: string,
  ): Promise<DispatchLogRow | null>
  /** AC-6 collision check: read FORM-* by `_key`. */
  getFormulaByKey(key: string): Promise<FormArtifact | null>
  /**
   * AC-7 / AC-23: write FORM-* and dispatch_log in a single stream
   * transaction. Adapter is responsible for begin/commit/abort. Throws on
   * unique-index violation (AC-21).
   */
  writeFormAndDispatchLog(form: FormArtifact, dispatchLog: DispatchLogRow): Promise<void>
  /** AC-11: separate post-CALL-1 update of FORM-*.formula_version. */
  updateFormulaVersion(formKey: string, version: string): Promise<void>
  /** AC-9 / AC-9a: update the dispatch_log row with a final outcome. */
  updateDispatchLog(key: string, patch: Partial<DispatchLogRow>): Promise<void>
  /** Persist an UncertaintyEntry. The compiler halts after calling this. */
  emitUncertaintyEntry(entry: UncertaintyEmission): Promise<void>
  /**
   * HTTP client. Tests pass a recording mock; the Worker passes
   * (url, init) => fetch(url, init) with a 25s timeout.
   */
  httpFetch(url: string, init?: RequestInit): Promise<Response>
  /** Clock injection — kept deterministic in tests. */
  now(): string
  /** Sleep — used for CALL 2 / CALL 3 retry backoff. */
  sleep(ms: number): Promise<void>
}

/** Caller input. */
export interface FormulaCompilerInput {
  /**
   * The Execution Packet. Typed as the full TrellisExecutionPacket but the
   * compiler reads a minimal subset; tests pass partial objects via the
   * unknown-cast escape hatch.
   */
  ep: TrellisExecutionPacket
  /** Dispatch attempt counter. First attempt is 1, amendments 2+. */
  factoryAttempt: number
  /** Required when `factoryAttempt >= 2` (AC-20). */
  priorEsId?: string
  env: FormulaCompilerEnv
  deps: FormulaCompilerDeps
}

// ─── Constants ────────────────────────────────────────────────────────────

/**
 * AC-1 registered adapter ⇒ template name mapping. Adding a new adapter
 * is a deliberate code change, not a runtime lookup, because each template
 * has its own var schema and its own version pin env var.
 */
const ADAPTER_TO_TEMPLATE: Record<string, string> = {
  "adapter.coding": "factory-coding-v1",
}

/**
 * AC-2 reserved keys. EP parameters that match any of these collide with
 * the compiler's own var emissions and would silently mask the lineage
 * identifiers Gas City uses to route the molecule.
 */
const RESERVED_VAR_NAMES = new Set<string>([
  "fn_id",
  "is_id",
  "es_id",
  "ep_id",
  "form_id",
  "factory_attempt",
  "ff_webhook_url",
  "ff_webhook_hmac_keyid",
  "rig_root",
  "max_iterations",
  "parameters_json",
])

/**
 * Roles the registered template set expects to consume (planner / coder /
 * verifier). Missing roles get empty-string vars so the template engine
 * always has the key (AC-3).
 */
const STANDARD_ROLE_IDS = ["planner", "coder", "verifier"] as const

const PER_CALL_TIMEOUT_MS = 25_000
const CALL_2_RETRY_BACKOFF_MS = [1000, 2000, 4000] // AC-13: 3 retries
const CALL_3_RETRY_BACKOFF_MS = [1000, 2000, 4000] // AC-18: 3 retries
const COMPILER_MODULE_PATH = "workers/ff-pipeline/src/compilers/formula-compiler.ts"

// ─── Entry point ──────────────────────────────────────────────────────────

/**
 * Compile an EP into a FORM-* and dispatch it to Gas City. Follows the
 * IS §Execution sequence exactly. Side-effects flow only through `deps`.
 *
 * Return value is the terminal `dispatch_log.outcome` plus identifiers.
 * The caller logs structured telemetry; this function does not throw on
 * controlled-halt conditions (missing VR, reserved-key collision, version
 * mismatch, transient HTTP failure with exhausted retries) — it returns
 * an outcome instead.
 */
export async function compileAndDispatchFormula(
  input: FormulaCompilerInput,
): Promise<FormulaCompilerResult> {
  const { ep, factoryAttempt, env, deps } = input
  const priorEsId = input.priorEsId

  // Pull the minimal EP subset we use into local variables so the type-system
  // doesn't fight us on the deep-typed schema. The EP is treated as a
  // structural read; upstream validates schema (we never re-run zod).
  const epAny = ep as unknown as {
    id: string
    functionId: string
    intentSpecificationId: string
    executableSpecificationId: string
    instructionTuning: { inputExecutableSpecificationHash: string }
    adapter: {
      adapterId: string
      executionRequest: { parameters: Record<string, unknown> }
    }
    roles: Array<{
      roleId: string
      instruction: string
      inputs: string[]
      outputs: string[]
    }>
  }

  // ── AC-0: Coherence VR precondition ────────────────────────────────────
  const vr = await deps.fetchCoherenceVR(epAny.executableSpecificationId)
  if (!vr) {
    await deps.emitUncertaintyEntry({
      pass_or_skill: "formula-compiler",
      source_ref: epAny.id,
      reason: `No Coherence VR (kind=coherence, status=passed) found for ES ${epAny.executableSpecificationId}`,
      suggested_resolution:
        "Run Coherence Verification on the source ES before re-dispatching the EP.",
      blocking_for: ["dispatch"],
      timestamp: deps.now(),
    })
    return { outcome: "failed", error: "missing_coherence_vr" }
  }

  // ── Compute the canonical idempotency key up front. Needed by:
  //    - dispatch_log pre-check
  //    - CALL 2 Idempotency-Key header
  //    - AC-21 unique index
  const idempotencyKey = await sha256Hex(
    `${epAny.executableSpecificationId}|${epAny.instructionTuning.inputExecutableSpecificationHash}|${factoryAttempt}`,
  )

  // ── Idempotency pre-check (durable barrier) + AC-24 resume path ────────
  const prior = await deps.getDispatchLogByIdempotencyKey(idempotencyKey, factoryAttempt)
  if (prior?.outcome === "dispatched") {
    // Already done. Return the existing identifiers.
    const r: FormulaCompilerResult = {
      outcome: "dispatched",
      form_id: prior.form_id,
      dispatch_log_key: prior._key,
    }
    if (prior.gc_bead_id) r.gc_bead_id = prior.gc_bead_id
    if (prior.gc_workflow_id) r.gc_workflow_id = prior.gc_workflow_id
    if (prior.gc_workflow_root_bead_id) r.gc_workflow_root_bead_id = prior.gc_workflow_root_bead_id
    return r
  }
  // AC-24: pending/in_flight row with bead present but no workflow → resume at CALL 3.
  if (
    prior &&
    (prior.outcome === "pending" || prior.outcome === "in_flight") &&
    prior.gc_bead_id &&
    !prior.gc_workflow_id
  ) {
    // Fetch the already-written FORM-* for vars + template name.
    const existingForm = await deps.getFormulaByKey(prior.form_id)
    if (!existingForm) {
      // FORM-* missing on resume — treat as hard failure rather than guess.
      await deps.updateDispatchLog(prior._key, {
        outcome: "failed",
        error: "resume_missing_form",
        completed_at: deps.now(),
      })
      return { outcome: "failed", error: "resume_missing_form" }
    }
    return await dispatchCall3AndFinalize({
      form: existingForm,
      dispatchLogKey: prior._key,
      beadId: prior.gc_bead_id,
      env,
      deps,
      idempotencyKey,
      factoryAttempt,
    })
  }

  // ── AC-1: template selection ───────────────────────────────────────────
  const templateName = ADAPTER_TO_TEMPLATE[epAny.adapter.adapterId]
  if (!templateName) {
    await deps.emitUncertaintyEntry({
      pass_or_skill: "formula-compiler",
      source_ref: epAny.id,
      reason: `No template registered for adapter ${epAny.adapter.adapterId}`,
      suggested_resolution:
        "Register the adapter in ADAPTER_TO_TEMPLATE and author its Gas City formula template before re-dispatching.",
      blocking_for: ["FORM-* creation"],
      timestamp: deps.now(),
    })
    return { outcome: "failed", error: "unregistered_adapter" }
  }

  // ── AC-2 / AC-3 / AC-4: build deterministic var map ────────────────────
  const parameters = epAny.adapter.executionRequest.parameters ?? {}
  // AC-2 reserved-key collision check.
  for (const k of Object.keys(parameters)) {
    if (RESERVED_VAR_NAMES.has(k)) {
      await deps.emitUncertaintyEntry({
        pass_or_skill: "formula-compiler",
        source_ref: epAny.id,
        reason: `EP parameters contain reserved var key "${k}". Reserved keys collide with compiler-emitted lineage vars.`,
        suggested_resolution: `Rename "${k}" in the EP parameters (and in the upstream IS/ES) before re-dispatching.`,
        blocking_for: ["FORM-* creation"],
        timestamp: deps.now(),
      })
      return { outcome: "failed", error: "reserved_key_collision" }
    }
  }

  // FORM-* key derivation (AC-6) requires only ep_id + factory_attempt —
  // safe to compute before the full var map is built.
  const formKey = await deriveFormKey(epAny.id, factoryAttempt)

  // AC-2 reserved/lineage vars
  const reservedVars: Record<string, string> = {
    fn_id: epAny.functionId,
    is_id: epAny.intentSpecificationId,
    es_id: epAny.executableSpecificationId,
    ep_id: epAny.id,
    form_id: formKey,
    factory_attempt: String(factoryAttempt),
    ff_webhook_url: env.GAS_CITY_WEBHOOK_URL,
    ff_webhook_hmac_keyid: "v1",
    rig_root: env.GAS_CITY_RIG_ROOT,
    max_iterations: env.FACTORY_MAX_ITERATIONS ?? "5",
    parameters_json: stableStringify(parameters),
  }

  // AC-3 role vars (no prefix stripping; every role contributes 3 vars).
  const roleVars: Record<string, string> = {}
  const seenRoleIds = new Set<string>()
  for (const role of epAny.roles) {
    seenRoleIds.add(role.roleId)
    roleVars[`${role.roleId}_prompt`] = role.instruction
    roleVars[`${role.roleId}_inputs`] = JSON.stringify(role.inputs)
    roleVars[`${role.roleId}_outputs`] = JSON.stringify(role.outputs)
  }
  for (const standardId of STANDARD_ROLE_IDS) {
    if (!seenRoleIds.has(standardId)) {
      roleVars[`${standardId}_prompt`] = ""
      roleVars[`${standardId}_inputs`] = ""
      roleVars[`${standardId}_outputs`] = ""
    }
  }

  // AC-4 determinism: sort keys before assembly so iteration order is
  // stable regardless of how the upstream EP was constructed.
  const vars = mergeSortedVars(reservedVars, roleVars)

  // ── AC-6 collision policy: check for an existing FORM-* at this key ────
  const existing = await deps.getFormulaByKey(formKey)
  if (existing) {
    const existingFirstSource = existing.source_refs[0] ?? ""
    if (existingFirstSource !== epAny.id) {
      // Hard collision — different upstream EP at the same key.
      await deps.emitUncertaintyEntry({
        pass_or_skill: "formula-compiler",
        source_ref: epAny.id,
        reason: `FORM-* key collision: existing FORM-* ${formKey} has source_refs[0]=${existingFirstSource}, expected ${epAny.id}`,
        suggested_resolution:
          "Investigate the SHA-256 collision (64-bit namespace). Manual deconfliction required.",
        blocking_for: ["dispatch"],
        timestamp: deps.now(),
      })
      return { outcome: "failed", error: "form_key_collision" }
    }
    // Determinism replay — proceed without rewriting FORM-*.
    if (
      stableStringify(existing.vars) !== stableStringify(vars) ||
      existing.parameters_json !== reservedVars.parameters_json
    ) {
      // Same EP + factory_attempt but different compiled output — this
      // means a compiler change broke determinism. Halt loudly.
      await deps.emitUncertaintyEntry({
        pass_or_skill: "formula-compiler",
        source_ref: epAny.id,
        reason: `FORM-* key collision: existing FORM-* ${formKey} has different vars from current compilation. Determinism invariant violated.`,
        suggested_resolution:
          "Investigate compiler determinism regression. Likely cause: non-deterministic field added to var map.",
        blocking_for: ["dispatch"],
        timestamp: deps.now(),
      })
      return { outcome: "failed", error: "form_determinism_violation" }
    }
  }

  // ── AC-5 / AC-7 / AC-8 / AC-23: atomic FORM-* + dispatch_log write ─────
  const compiledAt = deps.now()
  const gitSha = env.BUILD_GIT_SHA ?? "unknown"
  const form: FormArtifact = {
    _key: formKey,
    kind: "FormulaArtifact",
    tier: "procedural",
    template_name: templateName,
    formula_version: "pending", // updated post-CALL-1 (AC-11)
    vars,
    parameters_json: reservedVars.parameters_json!,
    source_refs: [epAny.id],
    explicitness: "explicit",
    compiled_at: compiledAt,
    compiler: `${COMPILER_MODULE_PATH}@${gitSha}`,
  }
  const dispatchLogKey = crypto.randomUUID()
  const dispatchLog: DispatchLogRow = {
    _key: dispatchLogKey,
    es_id: epAny.executableSpecificationId,
    ep_id: epAny.id,
    form_id: formKey,
    fn_id: epAny.functionId,
    is_id: epAny.intentSpecificationId,
    factory_attempt: factoryAttempt,
    idempotency_key: idempotencyKey,
    started_at: compiledAt,
    outcome: "pending",
    gc_bead_id: null,
    gc_workflow_id: null,
    gc_workflow_root_bead_id: null,
    labels_sent: null,
    sling_request_hash: null,
  }

  try {
    await deps.writeFormAndDispatchLog(form, dispatchLog)
  } catch (err) {
    // AC-7 / AC-21: transaction abort OR unique-index violation. Either way
    // neither artifact persisted. No Gas City call fires.
    return {
      outcome: "failed",
      error: err instanceof Error ? err.message : String(err),
    }
  }

  // ── CALL 1: GET formula (version probe, AC-10) ─────────────────────────
  const pinnedVersionEnvVar = formulaVersionEnvName(templateName)
  const pinnedVersion = (env as unknown as Record<string, string | undefined>)[
    pinnedVersionEnvVar
  ]

  let probeStatus = 0
  let probeBody: { version?: string } | null = null
  try {
    const probeRes = await deps.httpFetch(
      gasCityUrl(env, `/formulas/${templateName}`),
      {
        method: "GET",
        headers: gasCityAuthHeaders(env),
        signal: AbortSignal.timeout(PER_CALL_TIMEOUT_MS),
      },
    )
    probeStatus = probeRes.status
    if (probeRes.ok) {
      probeBody = (await probeRes.json().catch(() => null)) as { version?: string } | null
    }
  } catch (err) {
    await deps.updateDispatchLog(dispatchLogKey, {
      outcome: "timeout_call_1",
      error: err instanceof Error ? err.message : String(err),
      completed_at: deps.now(),
    })
    return { outcome: "timeout_call_1", form_id: formKey, dispatch_log_key: dispatchLogKey }
  }
  if (probeStatus < 200 || probeStatus >= 300 || !probeBody || typeof probeBody.version !== "string") {
    await deps.updateDispatchLog(dispatchLogKey, {
      outcome: "timeout_call_1",
      error: `CALL 1 HTTP ${probeStatus}`,
      completed_at: deps.now(),
    })
    return { outcome: "timeout_call_1", form_id: formKey, dispatch_log_key: dispatchLogKey }
  }
  const probeVersion = probeBody.version
  if (!pinnedVersion || probeVersion !== pinnedVersion) {
    await deps.updateDispatchLog(dispatchLogKey, {
      outcome: "version_mismatch",
      error: `formula version mismatch: pinned=${pinnedVersion ?? "<unset>"} actual=${probeVersion}`,
      completed_at: deps.now(),
    })
    await deps.emitUncertaintyEntry({
      pass_or_skill: "formula-compiler",
      source_ref: epAny.id,
      reason: `formula ${templateName} version mismatch: pinned=${pinnedVersion ?? "<unset>"}, GC returned=${probeVersion}`,
      suggested_resolution:
        "Update the pinned formula version env var (after vetting the new template), or roll Gas City back to the pinned version.",
      blocking_for: ["dispatch"],
      timestamp: deps.now(),
    })
    return { outcome: "version_mismatch", form_id: formKey, dispatch_log_key: dispatchLogKey }
  }
  await deps.updateFormulaVersion(formKey, probeVersion)
  form.formula_version = probeVersion

  // ── CALL 2: POST /beads (AC-12 / AC-13 / AC-14) ─────────────────────────
  const labels: string[] = [
    `fn-id:${epAny.functionId}`,
    `is-id:${epAny.intentSpecificationId}`,
    `es-id:${epAny.executableSpecificationId}`,
    `form-id:${formKey}`,
    `factory-attempt:${factoryAttempt}`,
  ]
  if (factoryAttempt >= 2 && priorEsId) {
    labels.push(`amendment-of:${priorEsId}`)
  }
  const beadBody = {
    labels,
    metadata: {
      "ff.dispatch_id": dispatchLogKey,
      "ff.formula_name": templateName,
      "ff.formula_version": probeVersion,
      "ff.dispatched_at": deps.now(),
      "ff.webhook_url": env.GAS_CITY_WEBHOOK_URL,
      "ff.ep_id": epAny.id,
    },
    rig: env.GAS_CITY_RIG,
    title: `Factory dispatch ${formKey}`,
    description: `EP=${epAny.id} FN=${epAny.functionId} attempt=${factoryAttempt}`,
  }
  const beadCallResult = await issueCall2WithRetry({
    env,
    deps,
    idempotencyKey,
    body: beadBody,
    dispatchLogKey,
    factoryAttempt,
    idempotencyKeyForLookup: idempotencyKey,
    currentDispatchLogKey: dispatchLogKey,
  })
  if (beadCallResult.outcome !== "ok") {
    const r: FormulaCompilerResult = {
      outcome: beadCallResult.outcome,
      form_id: formKey,
      dispatch_log_key: dispatchLogKey,
    }
    if (beadCallResult.error) r.error = beadCallResult.error
    return r
  }
  const gcBeadId = beadCallResult.beadId

  // Reflect bead id on the dispatch_log row before CALL 3 so a CALL 3
  // failure leaves the system in a resumable state (AC-24).
  await deps.updateDispatchLog(dispatchLogKey, { gc_bead_id: gcBeadId })

  // ── CALL 3: POST /sling (AC-15 / AC-16 / AC-17 / AC-18) ─────────────────
  return await dispatchCall3AndFinalize({
    form,
    dispatchLogKey,
    beadId: gcBeadId,
    env,
    deps,
    labelsSent: labels,
    idempotencyKey,
    factoryAttempt,
  })
}

// ─── CALL 2 retry path ────────────────────────────────────────────────────

interface Call2Ok {
  outcome: "ok"
  beadId: string
}
interface Call2Fail {
  outcome: "timeout_call_2" | "in_flight" | "rejected" | "failed"
  error?: string
}
type Call2Result = Call2Ok | Call2Fail

/**
 * Issue CALL 2 with the IS retry policy:
 *   - 5xx / network error / timeout → retry up to 3x with 1s/2s/4s backoff.
 *   - On exhausted retries from network/timeout → `in_flight` (AC-9a) —
 *     the bead may exist server-side.
 *   - On exhausted retries from 5xx → `timeout_call_2`.
 *   - 4xx other than 409 → `rejected` immediately (no retry).
 *   - 409 → look up dispatch_log for matching prior bead; replay or
 *     hard-fail per AC-14.
 *   - 201 → success.
 */
async function issueCall2WithRetry(args: {
  env: FormulaCompilerEnv
  deps: FormulaCompilerDeps
  idempotencyKey: string
  body: Record<string, unknown>
  dispatchLogKey: string
  factoryAttempt: number
  idempotencyKeyForLookup: string
  /**
   * AC-14 (MUST-3): `_key` of the dispatch_log row this invocation just
   * wrote. Passed through to the lookup so the 409 handler does not
   * match against the current invocation's own `pending` row.
   */
  currentDispatchLogKey: string
}): Promise<Call2Result> {
  const { env, deps, idempotencyKey, body, dispatchLogKey } = args
  let networkLikeFailure: { error: string } | null = null
  let serverErrorAt: { status: number } | null = null

  const maxAttempts = 1 + CALL_2_RETRY_BACKOFF_MS.length
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const backoff = CALL_2_RETRY_BACKOFF_MS[attempt - 1]
      if (backoff !== undefined) await deps.sleep(backoff)
    }
    let res: Response | null = null
    try {
      res = await deps.httpFetch(gasCityUrl(env, "/beads"), {
        method: "POST",
        headers: {
          ...gasCityAuthHeaders(env),
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(PER_CALL_TIMEOUT_MS),
      })
    } catch (err) {
      networkLikeFailure = {
        error: err instanceof Error ? err.message : String(err),
      }
      continue
    }
    const status = res.status
    if (status === 201) {
      const parsed = (await res.json().catch(() => null)) as { id?: string } | null
      const beadId = parsed?.id
      if (!beadId) {
        await deps.updateDispatchLog(dispatchLogKey, {
          outcome: "failed",
          error: "CALL 2 201 with missing bead id",
          completed_at: deps.now(),
        })
        return { outcome: "failed", error: "CALL 2 201 with missing bead id" }
      }
      return { outcome: "ok", beadId }
    }
    if (status === 409) {
      const parsed = (await res.json().catch(() => null)) as { id?: string } | null
      const respBeadId = parsed?.id
      // AC-14: look up dispatch_log for a matching prior bead id.
      // CRITICAL: exclude the row we just wrote for this invocation
      // (`currentDispatchLogKey`). That row has `gc_bead_id: null`, and
      // matching against it would incorrectly classify the 409 as a hard
      // failure when a legitimate prior dispatch exists. Also require
      // the prior row to have a non-null `gc_bead_id` to compare against.
      const priorRow = await deps.getDispatchLogByIdempotencyKey(
        args.idempotencyKeyForLookup,
        args.factoryAttempt,
        args.currentDispatchLogKey,
      )
      if (
        respBeadId &&
        priorRow &&
        priorRow.gc_bead_id !== null &&
        priorRow.gc_bead_id === respBeadId
      ) {
        return { outcome: "ok", beadId: respBeadId }
      }
      await deps.updateDispatchLog(dispatchLogKey, {
        outcome: "rejected",
        error: `CALL 2 409 without matching prior dispatch_log bead`,
        completed_at: deps.now(),
      })
      return { outcome: "rejected", error: "CALL 2 409 without matching prior" }
    }
    if (status >= 400 && status < 500) {
      // AC-13: 4xx non-409 = hard reject, no retry.
      const txt = await res.text().catch(() => "")
      await deps.updateDispatchLog(dispatchLogKey, {
        outcome: "rejected",
        error: `CALL 2 HTTP ${status}: ${txt}`,
        completed_at: deps.now(),
      })
      return { outcome: "rejected", error: `CALL 2 HTTP ${status}` }
    }
    if (status >= 500) {
      serverErrorAt = { status }
      continue
    }
    // Unexpected (1xx/3xx) — treat as failure, no retry.
    await deps.updateDispatchLog(dispatchLogKey, {
      outcome: "failed",
      error: `CALL 2 unexpected HTTP ${status}`,
      completed_at: deps.now(),
    })
    return { outcome: "failed", error: `CALL 2 unexpected HTTP ${status}` }
  }

  if (networkLikeFailure) {
    // AC-9a: timeout/network failure → in_flight (bead may exist on GC).
    await deps.updateDispatchLog(dispatchLogKey, {
      outcome: "in_flight",
      error: networkLikeFailure.error,
      completed_at: deps.now(),
    })
    return { outcome: "in_flight", error: networkLikeFailure.error }
  }
  if (serverErrorAt) {
    await deps.updateDispatchLog(dispatchLogKey, {
      outcome: "timeout_call_2",
      error: `CALL 2 HTTP ${serverErrorAt.status} after ${CALL_2_RETRY_BACKOFF_MS.length} retries`,
      completed_at: deps.now(),
    })
    return { outcome: "timeout_call_2", error: `CALL 2 HTTP ${serverErrorAt.status}` }
  }
  // Should be unreachable.
  await deps.updateDispatchLog(dispatchLogKey, {
    outcome: "failed",
    error: "CALL 2 retry loop exited without outcome",
    completed_at: deps.now(),
  })
  return { outcome: "failed", error: "CALL 2 retry loop exited without outcome" }
}

// ─── CALL 3 + finalize ────────────────────────────────────────────────────

/**
 * Issue CALL 3 with retries and write the terminal dispatch_log update.
 * Shared by the fresh-dispatch path and the AC-24 resume path.
 *
 * IS retry policy for CALL 3:
 *   - 5xx / network / timeout → retry 3x with 1s/2s/4s backoff.
 *   - On exhausted retries → `timeout_call_3` (no AC-9a equivalence —
 *     bead exists, so partition recovery for CALL 3 is via re-invocation
 *     hitting the resume path with `outcome: "pending"` still).
 *   - 409 with matching prior `workflow_id` (AC-17) → success-on-replay.
 *   - 4xx other → `rejected`.
 *   - 200 with `status: "slung"` → success.
 */
async function dispatchCall3AndFinalize(args: {
  form: FormArtifact
  dispatchLogKey: string
  beadId: string
  env: FormulaCompilerEnv
  deps: FormulaCompilerDeps
  labelsSent?: string[]
  /**
   * AC-17 (MUST-2): the canonical idempotency key for this dispatch and
   * the factory_attempt counter. Used by the 409 handler to look up a
   * prior dispatched row by (idempotency_key, factory_attempt) and
   * confirm the workflow_id returned by Gas City matches what's on disk.
   */
  idempotencyKey: string
  factoryAttempt: number
}): Promise<FormulaCompilerResult> {
  const { form, dispatchLogKey, beadId, env, deps } = args
  const slingBody = {
    formula: form.template_name,
    attached_bead_id: beadId,
    bead: "",
    target: env.GAS_CITY_AGENT_NAME,
    rig: env.GAS_CITY_RIG,
    scope_kind: "rig",
    scope_ref: env.GAS_CITY_RIG,
    force: false,
    vars: form.vars,
  }
  const slingRequestHash = await sha256Hex(stableStringify(slingBody))

  let lastErr: string | null = null
  const maxAttempts = 1 + CALL_3_RETRY_BACKOFF_MS.length
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const backoff = CALL_3_RETRY_BACKOFF_MS[attempt - 1]
      if (backoff !== undefined) await deps.sleep(backoff)
    }
    let res: Response | null = null
    try {
      res = await deps.httpFetch(gasCityUrl(env, "/sling"), {
        method: "POST",
        headers: {
          ...gasCityAuthHeaders(env),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(slingBody),
        signal: AbortSignal.timeout(PER_CALL_TIMEOUT_MS),
      })
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err)
      continue
    }
    const status = res.status
    if (status === 200) {
      const parsed = (await res.json().catch(() => null)) as {
        status?: string
        workflow_id?: string
        root_bead_id?: string
      } | null
      if (!parsed || parsed.status !== "slung" || !parsed.workflow_id) {
        await deps.updateDispatchLog(dispatchLogKey, {
          outcome: "failed",
          error: `CALL 3 200 with invalid body: ${JSON.stringify(parsed)}`,
          completed_at: deps.now(),
        })
        return { outcome: "failed", form_id: form._key, dispatch_log_key: dispatchLogKey }
      }
      const workflowId = parsed.workflow_id
      const rootBeadId = parsed.root_bead_id ?? beadId
      await safeUpdateDispatchLog(deps, dispatchLogKey, {
        outcome: "dispatched",
        gc_bead_id: beadId,
        gc_workflow_id: workflowId,
        gc_workflow_root_bead_id: rootBeadId,
        labels_sent: args.labelsSent ?? null,
        sling_request_hash: slingRequestHash,
        completed_at: deps.now(),
      })
      return {
        outcome: "dispatched",
        form_id: form._key,
        dispatch_log_key: dispatchLogKey,
        gc_bead_id: beadId,
        gc_workflow_id: workflowId,
        gc_workflow_root_bead_id: rootBeadId,
      }
    }
    if (status === 409) {
      // AC-17 (MUST-2): success-on-replay iff the response carries a
      // workflow_id AND a prior dispatched dispatch_log row exists for
      // this (idempotency_key, factory_attempt) whose gc_workflow_id
      // matches and whose outcome is "dispatched". A 409 without a
      // matching prior is a hard rejection — Gas City is telling us this
      // formula was already run, but we have no record, so we MUST NOT
      // claim dispatched without evidence.
      const parsed = (await res.json().catch(() => null)) as { workflow_id?: string } | null
      const respWf = parsed?.workflow_id
      if (respWf) {
        const priorRow = await deps.getDispatchLogByIdempotencyKey(
          args.idempotencyKey,
          args.factoryAttempt,
          dispatchLogKey,
        )
        if (
          priorRow?.gc_workflow_id === respWf &&
          priorRow.outcome === "dispatched"
        ) {
          const priorRootBead = priorRow.gc_workflow_root_bead_id ?? beadId
          await safeUpdateDispatchLog(deps, dispatchLogKey, {
            outcome: "dispatched",
            gc_bead_id: beadId,
            gc_workflow_id: respWf,
            gc_workflow_root_bead_id: priorRootBead,
            labels_sent: args.labelsSent ?? null,
            sling_request_hash: slingRequestHash,
            completed_at: deps.now(),
          })
          return {
            outcome: "dispatched",
            form_id: form._key,
            dispatch_log_key: dispatchLogKey,
            gc_bead_id: beadId,
            gc_workflow_id: respWf,
            gc_workflow_root_bead_id: priorRootBead,
          }
        }
      }
      await safeUpdateDispatchLog(deps, dispatchLogKey, {
        outcome: "rejected",
        error: respWf
          ? `CALL 3 409 workflow_id ${respWf} without matching prior dispatch_log`
          : "CALL 3 409 without workflow_id",
        completed_at: deps.now(),
      })
      return {
        outcome: "rejected",
        form_id: form._key,
        dispatch_log_key: dispatchLogKey,
      }
    }
    if (status >= 400 && status < 500) {
      const txt = await res.text().catch(() => "")
      await safeUpdateDispatchLog(deps, dispatchLogKey, {
        outcome: "rejected",
        error: `CALL 3 HTTP ${status}: ${txt}`,
        completed_at: deps.now(),
      })
      return {
        outcome: "rejected",
        form_id: form._key,
        dispatch_log_key: dispatchLogKey,
      }
    }
    if (status >= 500) {
      lastErr = `CALL 3 HTTP ${status}`
      continue
    }
    await safeUpdateDispatchLog(deps, dispatchLogKey, {
      outcome: "failed",
      error: `CALL 3 unexpected HTTP ${status}`,
      completed_at: deps.now(),
    })
    return { outcome: "failed", form_id: form._key, dispatch_log_key: dispatchLogKey }
  }

  await safeUpdateDispatchLog(deps, dispatchLogKey, {
    outcome: "timeout_call_3",
    error: lastErr ?? "CALL 3 timeout",
    completed_at: deps.now(),
  })
  const timeoutResult: FormulaCompilerResult = {
    outcome: "timeout_call_3",
    form_id: form._key,
    dispatch_log_key: dispatchLogKey,
  }
  if (lastErr) timeoutResult.error = lastErr
  return timeoutResult
}

/**
 * AC-9b: dispatch_log update failure after CALL 3 success is logged at
 * `[DISPATCH_LOG_UPDATE_FAILED]` severity and swallowed so we still return
 * the dispatched outcome to the caller (Gas City is running; an
 * out-of-band sweeper reconciles).
 */
async function safeUpdateDispatchLog(
  deps: FormulaCompilerDeps,
  key: string,
  patch: Partial<DispatchLogRow>,
): Promise<void> {
  try {
    await deps.updateDispatchLog(key, patch)
  } catch (err) {
    // Best we can do from inside a Worker — caller's structured logger
    // picks this up via the console binding.
    console.warn(
      `[DISPATCH_LOG_UPDATE_FAILED] key=${key} outcome=${String(patch.outcome)} err=${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function gasCityUrl(env: FormulaCompilerEnv, suffix: string): string {
  // Suffix examples: `/formulas/factory-coding-v1`, `/beads`, `/sling`.
  const norm = suffix.startsWith("/") ? suffix : `/${suffix}`
  return `https://gas-city.local/v0/city/${env.GAS_CITY_CITY_NAME}${norm}`
}

function gasCityAuthHeaders(env: FormulaCompilerEnv): Record<string, string> {
  return { Authorization: `Bearer ${env.GAS_CITY_BEARER_TOKEN}` }
}

function formulaVersionEnvName(templateName: string): string {
  return `GAS_CITY_FORMULA_VERSION_${templateName.toUpperCase().replace(/-/g, "_")}`
}

/**
 * AC-6 key derivation:
 *   `"FORM-" + sha256(ep_id + "|" + factory_attempt).substring(0,16).toUpperCase()`
 */
async function deriveFormKey(epId: string, factoryAttempt: number): Promise<string> {
  const hex = await sha256Hex(`${epId}|${factoryAttempt}`)
  return `FORM-${hex.substring(0, 16).toUpperCase()}`
}

/**
 * Web Crypto SHA-256 → lowercase hex. Works in CF Workers and in Node 18+
 * test environments (globalThis.crypto.subtle).
 */
async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  const arr = new Uint8Array(digest)
  let hex = ""
  for (let i = 0; i < arr.length; i++) {
    const b = arr[i]!
    hex += b.toString(16).padStart(2, "0")
  }
  return hex
}

/**
 * Deterministic JSON.stringify. Sorts object keys alphabetically (top-
 * level only — values that are themselves objects are recursed). Arrays
 * preserve their order. NaN / Infinity → throw (we never want those in
 * compiled output).
 */
function stableStringify(value: unknown): string {
  if (value === null) return "null"
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`stableStringify: non-finite number ${value}`)
    }
    return JSON.stringify(value)
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    const parts: string[] = []
    for (const k of keys) {
      parts.push(`${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    }
    return `{${parts.join(",")}}`
  }
  // undefined / function / symbol — should never appear in EP parameters.
  throw new Error(`stableStringify: unsupported value type ${typeof value}`)
}

/**
 * Merge reserved + role var maps into a key-sorted object. Sorting keys
 * here is load-bearing for sling_request_hash determinism: the CALL 3
 * sling body includes `vars: form.vars`, and `sling_request_hash` is
 * computed over `stableStringify(slingBody)`. While `stableStringify`
 * recursively sorts object keys (so the hash would be stable regardless
 * of insertion order), the FORM-* `vars` field is also written to
 * ArangoDB and read back by other consumers via `JSON.stringify(vars)`
 * (which honors insertion order on modern V8). Sorting keys here ensures
 * BOTH the on-disk `JSON.stringify(vars)` and the hashed
 * `stableStringify(slingBody)` are byte-identical across runs.
 * The `parameters_json` blob is also deterministic — it goes through
 * `stableStringify` separately.
 */
function mergeSortedVars(
  reserved: Record<string, string>,
  roles: Record<string, string>,
): Record<string, string> {
  const merged: Record<string, string> = { ...reserved, ...roles }
  const sortedKeys = Object.keys(merged).sort()
  const out: Record<string, string> = {}
  for (const k of sortedKeys) {
    out[k] = merged[k]!
  }
  return out
}

/**
 * Per-call timeout policy (AC §Platform constraints): every CALL 1/2/3
 * fetch passes `signal: AbortSignal.timeout(PER_CALL_TIMEOUT_MS)` directly
 * in its init. `AbortSignal.timeout` is the CF-native mechanism — it
 * aborts BOTH the headers-receipt promise AND the subsequent body read.
 * A previous implementation used `Promise.race` on the fetch promise
 * (which resolves when headers arrive), which left `res.json()` un-
 * bounded and could hang the worker. The signal-based approach keeps
 * the dispatch inside the 30s CF subrequest limit even on slow body
 * streams.
 */
