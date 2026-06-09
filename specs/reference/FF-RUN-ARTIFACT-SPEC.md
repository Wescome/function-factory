# FF-RUN-ARTIFACT-SPEC

**Document ID:** FF-RUN-ARTIFACT-SPEC  
**Date:** 2026-05-17  
**Revised:** 2026-05-18 — ontological naming, counterfactual producer, worker manifest  
**Status:** Ready for coding agent  
**Scope:** Two deliverables — (1) run artifact envelope, (2) vertical-slice integration test pattern  
**Target packages:** `packages/schemas`, `packages/harness-bridge`  
**Prerequisites:** Agent must read `.agent/AGENTS.md`, `packages/schemas/src/core.ts`, `packages/schemas/src/coverage.ts`, `packages/harness-bridge/dist/types.d.ts`, `packages/harness-bridge/dist/execute.d.ts` before writing any code.

**Existing harness-bridge capabilities (do not re-implement):**
- `harnessExecute(input)` — Stage 6 orchestrator; consumes WorkGraph + adapter, returns `ExecutionLog`
- `HarnessAdapter` interface + `DryRunAdapter` — adapter pattern already exists
- `WorkGraph`, `WorkGraphNode`, `ExecutionLog`, `ExecutionNodeRecord` — all in `@factory/schemas`

**New additions in this spec:** `RunArtifactStore`, `runHarness` wrapper, `run.ts` schemas — all additive, no existing code modified.

---

## Context

Two operationalizable takeaways emerged from analysis of the AutoGo autonomous-research codebase:

1. **Temporal run envelope.** Every Factory execution attempt must be wrapped in a structured `runs/<timestamp>_<slug>/` folder containing serialized Factory artifacts. This gives counterfactual memory: what was attempted, under what intent, what gate results were produced, what the outcome was, and what should be tried next. This is additive — it does not replace `specs/`, `coverage-reports/`, or the four-layer memory system. It adds a temporal grouping layer over one execution attempt.

2. **Vertical-slice integration test pattern.** The acceptance test shape `Given FP → And WG → When harness executes → Then trace exists, gate result exists, report exists` must be implemented as a concrete integration test suite in `packages/coverage-gates/tests/` and `packages/harness-bridge/tests/`. This validates the Stage 4–5–6 pipeline end-to-end before individual passes are populated.

---

## Deliverable 1 — Run Artifact Envelope

### 1.1 Folder structure

Every Factory run produces exactly one run folder under `runs/`:

```
runs/
  <YYYY-MM-DD>_<HHMM>_<slug>/
    00_intent/
      is.json                   # IntentSpecification (serialized from @factory/schemas IntentSpecification Zod type)
      acceptance_criteria.md    # Human-readable AC summary (generated from is.acceptanceCriteria)
      worker-manifest.json      # Which workers/models/providers were in play at run start
    01_plan/
      wg.json                   # WorkGraph (serialized from @factory/schemas WorkGraph Zod type)
      task_summary.md           # Human-readable node summary (generated from wg.json)
    02_execution/
      commands.log              # Append-only log of every tool call issued
      errors.log                # Append-only log of every error / exception
    03_traces/
      decision_trace.jsonl      # Append-only JSONL; one entry per major decision event
      provenance.json           # Lineage: source_refs + explicitness tags for this run
    04_eval/
      coherence.json            # Coherence Verification result (CoherenceVerificationReport)
      fidelity.json             # Fidelity Verification result (may be absent if run did not reach Stage 6)
      persistence.json          # Persistence Verification result (may be absent if run did not reach runtime)
    05_report/
      report.md                 # Outcome summary: intent, what ran, gate results, next actions
      counterfactuals.md        # What was NOT tried and why; what should be tried if this run failed
    artifacts/
      <generated outputs>/      # Anything the harness-bridge produced (code, specs, patches)
```

### 1.2 Naming convention

```
<YYYY-MM-DD>_<HHMM>_<slug>
```

- Timestamp in PST: `TZ="America/Los_Angeles" date +"%Y-%m-%d_%H%M"`
- Slug: kebab-case identifier derived from the IntentSpecification `id` field (e.g., `IS-worker-adapter-v2` → slug `worker-adapter-v2`)
- Full example: `2026-05-17_1430_worker-adapter-v2`

### 1.3 Schema additions — `packages/schemas/src/run.ts` (new file)

The agent must create this file. It must import from `./core` and `./coverage` — do not duplicate types.

```typescript
import { z } from 'zod'
// IntentSpecification has title + acceptanceCriteria; FunctionProposal has name + purpose + successSignals
import { IntentSpecification, FunctionProposal, WorkGraph } from './core'
// Use gate-specific report types — CoverageReport does not exist in schemas
import {
  CoherenceVerificationReport,
  FidelityVerificationReport,
  PersistenceVerificationReport,
} from './coverage'

// ── Decision trace entry ─────────────────────────────────────────────────────

export const DecisionTraceEntry = z.object({
  ts: z.string().datetime(),           // ISO-8601 timestamp
  run_id: z.string(),
  stage: z.enum(['intent', 'plan', 'execution', 'eval', 'report']),
  event: z.string(),                   // Machine-readable event name, e.g. "coherence.pass"
  detail: z.string(),                  // Human-readable one-line description
  evidence: z.array(z.string()),       // File paths or ref IDs that support this entry
})
export type DecisionTraceEntry = z.infer<typeof DecisionTraceEntry>

// ── Counterfactual entry ─────────────────────────────────────────────────────
// Emitted by: compiler (rejected WorkGraph structures), dispatcher (model_candidate_skipped,
// branch_not_taken, retry_budget_exhausted), gate evaluator (gate_early_exit),
// watchdog (watchdog_terminated). Caller: appendCounterfactual().

export const CounterfactualClass = z.enum([
  'model_candidate_skipped',   // tool-capability-probe failed; fell back to next candidate
  'stage_branch_not_taken',    // harness declared conditional branch; condition was false
  'retry_budget_exhausted',    // no more retries; proceeding without this stage's output
  'gate_early_exit',           // verification gate aborted before all checks
  'watchdog_terminated',       // watchdog force-completed before stage could run
  'compiler_alternative_rejected', // compiler considered and rejected an alternative WG structure
])
export type CounterfactualClass = z.infer<typeof CounterfactualClass>

export const CounterfactualEntry = z.object({
  ts: z.string().datetime(),
  run_id: z.string(),
  class: CounterfactualClass,
  what: z.string(),   // what was not tried
  why: z.string(),    // why it was skipped
})
export type CounterfactualEntry = z.infer<typeof CounterfactualEntry>

// ── Worker manifest ──────────────────────────────────────────────────────────
// Records which workers, models, and providers were active at run start.
// Enables reproducibility: a future run can declare the same manifest to
// replicate conditions. Written once to 00_intent/worker-manifest.json.

export const WorkerManifestEntry = z.object({
  name: z.string(),            // logical worker name, e.g. "pi"
  model: z.string(),           // model identifier, e.g. "openrouter/openai/gpt-5.4"
  provider: z.string(),        // provider key, e.g. "openrouter"
  baseUrl: z.string(),         // resolved base URL, e.g. "https://api.ofox.ai/v1"
  version: z.string().optional(), // container image hash or worker version ID
  candidates: z.array(z.string()).optional(), // ordered fallback models if primary fails
})
export type WorkerManifestEntry = z.infer<typeof WorkerManifestEntry>

export const WorkerManifest = z.object({
  run_id: z.string(),
  recorded_at: z.string().datetime(),
  workers: z.array(WorkerManifestEntry),
})
export type WorkerManifest = z.infer<typeof WorkerManifest>

// ── Run provenance ────────────────────────────────────────────────────────────

export const RunProvenance = z.object({
  run_id: z.string(),
  is_id: z.string(),                   // IntentSpecification.id (IS-*)
  fp_id: z.string().optional(),        // FunctionProposal.id (FP-*) — upstream pressure
  wg_id: z.string().optional(),        // WorkGraph.id (absent if Coherence Verification blocked)
  source_refs: z.array(z.string()),    // Lineage: upstream artifact IDs
  explicitness: z.enum(['stated', 'derived', 'assumed']),
  parent_run_id: z.string().optional(), // If this is a retry of a prior run
})
export type RunProvenance = z.infer<typeof RunProvenance>

// ── Run manifest ─────────────────────────────────────────────────────────────
// Written once at run creation; updated only to record terminal status.

export const RunStatus = z.enum([
  'running',
  'coherence_blocked',    // Coherence Verification failed
  'fidelity_blocked',     // Fidelity Verification failed
  'persistence_blocked',  // Persistence Verification failed
  'completed',
  'failed',
])
export type RunStatus = z.infer<typeof RunStatus>

export const RunManifest = z.object({
  run_id: z.string(),
  slug: z.string(),
  created_at: z.string().datetime(),
  completed_at: z.string().datetime().optional(),
  status: RunStatus,
  is_id: z.string(),                   // IntentSpecification.id
  fp_id: z.string().optional(),        // FunctionProposal.id (may be absent for exploratory runs)
  wg_id: z.string().optional(),
})
export type RunManifest = z.infer<typeof RunManifest>
```

Export all from `packages/schemas/src/index.ts`.

### 1.4 RunArtifactStore — `packages/harness-bridge/src/run-artifact-store.ts` (new file)

```typescript
// RunArtifactStore: local-filesystem implementation.
// No remote storage. No database. No LLM provider coupling.
// All writes are synchronous-safe (no concurrent writes to same run expected).

import { IntentSpecification, WorkGraph } from '@factory/schemas'
import {
  CoherenceVerificationReport,
  FidelityVerificationReport,
  PersistenceVerificationReport,
} from '@factory/schemas'
import {
  DecisionTraceEntry, CounterfactualEntry, WorkerManifest,
  RunManifest, RunProvenance, RunStatus,
} from '@factory/schemas'

export interface RunArtifactStore {
  /** Create the run folder and write the initial manifest. Returns run_id. */
  createRun(is: IntentSpecification, parentRunId?: string): Promise<string>

  /** Write or overwrite 00_intent/is.json, generate acceptance_criteria.md from is.acceptanceCriteria */
  writeIntent(runId: string, is: IntentSpecification): Promise<void>

  /** Write 00_intent/worker-manifest.json — call once at run start */
  writeWorkerManifest(runId: string, manifest: Omit<WorkerManifest, 'run_id'>): Promise<void>

  /** Write or overwrite 01_plan/wg.json and generate task_summary.md */
  writePlan(runId: string, wg: WorkGraph): Promise<void>

  /** Append one line to 02_execution/commands.log */
  appendCommandLog(runId: string, line: string): Promise<void>

  /** Append one line to 02_execution/errors.log */
  appendErrorLog(runId: string, line: string): Promise<void>

  /** Append one entry to 03_traces/decision_trace.jsonl */
  appendDecisionTrace(runId: string, entry: Omit<DecisionTraceEntry, 'run_id'>): Promise<void>

  /**
   * Append one entry to 05_report/counterfactuals (internal JSONL).
   * Called by: compiler on rejected WG alternatives, dispatcher on model_candidate_skipped /
   * branch_not_taken / retry_budget_exhausted, gate evaluator on gate_early_exit,
   * watchdog on watchdog_terminated.
   * Rendered to counterfactuals.md at closeRun().
   */
  appendCounterfactual(runId: string, entry: Omit<CounterfactualEntry, 'run_id'>): Promise<void>

  /** Write or overwrite 03_traces/provenance.json */
  writeProvenance(runId: string, provenance: Omit<RunProvenance, 'run_id'>): Promise<void>

  /** Write 04_eval/coherence.json */
  writeCoherenceResult(runId: string, report: CoherenceVerificationReport): Promise<void>

  /** Write 04_eval/fidelity.json */
  writeFidelityResult(runId: string, report: FidelityVerificationReport): Promise<void>

  /** Write 04_eval/persistence.json */
  writePersistenceResult(runId: string, report: PersistenceVerificationReport): Promise<void>

  /** Write or overwrite 05_report/report.md */
  writeReport(runId: string, markdown: string): Promise<void>

  /** Write an artifact file under artifacts/<filename> */
  writeArtifact(runId: string, filename: string, content: string): Promise<void>

  /**
   * Finalize the run. Sets status + completed_at on manifest.
   * Renders accumulated counterfactual entries to 05_report/counterfactuals.md.
   */
  closeRun(runId: string, status: RunStatus): Promise<void>

  /** Read the manifest for an existing run */
  readManifest(runId: string): Promise<RunManifest>

  /** List all run IDs, newest first */
  listRuns(): Promise<string[]>
}
```

Implement `LocalRunArtifactStore implements RunArtifactStore` in the same file. It must:

- Use `node:fs/promises` and `node:path`. No external filesystem libraries.
- Derive the run folder path as `<repoRoot>/runs/<runId>/`.
- `createRun` must: create all seven subdirectories (`00_intent` through `artifacts`), write `manifest.json`, write `provenance.json` stub, return the `run_id`.
- All append operations must open the file in append mode (`'a'` flag).
- `appendCounterfactual` appends to an internal `05_report/counterfactuals.jsonl` (not the rendered markdown).
- `closeRun` must: read existing manifest, update `status` and `completed_at`, rewrite manifest; then read `counterfactuals.jsonl` (if present), render each entry to a markdown list under its class heading, write `05_report/counterfactuals.md`.
- `writeCoherenceResult` writes `04_eval/coherence.json`; `writeFidelityResult` writes `04_eval/fidelity.json`; `writePersistenceResult` writes `04_eval/persistence.json`.
- No operation may throw on a missing run folder — it must throw a typed `RunNotFoundError` instead.

### 1.5 Counterfactuals rendering format (`05_report/counterfactuals.md`)

`closeRun` renders the accumulated `counterfactuals.jsonl` entries into markdown grouped by `CounterfactualClass`. Example:

```markdown
# Counterfactuals

## Model Candidate Skipped
- **2026-05-18T14:00:00Z** — What: `openrouter/openai/gpt-5.4` skipped. Why: tool-capability-probe failed (no write tool use in response).

## Compiler Alternative Rejected
- **2026-05-18T14:01:00Z** — What: WorkGraph with parallel MAP+PATCH nodes. Why: Coherence Verification requires sequential dependency (MAP output is PATCH input).
```

If no counterfactuals were recorded, `counterfactuals.md` contains: `# Counterfactuals\n\n_No alternatives were considered and rejected during this run._`

### 1.6 Acceptance criteria for Deliverable 1

| ID | Criterion | Verification |
|----|-----------|-------------|
| AC-R1 | `packages/schemas` exports `DecisionTraceEntry`, `CounterfactualEntry`, `CounterfactualClass`, `WorkerManifest`, `RunProvenance`, `RunManifest`, `RunStatus` | `pnpm typecheck` |
| AC-R2 | `LocalRunArtifactStore.createRun()` creates all seven subdirectories | unit test |
| AC-R3 | `appendDecisionTrace()` produces valid JSONL (each line is valid JSON, parses to `DecisionTraceEntry`) | unit test |
| AC-R4 | `writeCoherenceResult(runId, report)` writes `04_eval/coherence.json` parseable as `CoherenceVerificationReport` | unit test |
| AC-R5 | `closeRun(runId, 'completed')` sets `status` and `completed_at` in manifest | unit test |
| AC-R6 | `closeRun` on a non-existent run throws `RunNotFoundError` | unit test |
| AC-R7 | `appendCounterfactual` + `closeRun` produces a non-empty `counterfactuals.md` grouped by class | unit test |
| AC-R8 | `writeWorkerManifest` writes `00_intent/worker-manifest.json` parseable as `WorkerManifest` | unit test |
| AC-R9 | `pnpm test` passes across all packages | integration |

---

## Deliverable 2 — Vertical-Slice Integration Test Pattern

### 2.1 Purpose

Prove that a declared IntentSpecification can flow through to an executed, gate-evaluated, traced run. This test suite is the canonical integration test for the IS→WG→execution→Coherence-Verification path. It must pass before any compiler pass implementations are written into `packages/compiler/src/passes/`.

The test does not require a real LLM call. It uses a `DeterministicRunAdapter` (described below) that returns pre-scripted outputs.

### 2.2 DeterministicRunAdapter — `packages/harness-bridge/src/adapters/deterministic-run.ts` (new file)

```typescript
// WorkGraphNode is exported from @factory/schemas (defined in core.ts, compiled to dist/core.d.ts)
import type { WorkGraphNode } from '@factory/schemas'

// NOTE: harness-bridge already defines HarnessAdapter (execute returns AdapterNodeOutcome).
// RunArtifactAdapter is a separate interface for the artifact-store integration layer only —
// it is NOT a replacement for HarnessAdapter.
export interface RunArtifactAdapter {
  /** Execute a single WorkGraph node. Returns structured result for artifact store. */
  executeNode(node: WorkGraphNode, runId: string): Promise<RunArtifactNodeResult>
}

export interface RunArtifactNodeResult {
  status: 'pass' | 'fail' | 'blocked'
  outputPaths: string[]
  evidence: string[]
  durationMs: number
}

/**
 * DeterministicRunAdapter: returns pre-scripted results keyed by node.id.
 * Used in tests and dry-runs. Parallel to harness-bridge DryRunAdapter but
 * returns RunArtifactNodeResult (artifact-store shape) not AdapterNodeOutcome.
 */
export class DeterministicRunAdapter implements RunArtifactAdapter {
  constructor(private readonly script: Record<string, RunArtifactNodeResult>) {}

  async executeNode(node: WorkGraphNode, _runId: string): Promise<RunArtifactNodeResult> {
    const result = this.script[node.id]
    if (!result) {
      return { status: 'fail', outputPaths: [], evidence: [], durationMs: 0 }
    }
    return result
  }
}
```

### 2.3 Integration test — `packages/harness-bridge/tests/vertical-slice.test.ts` (new file)

The test must cover exactly one scenario end-to-end. Do not stub the RunArtifactStore — use a real `LocalRunArtifactStore` writing to a `tmp/` directory that is cleaned up in `afterEach`.

```typescript
// Scenario: a minimal IntentSpecification flows through to a completed run with
// a passing Coherence Verification result and a populated decision trace.
//
// Given: a valid IntentSpecification (is) with one acceptance criterion
// And:   a WorkGraph (wg) with one node satisfying that criterion
// And:   a DeterministicRunAdapter scripted to return pass for that node
// And:   a Coherence Verification evaluator that returns pass when all AC are covered
// When:  runHarness(is, wg, adapter, store, workerManifest) is called
// Then:  a run folder exists under runs/
// And:   00_intent/is.json is present and parses as IntentSpecification
// And:   00_intent/worker-manifest.json is present and parses as WorkerManifest
// And:   01_plan/wg.json is present and parses as WorkGraph
// And:   03_traces/decision_trace.jsonl contains at least one entry per stage
// And:   04_eval/coherence.json is present and parses as CoherenceVerificationReport with verdict "pass"
// And:   05_report/report.md is present and non-empty
// And:   05_report/counterfactuals.md is present (empty or populated)
// And:   manifest.json has status "completed"
```

Implement `runHarness` in `packages/harness-bridge/src/harness.ts` with this signature:

```typescript
import { IntentSpecification, WorkGraph } from '@factory/schemas'
import type { RunArtifactAdapter, RunArtifactStore, WorkerManifest, RunStatus } from './run-artifact-store.js'

export async function runHarness(
  is: IntentSpecification,
  wg: WorkGraph,
  adapter: RunArtifactAdapter,
  store: RunArtifactStore,
  workerManifest: Omit<WorkerManifest, 'run_id'>,
): Promise<{ runId: string; status: RunStatus }>
```

`runHarness` must:

1. Call `store.createRun(is)` — get `runId`.
2. Call `store.writeIntent(runId, is)` — writes `00_intent/is.json`, generates `acceptance_criteria.md` from `is.acceptanceCriteria`.
3. Call `store.writeWorkerManifest(runId, workerManifest)`.
4. Call `store.writePlan(runId, wg)`.
5. Append a `decision_trace` entry for each stage entered.
6. For each node in `wg.nodes` (topological order, dependency-respecting): call `adapter.executeNode(node, runId)`, append trace entry, append commands.log line.
7. Evaluate Coherence Verification: check that every `is.acceptanceCriteria` item has at least one passing node's evidence mapping to it. Produce a `CoherenceVerificationReport`. Write with `store.writeCoherenceResult(runId, report)`.
8. If Coherence Verification verdict is `fail`: call `store.closeRun(runId, 'coherence_blocked')` and return.
9. Write `report.md` with a structured summary (see §2.4).
10. Call `store.closeRun(runId, 'completed')`.

### 2.4 report.md template

`runHarness` must generate `report.md` using exactly this structure:

```markdown
# Run Report: <run_id>

**Status:** <status>  
**FP:** <fp.id> — <fp.title>  
**WG:** <wg.id>  
**Completed:** <ISO timestamp>

## Acceptance Criteria

| ID | Statement | Status |
|----|-----------|--------|
<one row per AC>

## Coherence Verification

**Status:** <pass|blocked|warn>  
**Score:** <score>  
<check rows if any>

## Decision Trace Summary

<count> events recorded across <n> stages.

## Next Actions

<If status completed>: promote artifacts to specs/ per Factory conventions.  
<If status coherence_blocked>: address failing AC — see 04_eval/coherence.json for details. Update counterfactuals.md.
```

### 2.5 Acceptance criteria for Deliverable 2

| ID | Criterion | Verification |
|----|-----------|-------------|
| AC-V1 | `DeterministicRunAdapter` implements `RunArtifactAdapter` interface without type errors | `pnpm typecheck` |
| AC-V2 | `runHarness` with a passing script produces a run folder with all required files including `worker-manifest.json` and `counterfactuals.md` | integration test |
| AC-V3 | `decision_trace.jsonl` contains entries for stages `intent`, `plan`, `execution`, `eval`, `report` | integration test |
| AC-V4 | `coherence.json` parses as `CoherenceVerificationReport` with verdict `"pass"` for passing script | integration test |
| AC-V5 | `runHarness` with a failing script (node returns `fail`) produces `coherence.json` with verdict `"fail"` and run manifest `status: "coherence_blocked"` | integration test |
| AC-V6 | `report.md` contains all four sections (AC table, Coherence Verification result, trace summary, next actions) | integration test |
| AC-V7 | `pnpm typecheck` and `pnpm test` pass across all affected packages | CI |

---

## Implementation Order

The agent must implement in this exact order. Each step must pass `pnpm typecheck` before proceeding to the next.

```
Step 1  packages/schemas/src/run.ts           — new Zod schemas
Step 2  packages/schemas/src/index.ts         — add run.ts barrel exports
Step 3  packages/harness-bridge/src/adapters/deterministic-run.ts  — RunArtifactAdapter + DeterministicRunAdapter
Step 4  packages/harness-bridge/src/run-artifact-store.ts      — interface + LocalRunArtifactStore
Step 5  packages/harness-bridge/src/harness.ts                 — runHarness
Step 6  packages/harness-bridge/tests/run-artifact-store.test.ts  — unit tests for AC-R1 through AC-R9
Step 7  packages/harness-bridge/tests/vertical-slice.test.ts   — integration test for AC-V1 through AC-V7
Step 8  pnpm -r typecheck && pnpm -r test     — must both pass clean
```

---

## Constraints

- TypeScript strict mode. 2-space indent. No semicolons. ESM modules. Functional patterns where practical.
- No external filesystem libraries — `node:fs/promises` and `node:path` only.
- No LLM calls in any new code introduced by this spec. The harness is purely orchestration; LLM calls belong in `packages/compiler/` passes.
- No new dependencies added to `packages/schemas`. It must remain a pure Zod + TypeScript package.
- `packages/harness-bridge` may add `@factory/schemas` as a workspace dependency if not already present.
- All new files must carry a file-level comment: `// source_ref: FF-RUN-ARTIFACT-SPEC` for lineage tracking.
- Existing tests must not be broken.
- `runs/` directory must be added to `.gitignore`.

---

## What This Spec Does NOT Cover

- Remote storage or database-backed RunArtifactStore implementations
- Fidelity Verification or Persistence Verification evaluation logic
- Compiler pass implementations (`packages/compiler/src/passes/`)
- Memory layer feedback (episodic/semantic write-back from run artifacts) — separate spec
- `ff` CLI integration — separate spec
- AGENTS.md emission from WG — separate spec (Decision 1 from factory-onto-self-sense.md)
