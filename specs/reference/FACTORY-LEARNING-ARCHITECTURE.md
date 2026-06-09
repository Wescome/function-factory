# Factory Learning Architecture

**Status:** Foundation implemented; active influence deferred
**Source prompt:** `/Users/wes/Downloads/DREAM-DO-SPEC.md`
**Disposition:** Redesign. The source Dream DO spec is directionally useful,
but it assumes runtime surfaces the current repo does not yet have. This design
starts from the current Factory implementation and grows toward Dream DO only
after the evidence substrate is proven.

## Executive Decision

Do not start by adding an active Dream Durable Object to the production
pipeline.

Start with a **Learning Evidence Substrate**:

1. Capture run transcripts and observations from the current pipeline.
2. Store them as evidence, not decisions.
3. Derive template candidates in dry-run/read-only mode.
4. Route any proposed changes through explicit governance apply paths.
5. Add a Dream Durable Object later as a consolidator after evidence capture is
   proven.

This gets the Factory learning without creating a premature second control
loop.

## Implementation Status

Completed foundation:

- Phase 0 reference adoption
- Phase 0.5 learning boundary decision in `DECISIONS.md`
- Phase 1 `@factory/learning` schemas for transcripts, observations,
  candidates, usage, routing observations, proposals, promotion requests,
  consolidation reports, and mutation journal entries
- Phase 2 pure transcript normalization, observation derivation, candidate
  detection, routing observation derivation, and deterministic storage keys
- Phase 3 Arango learning collections and indexes in `infra/arangodb/init-db.ts`
- Phase 4 disabled-by-default terminal transcript capture in `ff-pipeline`
- Phase 5 optional factual observation writes when explicitly enabled

Deliberately deferred:

- Dream DO Worker
- template warm-start influence
- template promotion application
- routing proposal application
- learning graph participation
- production rollout with learning enabled

## Design Goals

- Preserve active pipeline authority: Verification and lifecycle logic stay in
  `ff-pipeline`, the current Verification worker, and existing runtime modules.
- Make learning durable and inspectable in Arango.
- Avoid Workflow-to-Durable-Object deadlock patterns.
- Keep Dream optional; the pipeline must work if learning is disabled.
- Use current ontology language: Intent Specification, Executable
  Specification, Verification, Execution Packet, Evidence, Lifecycle.
- Treat routing/model changes as proposals, never direct Dream mutations.
- Defer LLM consolidation until deterministic evidence logic works.

## Non-Goals

- No production Dream deployment before managed Arango is restored.
- No direct Worker secret mutation from Dream.
- No template injection into active compilation in the first release.
- No Dream-owned routing application.
- No rollback model based on Arango transaction IDs.
- No new artifact prefixes in production before an ontology decision.
- No new required Worker binding for the pipeline rollout.

## System Boundary

```text
Active Factory Runtime
  - executes pipeline
  - runs Verification
  - performs repair loops
  - owns lifecycle transitions
  - emits transcripts and observations best-effort

Learning Evidence Substrate
  - stores run transcripts
  - stores learning observations
  - derives template candidates
  - summarizes routing observations
  - never changes active execution

Dream Consolidator, later
  - consumes learning evidence
  - consolidates candidate templates
  - maintains mutation journals
  - exposes review/status APIs
  - never bypasses Verification

Governance / Operator
  - approves template promotion
  - applies routing changes through an explicit apply interface
  - pins, retires, or restores learning artifacts
```

## Architecture Layers

### Layer 1: Terminal Run Transcript Capture

The transcript is the canonical learning input. It is captured at every
terminal return path of `FactoryPipeline.run()`, not only after successful
synthesis.

The implementation contract is:

```ts
captureLearningTranscript(input, terminalResult, context): PipelineResult
```

The helper always returns the original `terminalResult`. It may validate and
write a transcript, but it must never change the pipeline verdict, throw into
Workflow control flow, retry unboundedly, or call a Durable Object from
`step.do()`.

Every terminal path must pass through the helper:

- rejected signal
- intent violation
- Coherence Verification failure
- compile incomplete
- Instruction Tuning blocked
- synthesis timeout
- synthesis success

### Layer 2: Learning Observations

Observations are facts derived from transcripts. They are not judgments unless
explicitly marked as derived.

Examples:

- zero-repair completion
- Verification block
- repair after a compiler transformation
- repeated atom failure shape
- model/role latency outlier
- template candidate usage result

False-positive and false-negative labels are not written during active
Verification. The first write is factual, such as `verification_block` or
`verification_pass`. Later adjudication may derive false-positive or
false-negative classifications with explicit rationale.

### Layer 3: Template Candidates

Template candidates are proposed warm-start structures derived from repeated
zero-repair transcripts.

They are not active templates.

Candidate states:

- `candidate`
- `pending_approval`
- `approved`
- `retired`

Promotion from `candidate` to `approved` is operator/governance controlled.
Even approved templates remain warm-start hints. They never replace compiler
logic and never bypass Verification.

### Layer 4: Routing Observations

Routing observations summarize model/task outcomes. They do not update
`@factory/task-routing` or `config_routing`.

Dream/learning may emit a routing proposal only after enough evidence exists.
Application requires an explicit governance apply path.

### Layer 5: Dream Consolidator

Dream DO becomes useful only after Layers 1-4 exist.

Dream DO responsibilities:

- read transcripts and observations
- consolidate candidate templates
- maintain template lifecycle
- produce consolidation reports
- write mutation journal entries before mutations
- expose status and dry-run consolidation

Dream DO does not own:

- active pipeline execution
- Verification
- lifecycle promotion
- direct routing application
- secret management

## Learning Object Classification

Durable schemas must not be written until this classification is accepted in a
Phase 0.5 architecture decision.

| Object | Initial status | Artifact decision |
| --- | --- | --- |
| `RunTranscript` | Arango collection document | Evidence adjunct, not a canonical artifact family yet |
| `LearningObservation` | Arango collection document | Factual observation; map to a Signal or Observation family only after decision |
| `TemplateCandidate` | Arango collection document | Governance-controlled candidate, not a compiler artifact |
| `TemplateUsage` | Arango collection document | Telemetry document |
| `RoutingObservation` | Arango collection document | Telemetry/evidence document |
| `RoutingProposal` | Governance proposal document | Cannot mutate routing config directly |
| `TemplatePromotionRequest` | Governance proposal document | Cannot activate a candidate directly |
| `ConsolidationReport` | Arango collection document | Review evidence; may later become a Verification adjunct |
| `MutationJournalEntry` | Audit evidence document | Required before any learning-owned mutation |

Every learning document must carry `source_refs`. Derived fields must include
explicitness and rationale.

## Transcript Source Map

The first schema must describe where every transcript field comes from and what
happens when the source is unavailable.

| Field | Source | Required phase | Absent-value behavior |
| --- | --- | --- | --- |
| `run_id` | Workflow instance ID or pipeline invocation payload | Phase 4 | Required; reject transcript if missing |
| `signal_id` | Pipeline input / persisted Signal reference | Phase 4 | Nullable only when terminal state occurs before Signal materialization; include rationale |
| `pressure_id` | Pipeline run state or persisted Pressure reference | Phase 4 | Nullable when upstream derivation did not happen; include terminal-state rationale |
| `capability_id` | Pipeline run state or persisted Capability reference | Phase 4 | Nullable when upstream derivation did not happen; include terminal-state rationale |
| `proposal_id` | Pipeline run state or persisted Function Proposal reference | Phase 4 | Nullable when proposal creation did not happen; include rationale |
| `intent_specification_id` | Pipeline run state or persisted Intent Specification reference | Phase 4 | Nullable before Intent Specification creation; include rationale |
| `executable_specification_id` | Compile result / persisted Executable Specification reference | Phase 4 | Nullable for compile-incomplete and earlier terminal states |
| `execution_packet_id` | Instruction Tuning result / persisted packet reference | Phase 6+ | Nullable until packet emission exists for the terminal path |
| `execution_packet_hash` | Certified packet hash | Phase 6+ | Nullable with packet ID absence rationale |
| `verification_results` | Coherence Verification report and later normalized Verification adapters | Phase 4 | Empty only when no Verification executed; include terminal-state rationale |
| `repair_count` | Synthesis result, coordinator summary, or atom result aggregation | Phase 4 | `0` for pre-synthesis terminal states with rationale |
| `repair_log` | Coordinator state / atom result summaries / future output reliability ledger | Phase 5+ | Initially summary-only; absent before repair loop exists |
| `atom_results` | Pipeline `PipelineResult.atomResults` | Phase 4 | Empty for pre-synthesis terminal states |
| `model_role_telemetry` | Routing history, coordinator state, or memory episodic records | Phase 6+ | Absent until source exists; do not fabricate |
| `final_verdict` | Terminal result wrapper | Phase 4 | Required; reject transcript if missing |
| `source_refs` | All upstream artifact IDs used to produce the terminal result | Phase 4 | Required; reject transcript if empty except structurally justified Signal origin cases |

## Idempotent Write Contract

Best-effort writes still need deterministic behavior because Cloudflare
Workflow replays can repeat a terminal step.

Learning writes must use:

- deterministic `_key` values derived from stable identity, for example
  `run:${run_id}` or `observation:${run_id}:${kind}:${hash}`
- UPSERT/update semantics, not plain create-only POST
- bounded timeout via an integration-local deadline
- caught/logged failures that never alter the pipeline verdict
- duplicate replay handling as a success condition
- validation before storage
- no unbounded retry loop

`ArangoClient.save()` is not sufficient by itself for Phase 4 learning writes
because it creates by POST and throws on conflict. The first implementation
needs a retry-safe learning storage helper or an extension to the Arango client
with explicit UPSERT semantics.

## Arango Collections, Graph, And Indexes

Initial collections:

- `learning_run_transcripts`
- `learning_observations`
- `learning_template_candidates`
- `learning_template_usage`
- `learning_routing_observations`

Later Dream collections:

- `learning_consolidation_reports`
- `learning_mutation_journal`
- `learning_routing_proposals`
- `learning_template_promotion_requests`

Phase 1-6 graph decision:

- Learning documents use `source_refs` only.
- They do not write `lineage_edges`.
- They do not participate in `lineage_graph`.

Graph participation requires a separate migration decision because the current
`lineage_graph` edge definitions only cover existing artifact/report
collections. A later migration must either:

1. add learning collections to the existing graph with explicit allowed
   `_from`/`_to` pairs and rollback, or
2. create a separate `learning_graph` whose edges stay outside canonical
   artifact lineage until promoted.

Required indexes:

- `learning_run_transcripts`: `run_id`, `final_verdict`, `created_at`,
  `source_refs[*]`
- `learning_observations`: `run_id`, `kind`, `created_at`, `source_refs[*]`
- `learning_template_candidates`: `state`, `template_candidate_id`,
  `created_at`, `source_refs[*]`
- `learning_template_usage`: `template_candidate_id`, `run_id`, `created_at`
- `learning_routing_observations`: `task_kind`, `model`, `created_at`,
  `source_refs[*]`
- proposal/request collections: `state`, `created_at`, `approved_by`,
  `applied_at`

No TTL is applied to canonical learning evidence in v1. TTL may be used later
only for derived cache summaries that can be reconstructed.

## Repository Shape

First implementation should add a package, not a Worker:

```text
packages/learning/
  package.json
  tsconfig.json
  src/
    types.ts
    transcript.ts
    observations.ts
    candidates.ts
    routing-observations.ts
    storage-keys.ts
    mutation-journal.ts
```

Later implementation may add:

```text
workers/dream-do/
  package.json
  tsconfig.json
  wrangler.jsonc
  src/
    index.ts
    status.ts
    consolidate.ts
    storage.ts
    alarm.ts
```

## Governance Approval Interfaces

Phases that activate templates or routing are blocked until these interfaces
exist.

### TemplatePromotionRequest

Minimum fields:

- `request_id`
- `template_candidate_id`
- `requested_by`
- `requested_at`
- `state`: `pending`, `approved`, `rejected`, `applied`, `rolled_back`
- `evidence_refs`
- `reviewer`
- `reviewed_at`
- `decision_rationale`
- `apply_target`
- `mutation_batch_id`
- `rollback_ref`
- `source_refs`

### RoutingProposal

Minimum fields:

- `proposal_id`
- `task_kind`
- `current_model`
- `proposed_model`
- `evidence_window`
- `evidence_summary`
- `requested_by`
- `state`: `pending`, `approved`, `rejected`, `applied`, `rolled_back`
- `reviewer`
- `decision_rationale`
- `apply_target`
- `mutation_batch_id`
- `rollback_ref`
- `source_refs`

Approval does not imply application. Application writes through a typed
operator/governance path that records:

- actor
- approved request/proposal ID
- exact target collection/key or hot-config key
- before image
- after image
- verification evidence
- rollback record

Dream never writes routing config directly.

## Feature Flags And Runtime Contract

The evidence substrate must be disabled by default until the storage path is
tested against the active runtime.

Required flags:

- `LEARNING_ENABLED=false`
- `LEARNING_OBSERVATIONS_ENABLED=false`
- `LEARNING_WRITE_TIMEOUT_MS=500`
- `LEARNING_WARMSTART_ENABLED=false`
- `DREAM_DO_ENABLED=false`

Phase 4 must not require a new Worker binding. Dream DO bindings are introduced
only in the later Worker phase and must not be called from Workflow `step.do()`.

## Safe Integration Pattern

Workflow steps must not call Dream DO directly.

Allowed patterns:

1. Pipeline writes transcript/observation directly to Arango through a
   bounded, caught storage helper.
2. Pipeline sends a queue message; queue consumer runs in a fresh Worker
   context and calls Dream DO.

First release should use direct Arango writes for transcript/observation
capture because it is simpler and does not introduce new DO coupling.

## Mutation And Rollback

Dream consolidation cannot use an Arango transaction ID as rollback.

Any mutating Dream phase must write an append-only mutation journal:

- mutation batch ID
- actor
- affected collection/key
- before image
- after image
- source_refs
- timestamp

Rollback is a compensating write from before images. It is explicit and
auditable.

Until this exists, consolidation is read-only.

## Learning Safety Detectors

Every invariant has a detector. These detectors are required before active
warm-start or routing influence.

| Detector | Evidence source | Direct rule | Regression policy |
| --- | --- | --- | --- |
| `LEARN-DETECT-TRANSCRIPT-WRITE-FAILURE` | Pipeline completions and `learning_run_transcripts` | Completion count and transcript count match within configured lag | Disable learning writes and open incident |
| `LEARN-DETECT-MALFORMED-TRANSCRIPT` | Transcript validation failures | Invalid transcript count is zero outside test fixtures | Disable observation derivation |
| `LEARN-DETECT-DUPLICATE-REPLAY` | Transcript keys and Workflow replay logs | Duplicate replay resolves to one stable document | Treat conflict as storage bug if contents diverge |
| `LEARN-DETECT-NO-VERDICT-MUTATION` | Pipeline result before/after capture helper | Learning helper returns byte-equivalent terminal verdict | Block rollout |
| `LEARN-DETECT-MUTATION-JOURNAL-COMPLETE` | Mutation journal and proposal/request states | Every applied mutation has before/after image and actor | Freeze apply path and require rollback review |
| `LEARN-DETECT-WARMSTART-REGRESSION` | A/B dry-run evidence with and without warm-start | Warm-start does not increase Verification failure rate or repair count | Disable `LEARNING_WARMSTART_ENABLED` |
| `LEARN-DETECT-ROUTING-PROPOSAL-EVIDENCE` | Routing observations and proposals | Proposal evidence window meets minimum sample and quality threshold | Reject proposal |
| `LEARN-DETECT-ARANGO-WRITE-DRIFT` | Arango write logs and collection counts | Write failures stay below configured threshold | Disable learning writes |
| `LEARN-DETECT-NO-DREAM-IN-WORKFLOW` | Static test over Worker source | No Dream DO call exists inside Workflow `step.do()` | Block Dream rollout |

## Implementation Sequence

### Phase 0: Reference Adoption

- Add this architecture document.
- Index it from `specs/reference/README.md`.
- No runtime changes.

### Phase 0.5: Learning Boundary Decision

- Decide whether learning documents are evidence adjuncts, canonical artifacts,
  or a separate learning collection family.
- Decide collection names and graph participation.
- Decide whether proposals/requests receive canonical artifact IDs.
- Record the decision before schemas or migrations.

### Phase 1: Learning Package Schemas

- Add `@factory/learning`.
- Define schemas for:
  - `RunTranscript`
  - `LearningObservation`
  - `TemplateCandidate`
  - `TemplateUsage`
  - `RoutingObservation`
  - `ConsolidationReport`
  - `MutationJournalEntry`
  - `RoutingProposal`
  - `TemplatePromotionRequest`
- Add validation tests.

### Phase 2: Pure Derivation

- Build transcript normalization helpers.
- Build observation extraction helpers.
- Build template-candidate detection from zero-repair transcripts.
- Build routing observation summarization.
- No Arango dependency in pure derivation tests.

### Phase 3: Arango Provisioning

- Add learning collections and indexes to `infra/arangodb/init-db.ts`.
- Do not add learning graph edges yet.
- Do not run against production until managed Arango is restored.

### Phase 4: Terminal Transcript Writes

- Add terminal capture helper to every `FactoryPipeline.run()` return path.
- Use deterministic keys and UPSERT semantics.
- Bound timeout and catch/log failures.
- Failure logs only; no verdict change.
- Tests prove pipeline passes when learning write fails.

### Phase 5: Observation Writes

- Add observation extraction from completed run transcript.
- Store facts only.
- No false-positive/false-negative classification yet.

### Phase 6: Read-Only Candidate Detection

- Detect candidates from existing transcripts.
- Persist candidate documents as `candidate`.
- Do not inject into compiler.

### Phase 7: Dream DO Scaffold

- Add Worker only after evidence substrate works.
- Expose `/health`, `/status`, `/consolidation/dry-run`.
- No alarm mutation.
- No pipeline binding required.
- No Workflow `step.do()` calls to Dream.

### Phase 8: Mutation Journal

- Add append-only mutation journal.
- Add compensating rollback tests.
- Only then allow template lifecycle mutations.

### Phase 9: Operator-Controlled Promotion

- Blocked until `TemplatePromotionRequest` approval and apply paths exist.
- Approved templates are still warm-start hints.
- Verification remains authoritative.

### Phase 10: Warm-Start Integration

- Add optional warm-start read.
- Feature flag disabled by default.
- Require A/B dry-run evidence with and without warm-start.
- Tests prove all Verification still runs and failures degrade candidate usage.

### Phase 11: Routing Proposals

- Blocked until `RoutingProposal` approval and apply paths exist.
- Emit routing proposals from observations.
- Governance applies or rejects.
- Dream never writes routing config directly.

## Test Matrix

| Phase | Required tests |
| --- | --- |
| 1 | Schema accepts valid documents, rejects malformed documents, enforces `source_refs` |
| 2 | Pure derivation is deterministic, side-effect free, and handles absent optional fields |
| 3 | Init creates collections and indexes idempotently; no graph edges are added |
| 4 | Learning disabled, Arango down, write timeout, write conflict, malformed transcript, duplicate Workflow replay, every terminal result captured, no verdict mutation |
| 5 | Observation derivation stores facts only and rejects unsupported classifications |
| 6 | Candidate detection is read-only and cannot affect compiler output |
| 7 | Dream health/status works; static test rejects Dream call from Workflow `step.do()` |
| 8 | Mutation journal requires before/after images and supports compensating rollback |
| 9 | Promotion request approve/reject/apply/rollback state machine |
| 10 | Warm-start disabled by default, A/B dry-run comparison, Verification regression disables warm-start |
| 11 | Routing proposal evidence threshold, approval required, direct config mutation rejected |

## Rollout Criteria

Production rollout requires:

- real managed Arango restored
- production health green without temporary bridge
- collection provisioning complete
- learning disabled-by-default verified
- terminal capture tests passing
- idempotent storage tests passing
- detector tests passing for active phases
- `pnpm -r typecheck`
- `pnpm -r test`
- `pnpm audit:docs`
- `pnpm audit:ontology`
- dry-run pipeline smoke with no PR side effects

## Review Findings

### EA Review

The EA review accepted the architecture direction: start with evidence capture,
not active Dream DO. It flagged four blocking gaps now addressed in this
revision:

- learning object classification must exist before durable schemas
- graph participation must be explicit because `lineage_graph` does not yet
  include learning collections
- governance cannot be described as a vague operator path; proposal, approval,
  application, audit, and rollback states must be typed
- learning invariants need detectors before active influence

It also required warm-start to fail closed and be backed by A/B dry-run evidence.

### SE Review

The SE review found the original draft under-specified for the live runtime. It
flagged six blocking gaps now addressed in this revision:

- terminal transcript capture must cover every `FactoryPipeline.run()` return
  path, not only successful completion
- transcript fields need a source map because current `PipelineResult` does not
  expose every desired field
- best-effort Arango writes need deterministic keys, UPSERT semantics,
  bounded timeout, and caught failure behavior
- learning collections cannot casually write `lineage_edges`
- governance/hot-config apply paths do not yet exist as complete interfaces
- rollout criteria need learning-specific negative tests

The review also confirmed that the package-first split is the correct first
implementation shape.
