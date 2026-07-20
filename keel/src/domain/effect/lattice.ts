/**
 * effect/lattice.ts — the per-method effect-class order, and the ⊑ check
 * that extends the 6a freeze gate's attenuates(). Pure, substrate-free.
 *
 * pure ⊑ read ⊑ write-idempotent ⊑ write-effectful. A derived spec (or a
 * connector's declared reach) may only narrow down this order, never widen —
 * the same attenuation principle `attenuates()` already enforces for
 * connectors/ungated-reach, one level out (per-method effect, not just
 * per-connector membership).
 */
export type EffectClass = "pure" | "read" | "write-idempotent" | "write-effectful";

const ORDER: Readonly<Record<EffectClass, number>> = {
  pure: 0,
  read: 1,
  "write-idempotent": 2,
  "write-effectful": 3,
};

/** child ⊑ parent — child's effect class is no more permissive than parent's. */
export function effectAttenuates(child: EffectClass, parent: EffectClass): boolean {
  return ORDER[child] <= ORDER[parent];
}
