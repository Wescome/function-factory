/**
 * @factory/coverage-gates
 *
 * Fail-closed verification evaluators for the Factory pipeline. Currently
 * exposes Coherence Verification; Fidelity Verification and Persistence
 * Verification land in subsequent PRs.
 *
 * Per whitepaper §6 and ConOps §3.4, verification evaluators are deterministic
 * pure functions over Zod-validated inputs. File emission is the one permitted
 * side effect, exposed separately so callers can compose it as their execution
 * model requires.
 */

export { runCoherenceVerification } from "./coherence-verification.js"
export type {
  CoherenceVerificationInput,
  CoherenceVerificationReport,
} from "./coherence-verification.js"
export { emitCoherenceVerificationReport } from "./emit.js"
