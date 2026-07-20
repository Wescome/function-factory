/**
 * effect/errors.ts — OD-EFFECT-6: the terminal-vs-amendable error taxonomy
 * decide() needs to distinguish "worth another attempt" from "no attempt
 * would help." Pure, substrate-free.
 */

export type ErrorClass =
  | "InvalidResponse"
  | "Conflict"
  | "RateLimited"
  | "PermissionDenied"
  | "OperationUnsupported"
  | "AuthenticationFailed";

/** Identity/authorization/capability failures — no retry or amendment fixes
 *  these, so they end the run rather than spend attempt budget on them. */
const TERMINAL: ReadonlySet<ErrorClass> = new Set<ErrorClass>([
  "PermissionDenied",
  "OperationUnsupported",
  "AuthenticationFailed",
]);

/** {InvalidResponse, Conflict, RateLimited} are amend-worthy (a materially
 *  different attempt, or a later retry, can succeed); the TERMINAL set cannot
 *  be fixed by trying again and should ESCALATE immediately. */
export function classifyTerminal(e: ErrorClass): boolean {
  return TERMINAL.has(e);
}
