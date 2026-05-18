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
operators can observe and recover live runs.

## Milestone 1: Full Production Smoke Standardization

**Goal:** One command verifies the full deploy surface, not only live controls.

Scope:

- Pi authoring smoke.
- Container rollout transient smoke.
- R2 artifact, manifest, phase-record, and attempt-log checks.
- Run monitor projection checks.
- Operator controls smoke.
- Final `VR-*` report per deploy.

Exit criteria:

- `pnpm prod:smoke` or equivalent exists.
- The command fails closed on any missing artifact, bad projection, stuck run,
  auth regression, or failed production smoke.
- A passing run emits one deploy-level Verification Report.

Evidence:

- Smoke command output.
- Production run IDs.
- Worker version ID.
- R2 artifact keys.
- Committed `VR-FN-SYNTH-MIGRATE-PROD-*` report.

## Milestone 2: Operator Audit Hardening

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

## Milestone 3: Security Boundary

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

## Milestone 4: Run Lifecycle Cleanup

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

## Milestone 5: Live Observability v2

**Goal:** Operators get a direct explanation of what happened and what to do next.

Scope:

- Event streaming or lower-latency updates beyond polling snapshots.
- Failure diagnosis block in `/run-monitor`.
- Container stderr, Pi tool-call traces, contract evaluations, and artifact
  links surfaced cleanly.
- Compact operator view for cause, current state, and next action.

Exit criteria:

- Monitor output contains diagnosis and next-action guidance for common failure
  classes.
- Tool-call traces are persisted and linked from run artifacts.
- Container logs are visible without ad hoc `wrangler tail`.

Evidence:

- Monitor snapshots for pass, retryable fail, infrastructure fail, and cancel.
- R2 diagnostic artifact keys.
- CLI rendering tests.

## Milestone 6: Pi Production Authoring Hardening

**Goal:** Free-form Pi patch authoring is robust across realistic coding changes.

Scope:

- Multi-file patch authoring smokes.
- Invalid patch recovery.
- Test failure repair loop.
- Per-dispatch model-route fallback evidence.
- First-class tool-call trace artifacts.

Exit criteria:

- Pi can author and repair multi-file changes without deterministic patch
  materialization shortcuts.
- Invalid patch and failing-test paths produce useful diagnostics and recovery.
- Model routing decisions are recorded per dispatch.

Evidence:

- Production coding-adapter smokes.
- CandidatePatch artifacts.
- Verifier reports.
- Tool-call trace artifacts.

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

- Final `VR-FN-SYNTH-MIGRATE-PROD-READINESS-*` report exists.
- All blocking milestones are pass or explicitly waived with rationale.
- Residual risks are documented with owners and detectors.

Evidence:

- Final Verification Report.
- Linked smoke reports.
- Security/rollback evidence.
- Open-risk ledger.

## Recommended Next Work

Start with Milestone 1 and Milestone 3:

1. Expand `pnpm prod:smoke:controls` into a broader `pnpm prod:smoke`.
2. Create the endpoint exposure matrix and protect/remove public debug routes.

These two reduce the largest production risks: unverified deploy surface and
unclear endpoint security posture.
