/**
 * @factory/coverage-gates
 *
 * Fail-closed coverage evaluators for the Factory pipeline. Currently
 * exposes Gate 1 (Compile Coverage Gate); Gate 2 and Gate 3 land in
 * subsequent PRs.
 *
 * Per whitepaper §6 and ConOps §3.4, gate evaluators are deterministic
 * pure functions over Zod-validated inputs. The `runGate1` orchestrator
 * is pure. File emission is the one permitted side effect, exposed
 * separately as `emitGate1Report` so callers can compose them as their
 * execution model requires (the compiler in Pass 7 composes both; an
 * audit tool inspecting intermediates might run only runGate1).
 */

export { runGate1 } from "./gate-1.js"
export type { Gate1Input } from "./gate-1.js"
export { emitGate1Report } from "./emit.js"
