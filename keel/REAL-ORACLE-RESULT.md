# KEEL — Real Oracle Result (post-v1, step 1)

**Status: GREEN.** The fixed `value===42` check is replaced by an oracle that
compiles acceptance suites into per-criterion assertions. 28/28 tests pass on
real workerd (the prior 24 unchanged + 4 new).

## What changed

The Verifier now:
1. Resolves `Specification.oracleRef` -> a **frozen oracle suite** (a set of
   executable assertions keyed by AcceptanceCriterion id).
2. Compiles each covered criterion into a runnable predicate over the recorded
   trace and executes them inline in a Dynamic Worker (the S5-green path),
   independent of the generating model.
3. Returns a **per-criterion** verdict, and distinguishes three outcomes where
   the old oracle had one:
   - a criterion tested false -> **fail** (-> AMEND)
   - a criterion with no assertion / a missing suite / an assertion that threw
     -> **escalate** (-> ESCALATE). *You cannot govern what you cannot verify;
     the oracle fails closed to escalate, never a silent pass.*
   - all covered criteria pass -> **pass** (-> ACCEPT)

## Demonstrated (test/real-oracle.test.ts)

| Case | Result |
|---|---|
| Multi-criterion (example A1 + property A2), both hold | ACCEPT; results `{A1:pass, A2:pass}` |
| A1 passes, property A2 fails | outcome `fail`; results `{A1:pass, A2:fail}` — per-criterion, not aggregate |
| Criterion A9 has no assertion in the suite | outcome `escalate` -> ESCALATE (never a silent pass) |
| `oracleRef` resolves to no suite | ESCALATE (can't verify -> don't pass) |

The property criterion (A2 in `multi@v1`) checks a real invariant — the run had
no ambient network egress (the D5 sandbox guarantee) — evaluated over the trace.

## No frozen-shape change (again)

The real oracle required zero change to the domain: `OracleSpec.oracleRef` was in
the frozen surface for exactly this, and `OraclePort.verify` is unchanged. All
new code is adapter-side: `src/adapters/oracle/suite.ts` (registry + compiler)
and `src/adapters/oracle/suite-oracle.adapter.ts` (the port impl). The toy
`codemode/oracle.adapter.ts` was removed. `grep -r cloudflare src/domain` still
empty. The per-criterion detail (incl. unverifiable/error) rides in the Verdict's
`evidence`; the frozen `results` map stays pass|fail, the `outcome` carries the
escalate signal.

## Still deferred

- **Model still scripted** (next post-v1 step — real generation via AI Gateway).
  With the real oracle in place, a real model is now *judgeable*.
- Suites are in-process; production would load them from R2/D1.
- Property criteria are trace-structural predicates, not input-generated
  property testing (the action, not the oracle, exercises inputs).
- Local workerd only.
