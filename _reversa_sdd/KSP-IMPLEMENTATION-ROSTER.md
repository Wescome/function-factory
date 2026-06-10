# KSP Implementation — Agent Roster

> Phase 2 · Forward Implementation · function-factory
> Generated: 2026-06-10
> SDD confidence: 89% (7 modules, all 52 steps accounted for)
> ⚠️ Updated: 2026-06-10 — `reversa-coding` direct invocation PROHIBITED. Use `reversa-implement`.

---

## ⛔ DO NOT invoke `reversa-coding` directly

Direct invocation of `reversa-coding` bypasses gate enforcement, escalation chain, and architect sign-off. A coding agent can self-report `tsc EXIT 0` without running it. This has already caused a production topology defect (undocumented `ff-flue` worker invented in commit `67ceea3`, never caught because `wrangler dev` gate was never actually run).

**Always invoke `/reversa-implement` instead.** It wraps `reversa-coding` with mandatory gate execution.

---

## Primary Implementation Orchestrator

| Agent | Skill | Role | Invoked |
|-------|-------|------|---------|
| **Orchestrator** | `reversa-implement` | Enforces gate execution, escalation chain, and architect sign-off. Wraps reversa-coding. Gates are run by the orchestrator — never self-reported by the coder. | Every phase, replaces direct reversa-coding |
| **Coder** | `reversa-coding` | Transforms a single task into code. Invoked only BY reversa-implement, never directly. | Per-task, called by Orchestrator only |

---

## Gate Diagnostic Specialists

Invoked on gate failure. Read-only. Write only to `_reversa_sdd/gate-diagnostics/`.

| Agent | Skill | Triggered by | Output |
|-------|-------|--------------|--------|
| **TS Doctor** | `reversa-ts-doctor` | `tsc --noEmit` failure | `gate-diagnostics/ts-diagnosis-{phase}.md` — errors traced to spec section, cascades identified, fixes proposed |
| **CF Specialist** | `reversa-cf-specialist` | `wrangler dev` failure or DO instantiation error | `gate-diagnostics/cf-diagnosis-{phase}.md` — binding topology verified against SPEC-FF-GEARS-001 §11 |
| **Test Interrogator** | `reversa-test-interrogator` | `vitest` test failure | `gate-diagnostics/test-diagnosis-{phase}.md` — verdict per failure (IMPL_WRONG / TEST_WRONG / SPEC_GAP / CASCADE), Gherkin parity specs |

---

## Escalation Chain

Invoked when the primary coder fails a gate after retry.

| Agent | Skill | Role | Invoked at |
|-------|-------|------|-----------|
| **Auditor** | `reversa-audit` | Cross-checks requirements/roadmap/actions for contradictions that caused the failure | Attempt 3 |
| **Clarifier** | `reversa-clarify` | Resolves spec ambiguities surfaced by the diagnostic specialists | Attempt 3, on SPEC_GAP findings |
| **Reconstructor** | `reversa-reconstructor` | Bottom-up reimplementation of a single task from SDD, clean slate | Attempt 4 |

---

## Escalation Pattern

```
Gate failure detected
       │
       ▼
Attempt 1 — reversa-coding retry (error output injected as context)
       │
       ▼ still failing
Attempt 2 — reversa-coding + specialist matched to error type:
              tsc error     → reversa-ts-doctor
              wrangler/DO   → reversa-cf-specialist
              test failure  → reversa-test-interrogator
       │
       ▼ still failing
Attempt 3 — reversa-audit + reversa-clarify (if SPEC_GAP)
            + all matched specialists run in parallel
            → reversa-coding synthesizes from all diagnostic reports
       │
       ▼ still failing
Attempt 4 — reversa-reconstructor (that task only, fresh from SDD)
       │
       ▼ still failing
HALT — surface to Wes with full gate-diagnostics/ folder
```

---

## Specialist Routing by Error Signature

| Error signature | Primary specialist |
|---|---|
| `TS2345`, `TS2339`, `TS2304` — type mismatch | reversa-ts-doctor |
| `TS2307`, `TS2305` — module resolution | reversa-ts-doctor |
| `@koales/` reference in output | reversa-ts-doctor (naming violation) |
| `wrangler dev` fails to start | reversa-cf-specialist |
| DO not instantiating | reversa-cf-specialist |
| `new_sqlite_classes` error | reversa-cf-specialist |
| Fabricated Flue API | reversa-cf-specialist |
| `vitest` assertion failure | reversa-test-interrogator |
| HARD GATE: loop-closure tests | reversa-test-interrogator (CRITICAL) |
| Spec ambiguity surfaced | reversa-clarify |
| All retries exhausted | reversa-reconstructor |

---

## Phase → Primary Spec → Tasks File

| Phase | Package | Spec | Tasks |
|-------|---------|------|-------|
| 1 | `@factory/artifact-graph` | `SPEC-KSP-ARTIFACT-GRAPH-001.md` | `ksp-artifact-graph/tasks.md` |
| 2 | `@factory/bead-graph` | `SPEC-KSP-BEAD-GRAPH-001.md` | `ksp-bead-graph/tasks.md` |
| 3 | `@factory/ksp-sdk` | `SPEC-KSP-BEAD-GRAPH-001.md §8` | `ksp-sdk/tasks.md` |
| 4 | `@factory/loop-closure` | `SPEC-KSP-LOOP-CLOSURE-001.md` | `ksp-loop-closure/tasks.md` ⚠️ HARD GATE |
| 5 | `packages/factory-graph` | `SPEC-KSP-FACTORY-001.md` | `ksp-factory-graph/tasks.md` |
| 6 | `@factory/gears` | `SPEC-FF-GEARS-001.md` | `ksp-gears/tasks.md` |
| 7 | `.flue/workflows` | `SPEC-FF-JUSTBASH-001-004.md` | `ksp-flue-workflow/tasks.md` |
| 8 | Integration | Steps 49–52 | Deploy to CF paid account |

---

## Hard Rules (CLAUDE.md — all 10 must be enforced by reversa-coding)

1. No fabricated APIs — only verified Flue API surface
2. No `deriveRole()` — use `directive.role` directly
3. `evaluateSuccessCondition` is async, takes `harness` param
4. `CoordinatorDO.writeAudit()` is NOT a stub — fully implemented (SPEC-FF-GEARS-001 §7b)
5. `initRun()` before `getNextReady()`
6. Phase 4 HARD GATE — no `recordOutcome()` in CoordinatorDO until loop-closure tests green
7. Append-only everywhere — no deletes, no updates in artifact graph or bead graph
8. `tsc --noEmit` after EVERY step — not after every phase
9. `@factory/ksp-sdk` has zero `@factory/*` imports except `@factory/bead-graph`
10. `CoordinatorDO` full implementation from SPEC-FF-GEARS-001 §7b — not the stub

---

## Diagnostic Output Location

All gate diagnostics write to: `_reversa_sdd/gate-diagnostics/`

| File | Written by |
|------|-----------|
| `ts-diagnosis-{phase}.md` | reversa-ts-doctor |
| `cf-diagnosis-{phase}.md` | reversa-cf-specialist |
| `test-diagnosis-{phase}.md` | reversa-test-interrogator |
| `cross-check.md` | reversa-audit |
