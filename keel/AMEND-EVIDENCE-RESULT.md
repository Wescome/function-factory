# KEEL — AMEND-with-Evidence: closing the claimed-vs-shown gap

**Why this exists.** The record claimed "the harness earns its keep when the
model gets it wrong first — AMEND-with-evidence and ESCALATE." That was asserted,
not shown: the amend path was only tested against a scripted model that branched
on evidence *presence* (`evidence ? right : wrong`), and the one real-model run
ACCEPTed on attempt 1, so amend never fired. This closes that gap.

## Two things changed

**1. The amend evidence is now actionable (real improvement, not a test prop).**
The AI Gateway adapter's amend prompt now names the specific failed criteria and
their statements — e.g. `These criteria did NOT pass: [A2] result.check must
equal result.value doubled` — instead of a bare pass/fail map. A real model gets
told exactly what it missed and the requirement, which is what "AMEND-with-
evidence" has to mean to earn its keep.

**2. The mechanism is proven deterministically, tighter than before.**
A new scripted model (`amend-demo`) branches on WHICH criterion failed
(`evidence.results.A2 === "fail"`), not just that some evidence exists. It fixes
exactly the failed criterion. Proven by `test/amend-evidence.test.ts` (35/35):
- attempt 1 sets `check` wrong -> oracle fails A2 (A1 passes) -> evidence names A2
  -> attempt 2 sets `check = value*2` -> ACCEPT on attempt 2, both criteria pass.
  Converging is ONLY possible if the per-criterion evidence was read; ignoring it
  would loop wrong to ESCALATE.
- **Control:** the same task with budget 1 (no amend allowed) ESCALATEs, with the
  final verdict showing `A2: fail, A1: pass` — proving attempt 1 genuinely fails,
  specifically on A2. The amend is not a no-op.

## What's proven vs still open

- **Proven (deterministic, live substrate):** the loop carries the *specific*
  per-criterion failure back into generation, and a generator that reads it
  corrects exactly that failure to ACCEPT; a generator that can't, ESCALATEs.
- **Still open (needs a live LLM run):** that a *real* model uses this evidence
  to self-correct. `AI-GATEWAY-PLAYBOOK.md` Step 5 is a calibrated task
  (`derived@v1`: A2 requires `check === value*2`, underspecified by the intent)
  designed to make a real model miss A2 first, then fix it on the evidence. The
  trace to capture: two Action nodes (wrong, then corrected) with an
  AmendmentRequested between the verdicts.

Honest status: the mechanism is proven; the real-model demonstration is a smoke
away, and all three outcomes (accept-after-amend / one-shot / escalate) are
documented as informative — including that an ESCALATE would be a real Decision
about evidence richness, not a bug.

## No frozen-shape change

All changes are adapter-side (gateway prompt, scripted model, oracle suite) plus
tests. `grep -r cloudflare src/domain` empty. Ten integrations, surface unmoved.

## Live outcome (real model) — the smoke ran, and found something

The calibrated smoke was run against the real model. On a genuinely
underspecified criterion (`derived-blind@v1`, A2 = check === value*2+7, stated to
the model only as "internally consistent") the run **ESCALATED after 2
amendments** — the informative outcome, not a clean convergence:

- Attempt 1: `echo.emit({ value: 42, check: 42 })` — a reasonable reading
  ("internally consistent" → check mirrors value). A1 pass, A2 fail.
- Attempts 2-3: empty gateway responses → previously a silent `return undefined;`
  → ESCALATE on budget.

Two findings, one fixed here:

1. **Silent-no-op bug — FIXED.** An empty model response was laundered into
   `return undefined;`, misattributing an infrastructure failure as a model
   mistake. Now a throwing action ("empty model response…"), consistent with the
   gateway-error path; unit-tested. This also makes the truncation hypothesis
   testable (the empty response is now visible in the trace).

2. **D10 (OPEN) — the real Decision.** Re-feeding a vague criterion on amend is
   repetition, not evidence. The model had no gradient. Recommended fix: feed the
   **observed** value (never the expected answer — **INV-ORACLE-BLIND**) plus a
   "try a different interpretation" nudge, and raise max_tokens for reasoning
   models. See `BRIEF-KEEL-AMEND-EVIDENCE-001.md`.

**Honest status update.** The mechanism is proven deterministically (35/35, now
36/36 with the fail-loud test). The real-model self-correction claim is **still
not demonstrated** — the live smoke showed the current evidence format is
insufficient for a real model to converge on a genuinely underspecified
criterion. That is a real, recorded finding with a scoped fix pending
disposition, not a gap papered over.
