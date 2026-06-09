# Bootstrap Goal Set

Status: active planning reference
Last updated: 2026-05-24
Lineage: README.md, ARCHITECTURE.md, DECISIONS.md, ADR-010-gas-city-supersedes-nlah.md, ARCHITECTURE-ROADMAP-GAS-CITY-FACTORY.md, IS-GC-EP-FORMULA-DISPATCH, IS-GC-DISPATCH-WIRE, ES-GC-EP-FORMULA-DISPATCH, ES-GC-DISPATCH-WIRE

## North Star

Make Function Factory a verification-clean, closed-loop compiler that can
specify, dispatch, validate, monitor, and amend executable Functions through
Gas City while preserving lineage and fail-closed Verification at every
lifecycle boundary.

## Goal 1: Keep The Kernel Verification-Clean

Maintain a repo state where core audits and tests are trusted signals, not
aspirational checks.

Epics:

- Lineage hygiene: all `source_refs` resolve or are explicitly virtual/known gaps.
- Ontology hard-cut: no active legacy `WorkGraph`, `PRD`, `CoverageReport`, or numbered-gate surfaces.
- Verification baseline: `pnpm audit:docs`, `pnpm audit:ontology`, `pnpm typecheck`, and key package tests pass.
- Spec compiler hygiene: active Intent Specifications compile to Executable Specifications and Verification Reports before downstream execution claims.

Exit criteria:

- Full repo typecheck passes.
- Docs and ontology audits pass.
- No active placeholder artifact IDs such as `ES-XXX`.

## Goal 2: Close Gas City IP-1 As Governed Dispatch

Factory can transform a governed Execution Packet into a Gas City dispatch
with durable FORM and dispatch evidence.

Epics:

- Formula compiler contract: ES/EP to FORM-* remains deterministic, LLM-free, and idempotent.
- Dispatch route: `POST /dispatch-formula` validates auth/env, loads EP, calls real ArangoDB deps, and returns structured outcome.
- Bead lineage labels: root Bead carries `fn-id`, `is-id`, `es-id`, `form-id`, and `factory-attempt`.
- Idempotency and recovery: `dispatch_log` handles replay, bead conflict, sling conflict, and partition recovery.
- Operator evidence: Phase 1 smoke captures FORM ID, dispatch log key, Bead ID, workflow ID, and label proof.

Exit criteria:

- `IS-GC-EP-FORMULA-DISPATCH` and `IS-GC-DISPATCH-WIRE` remain Coherence Verification PASS.
- Route and adapter tests pass.
- Live or smoke dispatch proves Bead labels and idempotency.

## Goal 3: Prove Gas City Convergence And Fidelity Intake

Factory receives Gas City completion evidence and turns it into deterministic
Fidelity Verification.

Epics:

- RELEASE/webhook bridge: Gas City posts `molecule.completed` to Factory with HMAC verification.
- Event ingestion: Factory writes append-only event evidence and never calls back into Gas City during execution.
- Fidelity Verification Report: Factory emits `VR-*` with `kind: fidelity` from completion payload, evidence completeness, and acceptance-criteria bijection.
- Lifecycle guard: produced Functions can move to `accepted` only on Fidelity PASS.
- Bad-patch smoke: Gas City VERIFY fails once, convergence repairs, then completion arrives with PASS.

Exit criteria:

- `molecule.completed` PASS creates a Fidelity Verification Report.
- Failed or exhausted completion creates failed Fidelity Verification Report.
- No Function promotion happens without Fidelity evidence.

## Goal 4: Reach Monitored Function Lifecycle

Move from produced/accepted evidence to actively monitored Functions.

Epics:

- Persistence Verification: detector freshness and evidence-source liveness checks run continuously.
- Assurance monitor loop: first Persistence PASS can move accepted Functions to monitored.
- Incident propagation: failed detector freshness or health events produce `INC-*`.
- Function catalog: monitored Functions are queryable with trust, lineage, latest Verification Reports, and detector status.

Exit criteria:

- At least one Function reaches `monitored` through Fidelity PASS plus active Persistence monitoring.
- Persistence silence is treated as regression.
- Monitored state is backed by fresh detector evidence.

## Goal 5: Implement Amendment Loop

A failed Function execution can birth a successor Function without collapsing
lineage.

Epics:

- Failure signalization: failed Fidelity/Persistence outcomes become typed Signals and Pressures.
- Amendment proposal: Factory produces successor IS/ES/FORM from failure evidence.
- Versioned identity: amendment creates new Function identity, not a second ES on the same Function.
- Re-dispatch: successor FORM goes to Gas City with `factory-attempt > 1` and `amendment-of`.
- Loop guard: MaxAmendmentDepth and Coherence failures halt and escalate.

Exit criteria:

- Known failure produces IS-V2/ES-V2/FORM-V2/FN-V2.
- FN-V1 is superseded only after successor evidence passes.
- Full lineage from original Pressure to successor Function is queryable.

## Goal 6: Operationalize The Factory

Turn bootstrap evidence into repeatable operating posture.

Epics:

- Gas City hosting: dev/CI/VPS/k8s deployment path is pinned and smoke-tested.
- Event bridge expansion: health, stall, crash, convergence, and completion events are ingested.
- Operational Pressures: recurring incidents produce new Pressures.
- Release discipline: commits cite Function IDs; PRs include Verification Report, test, and audit evidence.
- Spec hardening: thin specs such as `IS-GC-DISPATCH-WIRE` gain detector-backed invariants where appropriate.

Exit criteria:

- Recurring operational failure creates at least one operational Pressure.
- Multiple Functions have verified/monitored/amended lifecycle evidence.
- Production-like Gas City environment passes the smoke corpus.

## Immediate Epic Order

1. Finish IP-1 live evidence: real dispatch smoke, Bead labels, dispatch_log proof.
2. Harden `IS-GC-DISPATCH-WIRE`: move persistent obligations into `## Constraints` so invariants and validations are generated.
3. Build IP-3/IP-4 webhook plus Fidelity Verification Report path.
4. Add lifecycle transition guard for `produced -> accepted`.
5. Start Persistence Verification path only after Fidelity intake is real.
