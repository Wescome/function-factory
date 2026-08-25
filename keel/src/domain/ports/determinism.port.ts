/**
 * determinism.port.ts — ClockPort / EntropyPort (driven).
 *
 * D9: there is NO orchestrator-level determinism-capture primitive on the
 * fiber. Determinism inside a code action is codemode.step()'s job (in the
 * sandbox). These ports isolate the two sources of orchestrator-level
 * non-determinism so that IF replay-safe orchestrator time/entropy is ever
 * needed, it flows through here and can be made lint-blocking.
 *
 * v1 SCOPE: orchestrator-level non-determinism that must survive replay is out
 * of scope. These interfaces are frozen (named, shape-fixed) but the executor
 * contract for v1 requires non-deterministic work live inside the code action,
 * wrapped in codemode.step() — not in domain transition code.
 */
export interface ClockPort {
  now(): number;
}
export interface EntropyPort {
  random(): number;
}
