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
  runGate1Pass,
  determineMode,
  type Gate1PassResult,
} from "./07-gate-1.js"
export { assembleWorkgraph } from "./08-assemble-workgraph.js"
export { emitWorkgraph } from "./_workgraph-emit.js"
