# KEEL v1 — Role Runbook

Three roles operate a KEEL deployment. Each maps to concrete system operations;
none can do another's job by construction.

## Operator — runs work, watches custody

**Does:** admits runs, monitors state, reads the custody graph.

| Task | Operation |
|---|---|
| Start a run | `admit(specification)` — returns `{ accepted, runId }`. Idempotent on the spec id (D7): re-admitting the same spec returns `accepted:false`, never a duplicate. |
| Check state | `result()` — current terminal (`ACCEPT` / `ESCALATE` / `PAUSE`) or in-flight. |
| Inspect custody | `readRun()`, `timeline()`, `replayTo(index)` — the full lineage, the state sequence, any point-in-time snapshot. |
| Audit a decision | `verifyReplay()` — confirms the run's decisions re-derive from the record. |

**Cannot:** approve a paused run, change a budget or oracle, or override an
ESCALATE. Those are the Approver's and Governor's.

## Approver — the human in the loop (D8)

**Does:** resolves runs paused on an approval-gated action.

| Task | Operation |
|---|---|
| See what's waiting | `result()` returns `PAUSE` with the pending `executionId`; `readRun()` shows the gated action's connector/method/args. |
| Approve | `approve()` — replays the action (D8 abort-and-replay): prior calls are no-ops, the gated call runs for real, the run continues to VERIFY. |
| Reject | reject the pending action — the gated effect never runs; the run escalates. |

**Key property:** approval is a *replay*, not a resume of a frozen stack. Any
effect the Approver sees listed before the gate has already been logged
(replayed as a no-op) or is idempotent — it cannot fire twice on approval.

**Cannot:** generate or edit the action's code, or bypass verification. Approval
authorizes an already-generated, already-verified-up-to-here action to proceed.

## Governor — sets the rules, dispositions decisions

**Does:** owns the Specification's terms and the response to escalations.

| Task | Operation |
|---|---|
| Set the attempt budget | `SpecificationContent.attemptBudget` — empirical per task, never inherited. Governs how many amend cycles before ESCALATE. |
| Set the capability ceiling | `SpecificationContent.connectors` + `approvalGated` — the connectors-only action space (D5) and which calls need an Approver. |
| Bind the oracle | `SpecificationContent.oracleRef` — the frozen acceptance suite the independent Verifier runs. |
| Handle an ESCALATE | Review the custody (`readRun`/`timeline`); the run exhausted its budget or hit a verifier-escalate. Decide: widen the spec, grant a capability, or defer. This is a Disposition (Part D). |

**Cannot:** approve individual paused actions (that's the Approver, per-run) or
score outputs (that's the independent Verifier). The Governor sets the frame;
the loop runs inside it.

## The invariant across all three

No role can make the system accept work that didn't pass independent
verification, and no role can erase lineage — the record is append-only and the
only mutation path (`LineageRepositoryPort`) has no delete. Operator reads,
Approver authorizes, Governor frames; the Verifier alone judges.
