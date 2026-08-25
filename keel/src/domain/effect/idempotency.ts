/**
 * effect/idempotency.ts — OD-EFFECT-5: mechanism-named so a method's
 * idempotency claim is checkable against the actual replay log, not a vague
 * full|partial|none scale. Pure, substrate-free.
 *
 *  - pure              — no external state; nothing to replay at all.
 *  - idempotent-by-log — codemode's durable log makes replay safe: a logged
 *    call is replayed from the log, never re-executed, on resume (D8).
 *  - idempotent-by-key — safe to re-run because the call carries a
 *    caller-supplied key that makes repeats a no-op (e.g. read-before-write).
 *  - non-idempotent    — unsafe to re-run for real; must D8-gate
 *    (paired with effectClass "write-effectful").
 */
export type IdempotencyClass =
  | "pure"
  | "idempotent-by-log"
  | "idempotent-by-key"
  | "non-idempotent";
