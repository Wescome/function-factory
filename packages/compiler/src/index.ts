/**
 * @factory/compiler
 *
 * Intent-to-Executable compiler- transforms IntentSpecification into a Coherence
 * Verification Coverage Report and ExecutableSpecification. Historical pass numbers remain
 * compatibility labels; ontology terms are primary. Current ExecutableSpecification assembly
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
