/**
 * @factory/compiler
 *
 * Intent-to-Executable compiler- transforms PRDDraft into a Coherence
 * Verification Coverage Report and WorkGraph. Historical pass numbers remain
 * compatibility labels; ontology terms are primary. Current WorkGraph assembly
 * is Structural Assembly completion, not future Instruction Tuning.
 */

export { compile } from "./compile.js"
export type { CompileOptions } from "./compile.js"
export type {
  CompileResult,
  CompilerIntermediates,
  FactoryMode,
  NormalizedPRD,
} from "./types.js"
