/**
 * @factory/compiler
 *
 * Intent-to-Executable compiler- transforms IntentSpecification into a Coherence
 * Verification Verification Report and ExecutableSpecification. Historical pass numbers remain
 * compatibility labels; ontology terms are primary. Current ExecutableSpecification assembly
 * is Structural Assembly completion, not future Instruction Tuning.
 */

export { compile } from "./compile.js"
export { tuneInstructions } from "./instruction-tuning.js"
export type { CompileOptions } from "./compile.js"
export type {
  InstructionTuningCompileOptions,
  InstructionTuningInput,
} from "./instruction-tuning.js"
export type {
  CompileResult,
  CompilerIntermediates,
  FactoryMode,
  NormalizedIntentSpecification,
} from "./types.js"
