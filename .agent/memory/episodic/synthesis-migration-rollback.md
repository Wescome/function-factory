# Synthesis Migration Rollback Note

**ADR-009 §8 gate 7 — required before graph-runner.ts deletion**

Written: 2026-05-16
Author: Implementation agent

---

## What is being deleted

When ADR-009 §8 gate 6 is satisfied (no `graph-runner` callers remain),
these two files will be deleted:

- `workers/ff-pipeline/src/coordinator/graph-runner.ts` — `SynthesisGraph.run()` blocking loop
- `workers/ff-pipeline/src/coordinator/graph.ts` — `buildSynthesisGraph()` node wiring

The re-export `export { StateGraph, END } from './graph-runner'` in
`workers/ff-pipeline/src/coordinator/index.ts` will also be removed.

## Rollback procedure

If the NLAH harness path (`synthesis.harness.yaml` + `startHarnessRun`) is
found to be broken after deletion, the rollback path is:

1. `git revert <deletion-commit>` — restores graph-runner.ts and graph.ts.
2. `git revert <caller-migration-commit>` — restores the synthesis queue path
   in pipeline.ts and the coordinator DO synthesize handler.
3. Redeploy the previous Worker bundle.

These reverts are non-destructive because:
- `synthesis.harness.yaml` remains in `harnesses/` regardless.
- NLAH changes (#0–#5) remain in `/Users/wes/nlah` — no rollback needed there.
- `harness-bridge.ts`, `run-coordinator.ts`, `harness-dispatcher.ts` remain.

The synthesis graph path and the harness path are additive until deletion;
no data is lost by reverting to the graph path.

## Conditions for rollback

Roll back if ANY of the following occur within 72 hours of the deletion deploy:

1. `synthesis-results` queue DLQ depth > 0 (RunCoordinator not delivering events).
2. `harness-complete` Workflow events not received after a CODE stage completes.
3. Synthesis runs complete but `SynthesisOutput` artifact is absent from R2.
4. `critique_failed` gate fires but `CRITIQUE.on_failure` does not route to PLAN
   (miscast loop broken).

## Monitoring

Check the following after the deletion deploy:
- CF Worker logs: `[harness-dispatcher]` and `[RunCoordinator]` entries
- HARNESS_QUEUE and HARNESS_DLQ depth (zero is healthy)
- ArangoDB `verification_reports` collection: new rows with `type: harness-run`

## Sign-off

This rollback note satisfies ADR-009 §8 gate 7. It may be deleted after
a successful first live synthesis run with no rollback events observed.
