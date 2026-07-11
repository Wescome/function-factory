# KEEL M4 — Lineage + Replay Result (Phase 5)

**Status: G5 = GREEN.** Any run replays from any state, and its decisions replay
deterministically. 20/20 tests pass (12 M1 + 2 M2 + 3 M3 + 3 M4).

```
npm run gate    # lint:deps && typecheck && test
```

## What G5 proves

The append-only lineage (nodes + events in DO SQLite) is now observable through
a QueryPort backed by a pure replay projection (`src/domain/replay/projection.ts`):

- **`timeline()`** — the full recorded state sequence. For a converge run:
  INTENT → GENERATE → EXECUTE → VERIFY → **AMEND** → GENERATE → EXECUTE → VERIFY
  → **ACCEPT**.
- **`replayTo(index)` — replay from ANY state.** Every event index reconstructs a
  valid snapshot: the loop state at that point and the subgraph that existed then
  (non-shrinking as the run progresses). Index 0 sees only the Specification;
  the last index sees the whole Specification→Action→Trace→Verdict chain.
- **`verifyReplay()` — the core proof.** Re-running `decide()` over the recorded
  verdicts reproduces the exact AMEND/ACCEPT/ESCALATE the live loop took. The
  record alone is sufficient to re-derive the control flow — determinism, not
  narration. Green for both the converge run and the paused-then-approved run
  (replay reconstructs correctly across the PAUSE boundary).
- **`crossRun()` — the CQRS read model (D4).** Projects each run into a
  cross-run record (terminal, attempts, node counts). Destined for D1 in
  production; the projection is pure and tested against converge (ACCEPT, ≥2
  attempts, an Amendment) and escalate (ESCALATE, exactly 2 attempts).

## A real bug the replay path caught

Reading nodes back for the cross-run projection threw
`SyntaxError: ...","logs":undefined... is not valid JSON`. Cause: codemode's raw
output (stored in a Verdict's `evidence`) contains `undefined` values, and the
lineage adapter's canonical serializer emitted the literal string `undefined`
(invalid JSON) for them. Fixed: `undefined` now serializes to `null` (round-trips
safely). A write-side latent bug that only the read side exercised — exactly why
M4 is worth doing before v1.

## Structure

- `src/domain/replay/projection.ts` — pure, substrate-free; the whole read side.
- `src/domain/ports/query.port.ts` — the QueryPort named in ARCH-KEEL-000 §15.1,
  deferred at M1, added now. **Additive: no existing frozen shape changed.**
- `src/adapters/persistence/lineage-do.adapter.ts` — gained a `readEvents()`
  read (concrete, not on the frozen write port).
- `src/composition/orchestrator.ts` — realizes QueryPort over the projection.

`grep -r cloudflare src/domain` still empty (now including `replay/`). The
freeze held through a fourth phase: the only frozen-surface delta was ADDING a
previously-named port, never changing one.

## Deferred (unchanged)

- Model scripted, oracle single-criterion, local workerd only.
- `crossRun` projection is computed but not yet emitted to a real D1 index
  across DOs — that's the production wiring; the projection logic is done.
- "Fork replay" (re-executing from a prior state to explore a different
  continuation) is a superset of what G5 needs and is not built; deterministic
  reconstruction + decide()-consistency is the verifiable form of replay.

## Next: M5 (Phase 5→ship) — v1 ship-ready

Per the roadmap's definition of v1 done (ARCH-KEEL-ROADMAP-001 §5): G1–G5 green
on the current build (now true), the three use cases reproduced against the
built system, Degraded mode demonstrated (fault-inject the codemode adapter),
and a role runbook. M0–M4 are all green; M5 is the acceptance bar, not new loop
mechanism.
