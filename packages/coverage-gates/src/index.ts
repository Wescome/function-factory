/**
 * @factory/coverage-gates
 *
 * Fail-closed verification evaluators for the Factory pipeline. Currently
 * exposes Coherence Verification; Fidelity Verification and Persistence
 * Verification land in subsequent PRs.
 *
 * Per whitepaper §6 and ConOps §3.4, verification evaluators are deterministic
 * pure functions over Zod-validated inputs. The `runGate1` orchestrator
 * remains as a legacy compatibility alias. File emission is the one permitted side effect, exposed
 * separately as `emitGate1Report` so callers can compose them as their
 * execution model requires (the compiler in Pass 7 composes both; an
 * audit tool inspecting intermediates might run only runCoherenceVerification).
 */

export { runCoherenceVerification, runGate1 } from "./gate-1.js"
export type {
  CoherenceVerificationInput,
  CoherenceVerificationReport,
  Gate1Input,
} from "./gate-1.js"
export { emitCoherenceVerificationReport, emitGate1Report } from "./emit.js"
