# Production Readiness Milestones

This document tracks the remaining work to move Function Factory from the
current production-capable smoke state to a production-ready operating posture.
Each milestone must close with explicit evidence, preferably a committed
`VR-*` report in `specs/verification-reports/`.

## Current Baseline

The current branch has production-verified live controls:

- Real operator note, retry, redispatch, and cancel controls.
- Authenticated operator token boundary via `OPERATOR_CONTROL_TOKEN`.
- Interactive monitor controls through `pnpm watch:run <runId> --interactive`.
- Production control smoke command through `pnpm prod:smoke:controls`.
- Latest committed production control report:
  `VR-FN-SYNTH-MIGRATE-PROD-LIVE-CONTROL-2026-05-18T22-37-36-823Z`.

This baseline is not final production readiness. It proves one critical slice:
operators can observe and recover live runs. The next production priority is
the coding Domain Adapter's full Pi-backed authoring path, followed by
observability across the entire Function Factory pipeline.

## Milestone 1: Pi Coding Infrastructure Production Readiness

**Goal:** The end-to-end Factory coding path can produce, verify, repair, and
report a real Pi-authored change without deterministic authoring shortcuts.

Scope:

- Full coding-domain production run from objective or seeded workspace through
  compiled intent, executable specification, harness runtime, Pi authoring,
  verification, repair, and final report.
- R2 harness load and NLAH compilation through the production path.
- RunCoordinator state transitions and queue dispatch across the whole coding
  run.
- Pi free-form patch authoring with no deterministic patch materialization
  shortcuts.
- Multi-file patch smokes, invalid patch recovery, and failing-test repair loop.
- Per-dispatch model-route evidence.
- CandidatePatch, VerifierReport, FinalPatch, and PRSummary artifacts.
- R2 manifest, phase record, attempt log, observation, and report persistence.
- Production smoke command through `pnpm prod:smoke:coding` or inclusion in
  `pnpm prod:smoke`.

Exit criteria:

- A production smoke proves Pi authored and repaired a realistic multi-file
  change through the same infrastructure used by the full Factory pipeline.
- The smoke fails closed on skipped authoring, missing tool-call evidence,
  missing artifacts, bad model-route evidence, failed verification, or
  persistence gaps.
- The coding Domain Adapter evidence is linked back to the Factory artifacts
  that caused the run.
- A passing run emits a committed
  `VR-FN-MOTDWVR2-W7UN-PROD-CODING-E2E-*` report or successor Function-linked
  report.

Evidence:

- `pnpm prod:smoke:coding` or `pnpm prod:smoke` output.
- Production run ID and Worker/container version identity.
- R2 artifact keys for CandidatePatch, VerifierReport, FinalPatch, PRSummary,
  observations, and attempt logs.
- Model-route evidence for every Pi dispatch.
- Committed `VR-FN-MOTDWVR2-W7UN-PROD-CODING-E2E-*` report or successor.

## Milestone 2: Full Pipeline Observability

**Goal:** Operators can watch and diagnose the whole Function Factory pipeline,
not only the harness-runtime slice.

Scope:

- One correlation envelope from Pressure or objective through intent,
  executable specification, harness runtime, Pi authoring, verification,
  repair, final Function artifact, and report.
- Compile, planning, dispatch, verification, repair, intervention, and terminal
  events emitted into a unified trace or bridged into `RunEventLog`.
- Upstream Factory artifacts aligned with R2 run manifests and Verification
  Reports.
- `/run-monitor` or its successor shows whole-pipeline phase, current blocking
  unit, last decision, last dispatch, latest artifact, and terminal cause.
- Event streaming or low-latency monitor refresh for live progress.
- Diagnosis block covering tool-call traces, container stderr, contract
  evaluations, artifact links, model routing, and next operator action.

Exit criteria:

- A run can be followed from initial Factory input to final report with one
  correlation ID.
- Every operator-visible failure class includes enough persisted evidence to
  diagnose without ad hoc `wrangler tail` or direct R2 guessing.
- The monitor distinguishes compile failure, dispatch failure, Pi tool failure,
  verification failure, repair exhaustion, operator cancellation, and
  infrastructure abandonment.
- A production smoke proves the monitor projection is coherent across the full
  pipeline.

Evidence:

- Full-pipeline monitor snapshot for passing, repair, verification-failed,
  infrastructure-failed, and operator-cancelled runs.
- R2 trace keys and manifest links.
- CLI rendering tests.
- Committed full-pipeline observability `VR-*` report.

## Milestone 3: Full Production Smoke Standardization

**Goal:** One command verifies the full deploy surface, not only live controls
or the coding smoke.

Scope:

- Pi coding infrastructure smoke from Milestone 1.
- Full-pipeline observability smoke from Milestone 2.
- Container rollout transient smoke.
- R2 artifact, manifest, phase-record, and attempt-log checks.
- Run monitor projection checks.
- Operator controls smoke.
- Final `VR-*` report per deploy.

Exit criteria:

- `pnpm prod:smoke` or equivalent exists.
- The command fails closed on any missing artifact, bad projection, stuck run,
  auth regression, skipped Pi authoring, or failed production smoke.
- A passing run emits one deploy-level Verification Report.

Evidence:

- Smoke command output.
- Production run IDs.
- Worker version ID.
- R2 artifact keys.
- Committed `VR-FN-MOTDWVR2-W7UN-PROD-*` report or successor.

## Milestone 4: Security Boundary

**Goal:** Production endpoints are intentionally exposed, protected, or removed.

Scope:

- Review `/debug/*`, `/trigger-harness`, `/run-status`, `/run-monitor`,
  `/run-artifacts`, and `/run-interventions`.
- Separate read-only monitor access from mutating control access.
- Protect or remove public debug routes.
- Add rate limiting or abuse controls for mutation endpoints.

Exit criteria:

- Endpoint exposure matrix is documented.
- Mutating endpoints require dedicated operator auth.
- Debug routes are not publicly available in production without an explicit
  decision.
- Tests cover unauthorized, wrong-token, and missing-token behavior.

Evidence:

- Security review notes.
- Endpoint matrix.
- Production auth probes.
- Tests.

## Milestone 5: Operator Audit Hardening

**Goal:** Operator actions are attributable and auditable beyond free-text labels.

Scope:

- Stable operator identity policy.
- Auth subject recorded on intervention events.
- Command origin metadata.
- Idempotency key surfaced in monitor/audit views.
- Client metadata recorded without leaking secrets.

Exit criteria:

- Intervention events include operator identity, authenticated subject, action
  origin, idempotency key, and timestamp.
- `/run-monitor` exposes audit-safe control metadata.
- Tests cover audit field persistence for note, retry, redispatch, and cancel.

Evidence:

- Unit tests.
- Production smoke showing audit fields.
- Updated operator runbook.

## Milestone 6: Run Lifecycle Cleanup

**Goal:** Runs cannot remain invisible, orphaned, or permanently active without
detection.

Scope:

- Active-index reconciliation from immutable event history.
- Automatic cleanup for stuck or abandoned active runs.
- Recent/active/terminal run listing endpoint.
- Clear retention policy for run artifacts beyond attempt-log lifecycle.

Exit criteria:

- Active index can be rebuilt or reconciled from event logs.
- Stuck active runs are detected and reported.
- Operators can list recent and active runs without direct R2 inspection.
- Retention policy is documented by artifact class.

Evidence:

- Reconciliation tests.
- Watchdog tests.
- Production drill with a disposable stuck/abandoned run.

## Milestone 7: Release and Rollback Discipline

**Goal:** Deploys are repeatable, reversible, and evidence-backed.

Scope:

- Production deploy checklist.
- Rollback procedure.
- Last-known-good Worker/container version evidence.
- Post-deploy verification command that fails closed.

Exit criteria:

- A human can deploy, verify, and roll back from a runbook.
- Every deploy has a committed verification artifact or a documented failed
  verification artifact.
- Rollback target is explicit before deployment starts.

Evidence:

- Deploy runbook.
- Rollback drill.
- Deploy-level `VR-*`.

## Milestone 8: Durable Workflow Reliability

**Goal:** Workflow and queue failure modes terminate cleanly with evidence.

Scope:

- Alarm retry coverage.
- Workflow notification retry caps.
- Permanent abandonment evidence.
- DLQ drill with production-like messages.
- No infinite alarm loops or orphan active-index entries.

Exit criteria:

- Permanent workflow notification failure is capped and visible.
- DLQ handling creates terminal evidence.
- Tests cover retry exhaustion and alarm non-reentry.

Evidence:

- Coordinator tests.
- DLQ production-like drill.
- Monitor output for abandoned/failure cases.

## Milestone 9: R2 and Artifact Governance

**Goal:** Run evidence has clear lifecycle, retention, and inspection behavior.

Scope:

- Lifecycle rules by artifact class.
- Direct R2 inspection tooling for run artifacts.
- Retention guarantees for summaries, events, manifests, reports, phase records,
  and attempt logs.

Exit criteria:

- Artifact classes and retention windows are documented.
- Operators can inspect a run without guessing bucket keys.
- Lifecycle rules are configured and verified.

Evidence:

- R2 lifecycle output.
- Inspection command output.
- Artifact governance doc.

## Milestone 10: Operator UX Completion

**Goal:** The operator workflow is efficient enough for repeated production use.

Scope:

- Active-run picker/list.
- Command result history.
- Safer cancel UX with visible terminal consequence.
- Better interactive monitor layout.

Exit criteria:

- Operator can discover active runs, inspect one, act, and see action history
  without composing raw URLs.
- Cancel flow clearly displays terminal impact before confirmation.

Evidence:

- CLI tests.
- Recorded operator walkthrough.
- Updated runbook.

## Milestone 11: Docs and Runbooks

**Goal:** Production operation does not depend on session memory.

Scope:

- Production deploy runbook.
- Incident response runbook.
- Operator controls runbook hardening.
- Smoke report interpretation guide.

Exit criteria:

- Every production procedure has one canonical document.
- Each runbook names prerequisites, commands, expected evidence, failure modes,
  and rollback/escalation.

Evidence:

- Docs index.
- Link/audit checks.

## Milestone 12: Final Production Readiness Review

**Goal:** Produce a single decision artifact for production readiness.

Scope:

- Run full production smoke suite.
- Review security boundaries.
- Review observability coverage.
- Confirm rollback path.
- Confirm operator runbooks.

Exit criteria:

- Final `VR-FN-MOTDWVR2-W7UN-PROD-READINESS-*` report or successor exists.
- All blocking milestones are pass or explicitly waived with rationale.
- Residual risks are documented with owners and detectors.

Evidence:

- Final Verification Report.
- Linked smoke reports.
- Security/rollback evidence.
- Open-risk ledger.

## Recommended Next Work

Start with Milestone 1, then Milestone 2:

1. Build and verify `pnpm prod:smoke:coding` or equivalent for the
   end-to-end Pi coding infrastructure path.
2. Implement the full-pipeline correlation envelope and monitor projection.
3. Consolidate coding, observability, rollout, artifact, and control checks
   into broad `pnpm prod:smoke`.

These reduce the largest production risks in order: unproven Pi-backed coding
execution, partial observability, then fragmented deploy verification.
