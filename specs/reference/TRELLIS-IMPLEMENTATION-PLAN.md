# Trellis Implementation Plan

**Status:** Implemented through packet runtime and Verification integration
**Date:** 2026-05-10
**Source references:** `TRELLIS-EXECUTION-PACKET.md`,
`INSTRUCTION-TUNING-SPEC.md`, `DOMAIN-FACTORY-KERNEL.md`,
`TRELLIS-REFACTOR-FIRST-CUT.md`

This plan implements Trellis as the packet-driven harness layer below the
Factory compiler. It deliberately avoids physical storage/path renames until
the Trellis Execution Packet and Instruction Tuning path are implemented,
verified, and audited.

Implementation note, 2026-05-10: phases 1-9 are now materialized in active
schemas, compiler, worker runtime, packet persistence, and Verification
lineage. Phase 10 hardening is represented by the focused test/audit commands
listed in the workspace memory and should be rerun before any physical
storage/path/package refactor.

## Goal

Move runtime execution from raw Executable Specification consumption to a
Trellis Execution Packet contract:

```
Executable Specification
  -> selected ArchitectureCandidate
  -> Runtime admission
  -> Instruction Tuning
  -> TEP-* Trellis Execution Packet
  -> Trellis runtime execution
  -> TrellisExecutionResult
  -> Fidelity / Persistence Verification
  -> Lifecycle decision
```

## Non-Goals

- No `WG-*`, `specs/workgraphs`, or `specs_workgraphs` storage migration.
- No package rename.
- No model fine-tuning.
- No lifecycle promotion inside Instruction Tuning or Trellis execution.
- No coding substrate terms in Factory kernel fields.
- No compatibility aliases for removed active runtime/compiler APIs.

## Implementation Principles

1. Schema before runtime.
2. Fail-closed before happy path.
3. Deterministic packet hash before persistence.
4. Packet-only runtime boundary before broader Trellis refactor.
5. Evidence and lineage before lifecycle movement.
6. Audits updated in the same slice that introduces a new invariant.

## Phase 0: Audit Baseline

Purpose: freeze the current hard-cut boundary before adding Trellis packet code.

Work:

- Add audit expectations for the two Trellis specs and this plan.
- Confirm active source has no removed runtime/compiler API names.

Acceptance:

- `pnpm audit:docs`
- `pnpm audit:ontology`
- `git diff --check`

## Phase 1: Packet Schema Foundation

Purpose: make the Trellis Execution Packet a first-class typed Factory artifact.

Files likely affected:

- `packages/schemas/src/lineage.ts`
- `packages/schemas/src/trellis-execution-packet.ts`
- `packages/schemas/src/trellis-execution-packet.test.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/package.json`
- `scripts/audit-ontology-hard-cut.mjs`

Work:

- Add `TEP` to artifact ID support.
- Add Zod schemas for:
  - `TrellisExecutionPacket`
  - `InstructionTuningProvenance`
  - `TrellisRuntimeProfile`
  - `DomainAdapterBinding`
  - `TrellisRoleInstruction`
  - `TrellisRoleGraph`
  - `TrellisContextBundle`
  - `TrellisToolPolicy`
  - `EvidenceRequirement`
  - `TrellisRepairPolicy`
  - `LifecyclePathway`
  - `TrellisExecutionResult`
  - `TrellisPacketAudit`
- Export the schema module.
- Add parser tests for valid packet and required-field failures.

Negative tests:

- rejects missing `TEP-*` ID
- rejects missing `source_refs`
- rejects missing selected ArchitectureCandidate ID
- rejects missing runtime admission ID
- rejects write/execute tool binding with empty scope
- rejects evidence requirement with no producing role
- rejects lifecycle pathway with unsupported Verification requirement

Acceptance:

- `pnpm --filter @factory/schemas test -- src/trellis-execution-packet.test.ts`
- `pnpm --filter @factory/schemas typecheck`
- `pnpm audit:ontology`
- `git diff --check`

## Phase 2: Canonical Hashing And Packet Certification

Purpose: prove packet determinism before any runtime uses a packet.

Files likely affected:

- `packages/schemas/src/trellis-canonical-json.ts`
- `packages/schemas/src/trellis-canonical-json.test.ts`
- `packages/schemas/src/trellis-execution-packet.ts`
- `packages/schemas/src/trellis-execution-packet.test.ts`

Work:

- Implement canonical JSON serialization:
  - UTF-8 JSON
  - Unicode NFC normalization
  - lexicographic object keys
  - stable array ordering by declared keys
  - excludes `instructionTuning.generatedAt` from packet hash
- Implement SHA-256 packet hash helper.
- Implement packet certification helper that checks:
  - all role graph refs resolve
  - all tool bindings reference existing roles
  - all evidence producers exist
  - all derived fields have source coverage
  - no unmapped Executable Specification refs remain
  - packet hash matches audit hash

Negative tests:

- permuted input order yields the same hash
- different semantic content yields a different hash
- mismatched `outputPacketHash` fails
- stale `audit.packetHash` fails
- missing source coverage fails
- unmapped Executable Specification ref fails

Acceptance:

- `pnpm --filter @factory/schemas test -- src/trellis-canonical-json.test.ts src/trellis-execution-packet.test.ts`
- `pnpm --filter @factory/schemas typecheck`
- `pnpm audit:ontology`
- `git diff --check`

## Phase 3: Instruction Tuning Pure Module

Purpose: add a pure compiler transformation that emits or blocks packet
creation without touching runtime.

Files likely affected:

- `packages/compiler/src/instruction-tuning.ts`
- `packages/compiler/src/instruction-tuning.test.ts`
- `packages/compiler/src/types.ts`
- `packages/compiler/src/index.ts`

Work:

- Add `InstructionTuningResult` union:
  - `{ status: "emitted"; packet; diagnostics }`
  - `{ status: "blocked"; diagnostics; uncertaintyEntries }`
- Add deterministic `TEP-*` ID derivation.
- Map Executable Specification + ArchitectureCandidate + runtime admission +
  Domain Adapter Contract + TrellisRuntimeProfile into a packet.
- Return blocking diagnostics for missing or unmappable inputs.
- Do not integrate into `compile()` yet.

Negative tests:

- missing adapter contract blocks
- missing selected ArchitectureCandidate blocks
- missing runtime admission blocks
- role graph cycle blocks
- unmapped Executable Specification node blocks
- tool need with no tool binding blocks
- validation with no evidence path blocks
- blocked result never contains packet

Acceptance:

- `pnpm --filter @factory/compiler test -- src/instruction-tuning.test.ts`
- `pnpm --filter @factory/compiler typecheck`
- `pnpm audit:ontology`
- `git diff --check`

## Phase 4: Runtime Profile And Coding Adapter Fixture

Purpose: give Instruction Tuning concrete inputs without hard-coding coding
substrate terms into the kernel.

Files likely affected:

- `packages/schemas/src/coding-domain-adapter.ts`
- `packages/schemas/src/coding-domain-adapter.test.ts`
- `packages/compiler/src/instruction-tuning.test.ts`
- `workers/ff-pipeline/src/coordinator/*` test fixtures

Work:

- Add a TrellisRuntimeProfile fixture for current coding execution.
- Bind current role/tool/memory/policy catalogs as Trellis runtime capabilities.
- Bind coding adapter effectors and evidence sources through
  `DomainAdapterContract`.
- Keep repo, branch, diff, PR, CI, and test-result terms inside adapter-local
  fields only.

Negative tests:

- substrate term leakage in packet kernel fields fails
- coding adapter effectors missing from contract block packet emission
- runtime profile missing tool catalog blocks packet emission

Acceptance:

- `pnpm --filter @factory/schemas test -- src/coding-domain-adapter.test.ts`
- `pnpm --filter @factory/compiler test -- src/instruction-tuning.test.ts`
- `pnpm audit:ontology`
- `git diff --check`

## Phase 5: Compiler Orchestration Integration

Purpose: make the compiler produce a packet after Executable Specification
Assembly when all required tuning inputs are supplied.

Files likely affected:

- `packages/compiler/src/compile.ts`
- `packages/compiler/src/compile.test.ts`
- `packages/compiler/src/types.ts`
- `packages/compiler/src/cli.ts`
- `packages/compiler/README.md`

Work:

- Extend `CompileOptions` with optional Instruction Tuning inputs.
- Extend `CompileResult` with `instructionTuningResult`.
- When inputs are complete and Coherence Verification passed, run Instruction
  Tuning.
- When inputs are missing, preserve current compile behavior and return an
  explicit blocked/not-requested tuning result.
- CLI prints packet path/hash only when packet is emitted.

Negative tests:

- Coherence Verification failure never runs Instruction Tuning
- missing required tuning inputs returns blocked/not-requested result
- emitted packet source refs include PRD, WG, ArchitectureCandidate, runtime
  admission, and adapter contract
- packet hash is stable across deterministic compile runs

Acceptance:

- `pnpm --filter @factory/compiler test`
- `pnpm --filter @factory/compiler typecheck`
- `pnpm audit:docs`
- `pnpm audit:ontology`
- `git diff --check`

## Phase 6: Packet Persistence Surface

Purpose: persist `TEP-*` artifacts without changing deferred `WG-*` storage.

Files likely affected:

- `packages/compiler/src/compile.ts`
- `packages/compiler/src/compile.test.ts`
- `packages/artifact-validator/src/index.ts`
- `packages/artifact-validator/src/index.test.ts`
- `scripts/audit-docs.mjs`

Work:

- Choose physical storage path/collection for packets.
- Add validator support for packet artifacts.
- Ensure docs audit indexes packet files or records virtual packet refs.
- Add lineage edges from packet to Intent Specification, Executable
  Specification, ArchitectureCandidate, runtime admission, and adapter contract.

Negative tests:

- packet missing lineage refs fails validation
- packet with stale hash fails validation
- docs audit catches missing packet source refs

Acceptance:

- `pnpm --filter @factory/artifact-validator test`
- `pnpm --filter @factory/compiler test`
- `pnpm audit:docs`
- `pnpm audit:ontology`
- `git diff --check`

## Phase 7: Coordinator Packet Intake

Purpose: introduce packet-aware runtime execution without deleting current
queue paths in the same slice.

Files likely affected:

- `workers/ff-pipeline/src/coordinator/state.ts`
- `workers/ff-pipeline/src/coordinator/coordinator.ts`
- `workers/ff-pipeline/src/index.ts`
- `workers/ff-pipeline/src/queue-bridge.test.ts`
- `workers/ff-pipeline/src/coordinator/state.test.ts`
- `workers/ff-pipeline/src/coordinator/coordinator-sandbox-wiring.test.ts`

Work:

- Add parsed `TrellisExecutionPacket` to coordinator state.
- Build `DomainExecutionRequest` from packet adapter binding, not directly from
  raw Executable Specification.
- Record `packetId` and `packetHash` on DomainExecutionEvidence and runtime
  traces.
- Keep raw Executable Specification path only as an explicit transitional path
  that emits violation diagnostics.

Negative tests:

- packet intake rejects invalid packet hash
- packet intake rejects missing tool policy
- raw runtime execution path emits violation diagnostic
- evidence includes packet ID/hash
- adapter request matches packet binding

Acceptance:

- `pnpm --filter @factory/ff-pipeline test -- src/coordinator/state.test.ts src/coordinator/coordinator-sandbox-wiring.test.ts src/queue-bridge.test.ts`
- `pnpm --filter @factory/ff-pipeline typecheck`
- `pnpm audit:ontology`
- `git diff --check`

## Phase 8: Packet-Only Runtime Boundary

Purpose: enforce Trellis execution through packets.

Files likely affected:

- `workers/ff-pipeline/src/pipeline.ts`
- `workers/ff-pipeline/src/index.ts`
- `workers/ff-pipeline/src/coordinator/coordinator.ts`
- `workers/ff-pipeline/src/diagnostic-routes.test.ts`
- `scripts/audit-ontology-hard-cut.mjs`

Work:

- Queue packet payloads for synthesis instead of raw Executable Specification
  payloads.
- Make coordinator reject packet-less execution outside explicitly named
  transitional diagnostics.
- Update diagnostics to expose packet ID/hash in execution reports.
- Add ontology audit checks preventing packet-less Trellis execution in active
  source.

Negative tests:

- packet-less queue message rejected
- packet-less coordinator request rejected
- packet-less diagnostic route rejected unless named transitional
- audit fails on raw runtime execution helper reintroduction

Acceptance:

- `pnpm --filter @factory/ff-pipeline test -- src/pipeline.test.ts src/diagnostic-routes.test.ts src/queue-bridge.test.ts`
- `pnpm --filter @factory/ff-pipeline typecheck`
- `pnpm audit:ontology`
- `git diff --check`

## Phase 9: Verification Integration

Purpose: connect packet execution evidence to Fidelity and Persistence
Verification.

Files likely affected:

- `workers/ff-pipeline/src/fidelity-verification.ts`
- `workers/ff-pipeline/src/fidelity-verification.test.ts`
- `workers/ff-pipeline/src/persistence-verification.ts`
- `workers/ff-pipeline/src/persistence-verification.test.ts`
- `workers/ff-pipeline/src/lifecycle.ts`
- `workers/ff-pipeline/src/lifecycle.test.ts`

Work:

- Adapt TrellisExecutionResult into Fidelity Verification inputs.
- Preserve packet ID/hash in Verification reports.
- Distinguish Fidelity evidence from Persistence observation inputs.
- Ensure lifecycle transition checks can verify packet-derived report lineage.

Negative tests:

- Fidelity Verification rejects evidence missing packet ID/hash
- Persistence Verification rejects observation missing packet lineage
- lifecycle acceptance rejects report not tied to packet execution result
- repair attempt evidence included in Fidelity inputs

Acceptance:

- `pnpm --filter @factory/ff-pipeline test -- src/fidelity-verification.test.ts src/persistence-verification.test.ts src/lifecycle.test.ts`
- `pnpm --filter @factory/ff-pipeline typecheck`
- `pnpm audit:ontology`
- `git diff --check`

## Phase 10: Full Hardening And Refactor Checkpoint

Purpose: prove Trellis packet execution is stable enough to start physical
refactors.

Work:

- Run full workspace tests and audits.
- Search for packet-less active runtime execution.
- Search for removed runtime/compiler API names.
- Produce a physical rename readiness note if storage/path rename is still
  desired.

Acceptance:

- `pnpm -r typecheck`
- `pnpm -r test`
- `pnpm audit:docs`
- `pnpm audit:ontology`
- `git diff --check`
- active source search shows no packet-less Trellis execution path outside
  named transitional diagnostics

## Commit Strategy

Use one commit per phase unless a phase is too large, in which case split by
package boundary:

1. schemas
2. compiler
3. worker runtime
4. verification/lifecycle
5. audit/docs

Every commit must include the relevant focused tests and audit update.

## Refactor Readiness Criteria

Do not start physical storage/path/package renames until:

- `TEP-*` schema and packet persistence are implemented.
- Instruction Tuning emits deterministic packets.
- Coordinator consumes packets as the runtime authority.
- TrellisExecutionResult feeds Fidelity Verification.
- Packet ID/hash appears in runtime evidence and Verification reports.
- Ontology audit blocks packet-less active runtime execution.
- Full tests and audits pass.
