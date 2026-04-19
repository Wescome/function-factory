/**
 * Shared compiler types.
 *
 * Each compiler pass is a pure function with explicit input and output
 * types. This module declares the types used at pass boundaries. Every
 * pass output that represents a Factory artifact is typed to the
 * corresponding Zod-inferred type from `@factory/schemas` so the Zod
 * schemas remain the single source of truth and Pass 7 (Gate 1) can
 * consume them directly.
 */

import type {
  ArtifactId,
  Contract,
  Dependency,
  FactoryMode,
  Gate1Report,
  Invariant,
  PRDDraft,
  RequirementAtom,
  ValidationSpec,
} from "@factory/schemas"

/**
 * Factory mode. Canonical definition in @factory/schemas; re-exported
 * here so compiler-local callers can continue to import it from this
 * module without reaching into schemas directly.
 */
export type { FactoryMode }

/**
 * Output of Pass 0 (normalize). Contains the parsed PRDDraft plus a
 * map of section name to raw markdown content and a record of any
 * unrecognized sections the compiler chose not to map to PRDDraft fields.
 *
 * Unrecognized sections do not block compilation; they are logged so a
 * future pass (or a human reader) can decide what to do with them. In
 * a production compiler this would emit UncertaintyEntry; the MVP
 * keeps it as a plain list on the NormalizedPRD.
 */
export interface NormalizedPRD {
  readonly draft: PRDDraft
  readonly sections: Readonly<Record<string, string>>
  readonly unrecognizedSections: readonly string[]
  readonly sourceFile: string
}

/**
 * The aggregated output of all passes. Pass 7 (Gate 1) consumes
 * this bundle via its `prdId` and the five artifact arrays.
 */
export interface CompilerIntermediates {
  readonly prd: PRDDraft
  readonly atoms: readonly RequirementAtom[]
  readonly contracts: readonly Contract[]
  readonly invariants: readonly Invariant[]
  readonly dependencies: readonly Dependency[]
  readonly validations: readonly ValidationSpec[]
}

/**
 * Output of the end-to-end compile orchestrator. The Gate1Report is
 * the bootstrap proof; the intermediates are preserved so callers
 * can inspect Passes 1–5 for debugging.
 */
export interface CompileResult {
  readonly report: Gate1Report
  readonly reportPath: string
  readonly intermediates: CompilerIntermediates
  readonly mode: FactoryMode
}

/**
 * Re-export the ArtifactId type so pass modules have a single import
 * surface for compiler-type concerns.
 */
export type { ArtifactId }
