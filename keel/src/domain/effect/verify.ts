/**
 * effect/verify.ts — INV-EFFECT-ANCHORED: check a declared EffectSignature
 * against what a RECORDED ConnectorCall actually did, never the model's
 * assertion. A structural check on the trace — not a new oracle; the
 * acceptance-criteria oracle still owns correctness, this owns "did the
 * signature's contract hold at all."
 */
import type { EffectSignature } from "./signature";
import type { ConnectorCall } from "../lineage/nodes";
import { projectResponse, hasDivergence } from "../foreign/policy";
import { projectArgs } from "./project-args";

export interface EffectVerdict { readonly ok: boolean; readonly reasons: readonly string[]; }

export function verifyEffect(signature: EffectSignature, call: ConnectorCall): EffectVerdict {
  const reasons: string[] = [];

  const argProj = projectArgs(signature.argSchema, call.args);
  if (argProj.dropped.length) {
    reasons.push(`args diverge from argSchema: ${argProj.dropped.join(", ")}`);
  }

  if (call.response !== undefined) {
    const respProj = projectResponse(call.response, signature.response);
    if (hasDivergence(signature.response, respProj)) {
      reasons.push(`response diverges from declared schema`);
    }
  }

  // A read/pure signature declares no writes at all — a write appearing in a
  // call whose signature says read/pure fails structurally, not just by
  // schema mismatch (the class of the violation the anchor law exists for).
  if ((signature.effectClass === "read" || signature.effectClass === "pure") && signature.writes.length > 0) {
    reasons.push(`signature declares writes but effectClass is "${signature.effectClass}"`);
  }

  return { ok: reasons.length === 0, reasons };
}
