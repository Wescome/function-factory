/**
 * PLAYBOOK-KEEL-SCR-PORT-1, Track 4: shared harness for porting SCR's own
 * test suites (invariants/seal/transform/dag/property) onto the DO
 * substrate. `runInDurableObject` (cloudflare:test) runs the callback
 * INSIDE the same execution context as the real DO -- `ReviewService` +
 * `DoReviewLog` are constructed together there, never crossing an RPC
 * boundary (see review-core.ts's own doc for why that matters).
 */
import { expect } from "vitest";
import { env, runInDurableObject } from "cloudflare:test";
import { DoReviewLog } from "../src/adapters/persistence/scr-review-log-do.adapter";
import { InvariantViolation, type Hunk } from "../src/scr/events";

let counter = 0;

/** Run `fn` inside a FRESH DO instance's own execution context, with a
 *  ready-made `DoReviewLog` over that instance's real storage. Each call
 *  gets its own DO (a fresh, unique name) -- SCR's own tests each build
 *  their own fresh `InMemoryEventLog()`, and this mirrors that isolation. */
export function withLog<T>(fn: (log: DoReviewLog) => T | Promise<T>): Promise<T> {
  const ns = (env as { REVIEW_CORE: DurableObjectNamespace }).REVIEW_CORE;
  const stub = ns.get(ns.idFromName(`scr-port1-${++counter}-${Math.random().toString(36).slice(2)}`));
  return runInDurableObject(stub, (_instance, state) => fn(new DoReviewLog(state.storage)));
}

export const h = (path: string, anchor: string, content: string): Hunk => ({ path, anchor, content });

/** `assert.throws(fn, (e) => e.invariant === 'X')`'s vitest equivalent. */
export function expectInvariant(fn: () => unknown, invariant: string): void {
  let threw: unknown;
  try {
    fn();
  } catch (e) {
    threw = e;
  }
  expect(threw).toBeInstanceOf(InvariantViolation);
  expect((threw as InvariantViolation).invariant).toBe(invariant);
}

export async function expectInvariantAsync(fn: () => unknown, invariant: string): Promise<void> {
  let threw: unknown;
  try {
    await fn();
  } catch (e) {
    threw = e;
  }
  expect(threw).toBeInstanceOf(InvariantViolation);
  expect((threw as InvariantViolation).invariant).toBe(invariant);
}
