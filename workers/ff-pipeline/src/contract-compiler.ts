/**
 * contract-compiler.ts — project NLAH `ArtifactSpec.contract` (snake_case
 * discriminated union) into the Container-side `OutputContract` wire shape
 * (camelCase, see ../pi-container/contract-types.mjs).
 *
 * Called from the harness-dispatcher Worker before posting each stage to its
 * Container — the projection happens in the Worker so the Container never has
 * to understand NLAH schema details. Every stage's declared outputs become an
 * `OutputContract`; outputs without a `contract:` block in the YAML fall back
 * to `{ kind: "text", nonEmpty: true }`, matching the evaluator's
 * `defaultContract()`.
 *
 * The `exact_line` kind is Factory-specific (not in NLAH's discriminated
 * union, see /Users/wes/nlah/src/schema.ts ArtifactContractSchema). The
 * compiler therefore never emits it from a NLAH-sourced contract today; the
 * type stays in the union so smoke harnesses and the pi-side
 * pre-materialize shortcut can use it through the default-projection path
 * once the upstream schema is amended.
 *
 * Spec: General Artifact Contract Execution milestone, Step 4.
 */

import type { CompiledHarness, StageSpec } from "@factory/nlah"

export type ContractKind = "exact_line" | "json" | "markdown" | "text"

export type ContractBody =
  | { kind: "exact_line"; line: string }
  | { kind: "json"; requiredFields?: string[] }
  | { kind: "markdown"; requiredSections?: string[]; requiredPatterns?: string[] }
  | { kind: "text"; nonEmpty?: boolean; requiredPatterns?: string[] }

export interface OutputContract {
  artifact: string
  required: boolean
  body: ContractBody
}

/**
 * Project every declared output of `stage` into an `OutputContract` ready
 * for the Container wire body. Lookups go through `compiled.spec.artifacts`
 * — the compiler validates artifact references upstream, but we still
 * throw a clear error here if a stage declares an output the spec does not
 * register so the failure surfaces at dispatch time rather than as a
 * cryptic Container-side miss.
 *
 * Snake_case → camelCase mapping (mirrors what the evaluator consumes):
 *   - `required_fields`   → `requiredFields`
 *   - `required_sections` → `requiredSections`
 *   - `required_patterns` → `requiredPatterns`
 *   - `non_empty`         → `nonEmpty`
 */
export function compileOutputContracts(
  stage: StageSpec,
  compiled: CompiledHarness,
): OutputContract[] {
  const out: OutputContract[] = []
  for (const name of stage.outputs) {
    const spec = compiled.spec.artifacts[name]
    if (!spec) {
      throw new Error(
        `contract-compiler: stage declares output "${name}" but no artifact spec is registered for it`,
      )
    }
    const required = spec.required !== false
    if (!spec.contract) {
      // Default contract mirrors pi-container/contract-evaluator.mjs
      // `defaultContract()` — permissive non-empty text.
      out.push({ artifact: name, required, body: { kind: "text", nonEmpty: true } })
      continue
    }
    out.push({ artifact: name, required, body: projectContractBody(spec.contract) })
  }
  return out
}

/**
 * Convert a NLAH `ArtifactContract` (discriminated union, snake_case) into
 * the Container-side `ContractBody` (camelCase).
 *
 * `exact_line` is not part of the upstream NLAH discriminator today, so a
 * defensive cast handles a future amendment without forcing a no-op cast
 * here. The Factory's own harnesses that need `exact_line` go through the
 * default-projection path and supply the body directly via test fixtures.
 */
function projectContractBody(
  contract: NonNullable<CompiledHarness["spec"]["artifacts"][string]["contract"]>,
): ContractBody {
  switch (contract.kind) {
    case "markdown":
      return {
        kind: "markdown",
        ...(contract.required_sections ? { requiredSections: contract.required_sections } : {}),
        ...(contract.required_patterns ? { requiredPatterns: contract.required_patterns } : {}),
      }
    case "json":
      return {
        kind: "json",
        ...(contract.required_fields ? { requiredFields: contract.required_fields } : {}),
      }
    case "text":
      return {
        kind: "text",
        ...(contract.non_empty !== undefined ? { nonEmpty: contract.non_empty } : {}),
        ...(contract.required_patterns ? { requiredPatterns: contract.required_patterns } : {}),
      }
    default: {
      // exact_line is Factory-specific and not in the NLAH schema today —
      // cast through unknown so a future schema amendment surfaces here.
      const maybeExactLine = contract as unknown as { kind: string; line?: string }
      if (maybeExactLine.kind === "exact_line" && typeof maybeExactLine.line === "string") {
        return { kind: "exact_line", line: maybeExactLine.line }
      }
      throw new Error(
        `contract-compiler: unsupported ArtifactContract kind: ${String((contract as { kind?: unknown }).kind)}`,
      )
    }
  }
}
