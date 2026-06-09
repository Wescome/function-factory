/**
 * Barrel export for compiler passes.
 */

export { normalize } from "./00-normalize.js"
export { extractAtoms } from "./01-extract-atoms.js"
export { deriveContracts } from "./02-derive-contracts.js"
export { deriveInvariants } from "./03-derive-invariants.js"
export { deriveDependencies } from "./04-derive-dependencies.js"
export { deriveValidations } from "./05-derive-validations.js"
export { consistencyCheck } from "./06-consistency-check.js"
export {
  runCoherenceVerificationPass,
  determineMode,
  type CoherenceVerificationPassResult,
} from "./07-coherence-verification.js"
export {
  assembleExecutableSpecification,
} from "./08-assemble-executable-specification.js"
export {
  emitExecutableSpecification,
} from "./_executable-specification-emit.js"
