# BRIEF-KEEL-AMEND-EVIDENCE-001 — Amend evidence richness

**Status: OPEN DECISION (D10).** Surfaced by a live real-model run. Wes disposes.

## The finding (live)

A calibrated fail-then-fix task on a genuinely underspecified criterion
(`derived-blind@v1`: A2 = `check === value*2 + 7`, but the acceptance statement
shown to the model only said "internally consistent") ran against the real model
and **ESCALATED after 3 attempts / 2 amendments**:

- **Attempt 1** (no evidence): `echo.emit({ value: 42, check: 42 })` — a
  reasonable first reading of "internally consistent": check mirrors value.
  A1 pass, A2 fail.
- **Attempt 2** (told: "A2 failed — check must be present and internally
  consistent with value"): empty gateway response → *(previously)* a silent
  `return undefined;`. A1 now fails too.
- **Attempt 3**: same empty response → ESCALATE on budget.

Timeline confirmed the expected shape:
`VerdictEmitted(fail) → AmendmentRequested → VerdictEmitted(fail) →
AmendmentRequested → RunEscalated`.

This is the informative outcome the playbook anticipated, not a clean
convergence story. Two distinct issues, one already fixed:

## Issue 1 — silent no-op fallback (FIXED, not part of this decision)

`extractCode` converted an empty model response into `return undefined;`, which
executed and failed verification *as if the model had written bad code*. That
misattributes an infrastructure failure (empty/truncated response) as a model
mistake, corrupting lineage trust. **Fixed:** an empty response now surfaces as
a throwing action ("empty model response…"), consistent with the gateway-HTTP-
error path. This also makes the truncation hypothesis testable — the empty
response is now visible in the trace instead of laundered. Covered by a unit
test. No decision needed; it was a straight correctness fix.

## Issue 2 — the actual decision: evidence too thin to converge

When the acceptance stays vague and the amend prompt only **re-states the same
vague criterion**, the model has no new information on attempt 2. Re-feeding an
identical statement is repetition, not evidence — the model already tried its
best reading and has nothing to move toward. The amend loop is only as good as
the gradient the evidence provides.

### Named invariant to preserve (INV-ORACLE-BLIND)

Whatever we add, **the evidence must reveal what the model DID, never what it
SHOULD do.** The moment the amend prompt carries the expected answer, independent
verification collapses into the model grading against a leaked key — the whole
point of an external oracle is lost. Options are judged against this line.

### Options (forced placement)

| Opt | What the amend evidence adds | Gradient | Answer-key risk | Verdict |
|---|---|---|---|---|
| **A** | **Observed value only** — "you produced `check=42`; A2 not satisfied." | Real: the model sees its own output and can try a *different* value. | **None** — shows behavior, not target. | **Recommended (core).** Honors INV-ORACLE-BLIND exactly. |
| **B** | Observed + relationship *type* hint — "check should be a function of value, not equal to it." | Stronger. | Low leak (reveals shape, not formula). | Optional add-on if A alone underperforms; decide per-suite. |
| **C** | Observed + **expected** — "expected `check=91`." | Strongest. | **Violates INV-ORACLE-BLIND.** | **Rejected.** Turns the oracle into an answer key. |
| **D** | A prompt nudge — "your previous interpretation was wrong; try a materially different reading." | Cheap; complements A. | None. | **Recommended (cheap add).** |

### Sub-decision — max_tokens for reasoning models

kimi-k2.6 emits a separate `reasoning_content`; `max_tokens: 800` may be too
tight for an ambiguous retry (plausibly burned on reasoning, no final content —
now surfaced by the Issue-1 fix rather than hidden). Options: raise the cap
(e.g. 2000+), make it configurable per-deployment, and/or detect truncation
(finish_reason) and surface it distinctly from an empty response. Low-risk;
recommend raise + make configurable, and revisit once traces show whether empty
responses persist after the cap increase.

## Recommendation

Adopt **A + D** for the amend evidence (observed value + a "try a different
interpretation" nudge), keep **C off the table** permanently (INV-ORACLE-BLIND),
treat **B** as a per-suite opt-in, and **raise/configure max_tokens**. This needs
the OraclePort evidence to carry the observed value the assertion read — a small,
INV-ORACLE-BLIND-safe enrichment of the oracle adapter, plus a prompt change in
the gateway adapter. All adapter-side; no frozen-shape change.

## Open sub-questions (parked for disposition)

1. Does the oracle report a single observed value per criterion, or a small
   structured "what I checked" object? (Assertions are opaque expressions today;
   extracting the observed operand needs the suite to name it.)
2. Is B ever enabled by default, or always per-suite?
3. Truncation as a *distinct* verdict signal (verifier-escalate with reason
   "generation-truncated") vs. a normal fail — worth its own micro-decision.

## Regression fixtures (kept in repo)

`derived-hard@v1` and `derived-blind@v1` (suite.ts) reproduce the finding and
become the acceptance cases for whatever evidence enrichment lands. Do not remove.
