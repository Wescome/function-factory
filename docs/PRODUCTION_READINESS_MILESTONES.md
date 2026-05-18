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

Architect production-readiness review adds a sharper boundary:

- The deterministic materialization path is production-ready.
- The autonomous Pi reasoning path is not production-ready until it authors a
  real diff in production and the singleton container cannot contaminate
  stage-scoped evidence.

## Milestone 0: Container Isolation and Backpressure

**Goal:** The singleton Pi container cannot corrupt stage evidence, share mutable
session state across stages, or accept unbounded concurrent work.

Scope:

- Per-stage stderr collector instead of module-global stderr ring persistence.
- Per-stage Pi session directory:
  `PI_SESSION_DIR=${workDir}/.pi-sessions`.
- Workdir cleanup in `finally` after stage completion or failure.
- Backpressure for `POST /execute` against the singleton container.
- Concurrent-stage smoke proving two stages cannot cross-contaminate
  observations, stderr, session archive, or contract artifacts.

Exit criteria:

- No stage writes stderr, session, or archive data produced by another stage.
- Concurrent dispatches are queued, rejected with a clear retryable response, or
  otherwise bounded by an explicit container policy.
- Warm containers do not accrete unbounded workdirs or shared `$HOME/.pi`
  session state.
- Operator-facing artifacts identify whether an archive was complete, capped,
  or dropped.

Evidence:

- Unit tests for per-stage collectors and cleanup.
- Concurrency smoke output.
- R2 observation, stderr, and session archive keys for two overlapping stages.
- Committed `VR-FN-PI-CONTAINER-ISOLATION-*` report or successor.

## Milestone 1: Autonomous Pi Authoring Production Proof

**Goal:** Pi LLM authoring executes in production and produces a real, verified
filesystem patch without deterministic patch synthesis.

Scope:

- Production smoke with `authoringMode: "autonomous_filesystem"` against a
  seeded workspace with no `expectedChanges` deterministic patch materializer.
- Tool capability probe evidence when the deterministic path cannot satisfy all
  contracts.
- Free-form Pi patch authoring, invalid patch recovery, and failing-test repair
  loop.
- Per-dispatch model-route evidence from the Worker input that actually reaches
  Pi.
- CandidatePatch, VerifierReport, FinalPatch, and PRSummary artifacts.
- R2 manifest, phase record, attempt log, observation, and report persistence.

Exit criteria:

- Pi independently authors a non-empty CandidatePatch in production.
- `finalAttempt` is `initial` or `repair-1` for the smoke.
- CandidatePatch is a valid unified diff and `git apply --check` accepts it.
- Session archive is non-empty and linked from R2.
- The smoke fails closed on `skipPrompt = true`, zero tool calls, missing
  model-route evidence, missing CandidatePatch, missing verifier evidence, or
  missing R2 artifacts.
- A passing run emits a committed `VR-FN-PI-AUTONOMOUS-AUTHORING-*` report or
  successor Function-linked report.

Evidence:

- `pnpm prod:smoke:coding` or focused autonomous-authoring smoke output.
- Production run ID and Worker/container version identity.
- CandidatePatch artifact and `git apply --check` result.
- Pi session archive, tool-call trace, stderr, and contract-evaluation keys.
- Model-route evidence for every Pi dispatch.
- Committed `VR-FN-PI-AUTONOMOUS-AUTHORING-*` report or successor.

## Milestone 2: Pi Runtime Hardening

**Goal:** Autonomous Pi authoring cannot silently fail open, monopolize the
singleton container, or forge verification evidence.

Scope:

- Startup secret validation: container exits clearly if `OFOX_API_KEY` or its
  configured equivalent is missing.
- `POST /__pi-container/restart` protected by `OPERATOR_CONTROL_TOKEN`.
- End-to-end execution budget covering probe, initial attempt, and repairs.
- Failover waits for the previous Pi process to exit before spawning the next
  candidate.
- Repair prompts include current file content or explicit file context.
- Contract failure can use model failover according to the routing policy.
- Workspace-derived VerifierReport artifacts are marked `synthesized: true` or
  renamed to `SyntheticVerifierReport`.
- Session archive cap or truncation is surfaced as operator-visible evidence.

Exit criteria:

- Missing model credential fails at startup with a specific missing-secret
  signal.
- Unauthenticated restart requests fail in production.
- A stage cannot hold the singleton container past the configured total budget.
- Failed Pi processes cannot leak trailing events into the next candidate's
  tool-call counts.
- Synthetic verifier evidence is distinguishable from real verifier execution.

Evidence:

- Unit tests for secret validation, restart auth, timeout budget, failover
  cleanup, and synthetic verifier tagging.
- Production auth probe for restart.
- Production smoke showing timeout and archive-cap diagnostics are visible.

## Milestone 3: Full Pipeline Observability

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

## Milestone 4: Full Production Smoke Standardization

**Goal:** One command verifies the full deploy surface, not only live controls
or the coding smoke.

Scope:

- Container isolation smoke from Milestone 0.
- Autonomous Pi authoring smoke from Milestone 1.
- Pi runtime hardening checks from Milestone 2.
- Full-pipeline observability smoke from Milestone 3.
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

## Milestone 5: Security Boundary

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

## Milestone 6: Operator Audit Hardening

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

## Milestone 7: Run Lifecycle Cleanup

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

## Milestone 8: Release and Rollback Discipline

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

## Milestone 9: Durable Workflow Reliability

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

## Milestone 10: R2 and Artifact Governance

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

## Milestone 11: Operator UX Completion

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

## Milestone 12: Docs and Runbooks

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

## Milestone 13: Final Production Readiness Review

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

Start with Milestone 0, then Milestone 1:

1. Implement per-stage stderr/session isolation, workdir cleanup, and singleton
   container backpressure.
2. Run a production autonomous Pi authoring smoke with
   `authoringMode: "autonomous_filesystem"` and no deterministic expected
   changes.
3. Close runtime hardening gaps for missing secrets, restart auth, execution
   budgets, failover cleanup, repair context, and synthetic verifier tagging.
4. Implement the full-pipeline correlation envelope and monitor projection.
5. Consolidate coding, observability, rollout, artifact, and control checks
   into broad `pnpm prod:smoke`.

These reduce the largest production risks in order: shared singleton state,
unproven autonomous authoring, unsafe runtime failure modes, partial
observability, then fragmented deploy verification.
