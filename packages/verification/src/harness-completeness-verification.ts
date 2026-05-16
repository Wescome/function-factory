/**
 * Harness Completeness Verification — Factory governance pass that runs after
 * NLAH's `compileHarness` and before `initHarness`. It enforces the Factory's
 * additional constraints on top of NLAH's compiler assertions:
 *
 *   1. `failure_taxonomy` is present and non-empty                  → EMPTY_FAILURE_TAXONOMY
 *   2. Every stage is reachable from the harness `startState`        → UNREACHABLE_STAGE
 *   3. Every gate referenced by the harness exists in the supplied
 *      `gateRegistry` parameter (THROWS by surfacing a hard failure;
 *      no silent skip)                                                → UNREGISTERED_GATE
 *   4. Every stage `worker` (if declared) is provided by the supplied
 *      `workerNames` set (optional second-stage check used by the
 *      bridge to validate Container bindings at startHarnessRun time) → MISSING_WORKER_BINDING
 *   5. `lineage.source_refs` is non-empty on nlahspec 0.2 harnesses
 *      (warning-only on nlahspec 0.1, until NLAH contribution #4
 *      lands and the Zod schema preserves the `lineage` key)         → MISSING_LINEAGE
 *
 * Specification: IS-HARNESS-DSL-v1 §6 and ADR-009 Phase 4.
 *
 * Pure function. No side effects. No I/O. The caller (typically
 * `startHarnessRun` inside a Workflow `step.do()`) is responsible for
 * surfacing the failure code to the Workflow.
 */

import type { CompiledHarness, GateFn } from "@factory/nlah"

export type HarnessCompletenessFailureCode =
  | "EMPTY_FAILURE_TAXONOMY"
  | "UNREACHABLE_STAGE"
  | "UNREGISTERED_GATE"
  | "MISSING_WORKER_BINDING"
  | "MISSING_LINEAGE"

export interface HarnessCompletenessCheck {
  name: string
  passed: boolean
  detail?: string
}

export interface HarnessCompletenessReport {
  overall: "pass" | "fail"
  failure_code?: HarnessCompletenessFailureCode
  details: string[]
  checks: HarnessCompletenessCheck[]
}

export interface HarnessCompletenessOptions {
  /**
   * Optional set/array of worker names that the deployed registry can
   * dispatch. When provided, every stage `worker:` field is validated
   * against this set. When omitted, the worker check is skipped (the
   * bridge usually supplies this once `buildCfWorkerRegistry` has run).
   */
  workerNames?: Iterable<string>
}

/**
 * Run the Factory-side harness completeness gate.
 *
 * @param compiled       A CompiledHarness produced by NLAH's compileHarness.
 * @param gateRegistry   The gate registry (Record<string, GateFn> as exported
 *                       from @factory/nlah, OR a Map<string, GateFn> for callers
 *                       that prefer Map semantics — both accepted).
 * @param options        Optional second-stage checks (worker binding set).
 */
export async function runHarnessCompletenessVerification(
  compiled: CompiledHarness,
  gateRegistry: Record<string, GateFn> | Map<string, GateFn>,
  options: HarnessCompletenessOptions = {},
): Promise<HarnessCompletenessReport> {
  const checks: HarnessCompletenessCheck[] = []
  const details: string[] = []

  const hasGate = (name: string): boolean =>
    gateRegistry instanceof Map
      ? gateRegistry.has(name)
      : Object.prototype.hasOwnProperty.call(gateRegistry, name)

  // ── nlahspec version compatibility (L-2) ──────────────────────────────────
  const nlahspec = compiled.spec.nlahspec
  if (nlahspec !== "0.1" && nlahspec !== "0.2") {
    return fail(
      checks,
      "EMPTY_FAILURE_TAXONOMY",
      [`unsupported nlahspec: ${String(nlahspec)}`],
      {
        name: "nlahspec-version",
        passed: false,
        detail: `unsupported nlahspec: ${String(nlahspec)}`,
      },
    )
  }
  checks.push({ name: "nlahspec-version", passed: true, detail: `nlahspec ${nlahspec}` })

  // ── INV-3 — failure_taxonomy present and non-empty ────────────────────────
  const taxonomy = compiled.spec.failure_taxonomy
  if (!taxonomy || Object.keys(taxonomy).length === 0) {
    return fail(
      checks,
      "EMPTY_FAILURE_TAXONOMY",
      ["failure_taxonomy is absent or empty"],
      {
        name: "failure-taxonomy-present",
        passed: false,
        detail: "failure_taxonomy is absent or empty",
      },
    )
  }
  checks.push({
    name: "failure-taxonomy-present",
    passed: true,
    detail: `failure_taxonomy declares ${Object.keys(taxonomy).length} classes`,
  })

  // ── Stage reachability — every stage appears in stageOrder ────────────────
  // NLAH's compiler already topologically sorts; any stage missing from
  // stageOrder is structurally unreachable from startState.
  const reachable = new Set(compiled.stageOrder)
  const declaredStages = Object.keys(compiled.spec.stages)
  const unreachable = declaredStages.filter((name) => !reachable.has(name))
  if (unreachable.length > 0) {
    return fail(
      checks,
      "UNREACHABLE_STAGE",
      unreachable.map((name) => `stage ${name} is not reachable from startState ${compiled.startState}`),
      {
        name: "stage-reachability",
        passed: false,
        detail: `${unreachable.length} unreachable stage(s): ${unreachable.join(", ")}`,
      },
    )
  }
  checks.push({
    name: "stage-reachability",
    passed: true,
    detail: `${declaredStages.length} stages reachable from ${compiled.startState}`,
  })

  // ── Every gate name exists in the supplied registry ───────────────────────
  // Iterates stage gate.all and gate.any. Supports the three NLAH gate-
  // expression forms: bare string, single-key object, and explicit
  // GateContract with `uses`.
  for (const [stageName, stage] of Object.entries(compiled.spec.stages)) {
    const all = stage.gate?.all ?? []
    const any = stage.gate?.any ?? []
    const expressions: unknown[] = [...all, ...any]
    for (const expr of expressions) {
      const gateName = extractGateName(expr)
      if (!gateName) {
        return fail(
          checks,
          "UNREGISTERED_GATE",
          [`stage ${stageName}: unrecognized gate expression shape`],
          {
            name: "gate-registration",
            passed: false,
            detail: `stage ${stageName}: gate expression has no resolvable name`,
          },
        )
      }
      if (!hasGate(gateName)) {
        return fail(
          checks,
          "UNREGISTERED_GATE",
          [`${stageName}: gate "${gateName}" not registered in supplied gateRegistry`],
          {
            name: "gate-registration",
            passed: false,
            detail: `stage ${stageName}: gate ${gateName} not registered`,
          },
        )
      }
    }
  }
  checks.push({ name: "gate-registration", passed: true })

  // ── Worker bindings declared (F13) ────────────────────────────────────────
  // Optional — only enforced when the caller supplies `workerNames`.
  if (options.workerNames) {
    const workerSet =
      options.workerNames instanceof Set
        ? options.workerNames
        : new Set(options.workerNames)
    for (const [stageName, stage] of Object.entries(compiled.spec.stages)) {
      if (stage.worker && !workerSet.has(stage.worker)) {
        return fail(
          checks,
          "MISSING_WORKER_BINDING",
          [`stage ${stageName}: worker "${stage.worker}" is not registered`],
          {
            name: "worker-bindings",
            passed: false,
            detail: `stage ${stageName}: missing worker ${stage.worker}`,
          },
        )
      }
    }
    checks.push({ name: "worker-bindings", passed: true })
  }

  // ── Lineage check (INV-4) ─────────────────────────────────────────────────
  // NLAH's HarnessSpecSchema is default-strip until contribution #4 lands;
  // therefore on nlahspec 0.1 a missing `lineage` is non-blocking. On 0.2
  // (after #4), it is blocking.
  const lineage = (compiled.spec as unknown as {
    lineage?: { source_refs?: string[] }
  }).lineage
  const hasLineage = Boolean(lineage?.source_refs?.length)
  if (!hasLineage) {
    if (nlahspec === "0.2") {
      return fail(
        checks,
        "MISSING_LINEAGE",
        ["lineage.source_refs absent or empty (required on nlahspec 0.2)"],
        {
          name: "lineage-present",
          passed: false,
          detail: "lineage.source_refs absent or empty",
        },
      )
    }
    // 0.1 path: warn but do not fail.
    details.push(
      "lineage.source_refs absent — non-blocking until contribution #4 lands (nlahspec 0.1)",
    )
    checks.push({
      name: "lineage-present",
      passed: true,
      detail: "warning: lineage absent (nlahspec 0.1, non-blocking)",
    })
  } else {
    checks.push({
      name: "lineage-present",
      passed: true,
      detail: `${lineage!.source_refs!.length} source_refs declared`,
    })
  }

  return { overall: "pass", details, checks }
}

/**
 * Resolve the gate name out of a NLAH gate expression. Supports the three
 * accepted forms from `parseGateExpression`:
 *
 *   - bare string:                  `"exists"`
 *   - single-key object:            `{ exists: "FinalPatch" }`
 *   - explicit GateContract:        `{ id: ..., uses: "exists", ... }`
 *
 * Returns null when the expression shape is unrecognized.
 */
function extractGateName(expr: unknown): string | null {
  if (typeof expr === "string") {
    return expr
  }
  if (expr && typeof expr === "object" && !Array.isArray(expr)) {
    const obj = expr as Record<string, unknown>
    if (typeof obj["uses"] === "string") {
      return obj["uses"]
    }
    const keys = Object.keys(obj)
    if (keys.length === 1 && typeof keys[0] === "string") {
      return keys[0]
    }
  }
  return null
}

function fail(
  prior: HarnessCompletenessCheck[],
  code: HarnessCompletenessFailureCode,
  details: string[],
  failed: HarnessCompletenessCheck,
): HarnessCompletenessReport {
  return {
    overall: "fail",
    failure_code: code,
    details,
    checks: [...prior, failed],
  }
}
