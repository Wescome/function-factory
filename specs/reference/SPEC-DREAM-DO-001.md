# Dream DO — Specification

**Document ID**: SPEC-DREAM-DO-001  
**Version**: 2.0  
**Date**: 2026-06-14  
**Status**: Draft — awaiting Factory compilation into WorkGraph  
**Location**: `workers/dream-do/`  
**Reference architecture**: Hermes Agent (NousResearch) — memory, skills, and curator systems  
**v1.0 → v2.0**: Storage substrate migrated from ArangoDB to DO SQLite + ArtifactGraphDO. Caller of `getTemplateForRun()` corrected from CoordinatorDO to Mediation Agent DO. Gate vocabulary updated to Coherence/Fidelity Verification-Process. `active_pipeline_count` idle gate updated. ArangoDB SEARCH → SQLite FTS5. Rollback mechanism updated for DO SQLite.  
**Depends on**: SPEC-FF-ILAYER-EXEC-001 v2.0, SPEC-FF-COORDINATOR-DO-001, SPEC-FF-GAP-CLOSURES-001

**Retired vocabulary (hard-fail if used in implementation):**  
ArangoDB `pass_templates` collection · ArangoDB `pass_template_usage` collection · ArangoDB `quality_signals` collection · ArangoDB `consolidation_reports` collection · ArangoDB AQL/SEARCH in `search.ts` · "Called by Coordinator DO at Stage 5 start" · "Gate 2a / Gate 2b" as gate identifiers · "Stage 6 repair loop"

---

## §0 Purpose and Scope

Dream DO is the Function Factory's learning layer. It is a Cloudflare Durable Object that runs after pipeline execution to crystallize reusable patterns, track pass-quality signals, and propose routing adjustments — without ever touching an active pipeline run.

Dream DO gives the Factory what it currently lacks: a feedback loop from run outcomes back into future runs. Two zero-repair production runs have completed. Dream DO is the mechanism that makes the third run better than the second because of the second.

The name comes from `.agent/tools/dream.ts` — "Reflection/consolidation engine" — which exists as a stub in the repo. This spec defines what that stub becomes as a Durable Object.

**What Dream DO is not:**
- Not a replacement for ArtifactGraphDO lineage. Lineage is provenance. Dream DO is learning.
- Not an auto-tuner. Dream DO proposes; operator approves.
- Not active during pipeline execution. It is idle-gated.
- Not a general memory store. It reads pipeline execution state; it writes structured learning artifacts.

---

## §1 Hermes → Factory Mapping

Every Dream DO mechanism has a direct Hermes source. This table is the design authority.

| Hermes mechanism | Dream DO equivalent | Notes |
|---|---|---|
| `MEMORY.md` — bounded agent notes, frozen at session start | `RunMemory` — per-PRD-signal-class bounded summary of what worked | Frozen at pipeline start via warm-start query; written post-run |
| `USER.md` — user profile | `OperatorProfile` — dominant signal types, PRD patterns, operator conventions | Injected into compiler context at compile time |
| Session search — FTS5 SQLite, LLM summarization | SQLite FTS5 over `pass_templates` table in DO SQLite with FULLTEXT + lineage traversal | Same recall-on-demand pattern; FTS5 replaces ArangoDB SEARCH (closer to Hermes original) |
| Agent-created skills — saved after 5+ tool calls | `PassTemplate` — crystallized WorkGraph atom-patterns from zero-repair runs | Created by `crystallize()` after zero-repair confirmation |
| `skill_manage patch` — preferred over full edit | `patchTemplate(templateId, diff)` — targeted field update | Preserves lineage; full replace only for structural rewrites |
| Curator — background maintenance, not a cron daemon | Consolidation alarm — CF DO Alarm API, idle-gated | Same inactivity check pattern; alarm fires during pipeline quiet |
| Curator: active → stale → archived state machine | PassTemplate state: `active → stale → retired` | Never deleted; retirement is recoverable |
| Curator: LLM review pass on cheaper aux model | Consolidation: DeepSeek Flash call via `TaskKind.CONSOLIDATION` in `@factory/task-routing` | Same aux-model routing pattern |
| Curator: usage telemetry sidecar (`.usage.json`) | `pass_template_usage` table in DO SQLite — invocation_count, repair_count, gate_pass_rate | Written after every template use |
| Curator: per-run reports (`REPORT.md` + `run.json`) | `ConsolidationReport` node written to ArtifactGraphDO after each alarm wake | Append-only governance node; lineage edge per template touched |
| Curator: pinning | `PassTemplate.pinned: true` — immune to consolidation and retirement | Operator-set; persists across runs |
| Curator: backup + rollback before every mutation | DO SQLite savepoint wrapping all Phase 1 transitions; `ConsolidationReport.rollback_snapshot_key` references the savepoint | Rollback restores archived templates to active via savepoint replay |
| Memory nudges — agent decides what to persist | Quality signal nudge — LoopClosureService writes `QualitySignal` after each Verification-Process; Dream DO reads post-run | Same "persist the important thing at the moment of occurrence" pattern |

---

## §2 Dream DO Interface

### Location

```
workers/dream-do/
├── src/
│   ├── index.ts          — DO class export + Worker binding
│   ├── crystallize.ts    — post-run crystallization logic
│   ├── consolidate.ts    — alarm handler (two-phase consolidation)
│   ├── quality.ts        — quality signal reader/writer
│   ├── routing.ts        — routing patch proposal generator
│   ├── search.ts         — SQLite FTS5 wrappers (replaces ArangoDB SEARCH)
│   └── types.ts          — all Zod schemas for this DO
├── package.json
└── tsconfig.json
```

### DO class skeleton

```typescript
import { DurableObject } from 'cloudflare:workers'
import { z } from 'zod'

export class DreamDO extends DurableObject {
  // ── Triggered by CoordinatorDO after run COMPLETE ─────────────────────

  /**
   * Read execution state for runId from CoordinatorDO + ArtifactGraphDO.
   * If run was zero-repair and Coherence + Fidelity Verdicts are both favorable,
   * extract PassTemplates. Write QualitySignals regardless of verdict outcome.
   * Never called during active pipeline execution.
   */
  async crystallize(runId: string): Promise<CrystallizeResult>

  /**
   * Retrieve the best matching PassTemplate for a PRD with the given atom
   * signature. Returns null if no matching template exists or all candidates
   * are stale/retired.
   * Called by Mediation Agent DO during nine-step compile sequence (step 3 —
   * Gear binding resolution) as a warm-start prior.
   */
  async getTemplateForRun(prdSignature: PrdSignature): Promise<PassTemplate | null>

  // ── Called by LoopClosureService after each Verification-Process ───────

  /**
   * Write a quality signal for a specific Verification-Process outcome.
   * Called immediately after Coherence (Mediation Agent DO step 4) or
   * Fidelity (LoopClosureService BP3) verdict — same "nudge at the moment
   * of occurrence" pattern as Hermes memory nudges.
   */
  async writeQualitySignal(signal: QualitySignal): Promise<void>

  // ── Targeted template update (prefer over full replace) ───────────────

  /**
   * Apply a targeted diff to an existing PassTemplate.
   * Preferred over full replacement — lower blast radius, preserves lineage.
   * Rejects if template is pinned and diff touches protected fields.
   */
  async patchTemplate(templateId: string, diff: TemplateDiff): Promise<void>

  // ── Alarm handler — DO consolidation pass ─────────────────────────────

  /**
   * CF DO Alarm entry point. Two phases:
   *   Phase 1 — deterministic: state transitions (active→stale→retired)
   *   Phase 2 — LLM: consolidation review via TaskKind.CONSOLIDATION
   * Idle-gated: refuses to run if any CoordinatorDO reports EXECUTING state.
   * Writes ConsolidationReport node to ArtifactGraphDO. Reschedules itself.
   */
  async alarm(): Promise<void>

  // ── Routing feedback ──────────────────────────────────────────────────

  /**
   * Read accumulated QualitySignals and generate a RoutingPatch proposal.
   * Never auto-applied. Writes proposal to DO SQLite (status: pending) for
   * operator review via FF Terminal.
   * Called from alarm() Phase 2 when signal volume crosses threshold.
   */
  async proposeRoutingPatch(): Promise<RoutingPatch | null>

  // ── Operator commands (via FF Terminal / ff CLI) ───────────────────────

  async pinTemplate(templateId: string): Promise<void>
  async unpinTemplate(templateId: string): Promise<void>
  async retireTemplate(templateId: string): Promise<void>
  async restoreTemplate(templateId: string): Promise<void>
  async status(): Promise<DreamStatus>
  async dryRunConsolidation(): Promise<ConsolidationReport>

  // ── Active pipeline coordination ─────────────────────────────────────

  /**
   * Called by Commissioning Agent Mastra Workflow T1 when a pipeline run
   * enters the `executing` state. Increments active_pipeline_count in DO SQLite.
   */
  async incrementActivePipelines(): Promise<void>

  /**
   * Called by CoordinatorDO immediately before crystallize(). Decrements
   * active_pipeline_count. Must reach 0 before alarm() Phase 1 can proceed.
   */
  async decrementActivePipelines(): Promise<void>
}
```

---

## §3 Storage Topology

Dream DO uses its own DO SQLite for all durable learning artifacts. ArtifactGraphDO receives governance nodes (ConsolidationReport). ArangoDB is not in the Dream DO execution path.

### DO SQLite tables (Dream DO singleton)

#### `pass_templates`

Crystallized WorkGraph patterns from zero-repair runs. The Factory's equivalent of Hermes agent-created skills.

```sql
CREATE TABLE pass_templates (
  id TEXT PRIMARY KEY,                -- PT-{nanoid}
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  -- Identity
  name TEXT NOT NULL,                 -- human-readable, e.g. "rest-api-crud-pattern"
  prd_signal_class TEXT NOT NULL,     -- signal class crystallized from
  atom_signature TEXT NOT NULL,       -- structural fingerprint (see §4.4)
  pass_coverage TEXT NOT NULL,        -- JSON array of pass numbers [1..8]

  -- Content — crystallized WorkGraph fragment (JSON)
  atom_templates TEXT NOT NULL,
  contract_templates TEXT NOT NULL,
  invariant_templates TEXT NOT NULL,

  -- Lifecycle (mirrors Hermes curator state machine)
  state TEXT NOT NULL DEFAULT 'active', -- active | stale | retired
  pinned INTEGER NOT NULL DEFAULT 0,
  retired_at TEXT,
  retire_reason TEXT,

  -- Provenance
  source_run_id TEXT NOT NULL,
  source_verdict_summary TEXT NOT NULL, -- JSON: coherence + fidelity verdicts
  artifact_graph_ref TEXT              -- ArtifactGraphDO node ID for this template
);

-- FTS5 index for recall (replaces ArangoDB SEARCH)
CREATE VIRTUAL TABLE pass_templates_fts USING fts5(
  id UNINDEXED,
  name,
  prd_signal_class,
  atom_templates,
  content='pass_templates',
  content_rowid='rowid'
);
```

#### `pass_template_usage`

Telemetry sidecar — one row per template. Mirrors Hermes `.usage.json`.

```sql
CREATE TABLE pass_template_usage (
  template_id TEXT PRIMARY KEY REFERENCES pass_templates(id),
  invocation_count INTEGER NOT NULL DEFAULT 0,
  zero_repair_count INTEGER NOT NULL DEFAULT 0,
  repair_count INTEGER NOT NULL DEFAULT 0,
  gate_pass_rate REAL NOT NULL DEFAULT 0.0,  -- zero_repair_count / invocation_count
  patch_count INTEGER NOT NULL DEFAULT 0,
  last_invoked_at TEXT,
  last_repaired_at TEXT,
  last_patched_at TEXT,
  created_at TEXT NOT NULL
);
```

#### `quality_signals`

Per-Verification-Process quality signals written after each verdict. Mirrors Hermes memory nudges — written at the moment of occurrence, not batched.

```sql
CREATE TABLE quality_signals (
  id TEXT PRIMARY KEY,                -- QS-{nanoid}
  run_id TEXT NOT NULL,
  verification_kind TEXT NOT NULL,    -- 'coherence' | 'fidelity'
  atom_id TEXT,                       -- for fidelity signals; null for coherence
  task_kind TEXT NOT NULL,            -- from @factory/task-routing
  signal_type TEXT NOT NULL,          -- see below
  verdict TEXT NOT NULL,              -- 'favorable' | 'unfavorable'
  repair_required INTEGER NOT NULL,   -- 0 | 1
  repair_description TEXT,
  model_used TEXT NOT NULL,
  provider TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  token_cost_usd REAL,
  artifact_graph_ref TEXT,            -- ArtifactGraphDO Verdict node ID
  recorded_at TEXT NOT NULL
);
-- signal_type values:
--   'coherence_failure'   — Coherence Verification unfavorable (Mediation Agent DO step 4)
--   'fidelity_failure'    — Fidelity Verification unfavorable (LoopClosureService BP3)
--   'divergence_detected' — LoopClosureService BP1 Divergence node written
--   'amendment_adopted'   — Amendment ADOPTED (Mastra eval T4)
--   'amendment_rejected'  — Amendment REJECTED
--   'zero_repair'         — all beads done, no Divergences, all verdicts favorable
```

#### `routing_patches`

Operator-review queue for routing patch proposals.

```sql
CREATE TABLE routing_patches (
  id TEXT PRIMARY KEY,               -- RP-{nanoid}
  proposed_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | applied | rejected
  evidence_window_runs INTEGER NOT NULL,
  signal_summary TEXT NOT NULL,      -- JSON
  patches TEXT NOT NULL,             -- JSON array of patch objects
  apply_command TEXT NOT NULL,       -- "ff routing apply RP-{nanoid}"
  applied_at TEXT,
  rejected_at TEXT,
  artifact_graph_ref TEXT            -- ArtifactGraphDO node ID once applied
);
```

#### `dream_state` (ephemeral coordination — DO SQLite only)

```sql
CREATE TABLE dream_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Keys:
--   active_pipeline_count       — INTEGER; incremented by Commissioning Agent, decremented by CoordinatorDO
--   last_consolidation_at       — ISO-8601
--   consolidation_running       — 0 | 1 (prevents concurrent alarm runs)
--   last_signal_window_start    — ISO-8601 (start of current routing patch evidence window)
```

### ArtifactGraphDO nodes (append-only)

Dream DO writes one node type to ArtifactGraphDO:

| Node type | Written by | Content |
|---|---|---|
| `ConsolidationReport` | `alarm()` after both phases complete | Human-readable summary + Phase 1/Phase 2 transition lists + routing patch reference + `rollback_snapshot_key` |

Lineage edges: `ConsolidationReport → PassTemplate` (one per template touched). Edge type: `DERIVES_FROM`.

---

## §4 Crystallization Protocol

Triggered by CoordinatorDO immediately after a pipeline run reaches `COMPLETE`. Never called during active execution.

### 4.1 Trigger

```
CoordinatorDO: COMPLETE
  → dream_do.decrementActivePipelines()
  → dream_do.crystallize(runId)
```

### 4.2 What `crystallize()` reads

From **CoordinatorDO DO SQLite** (by `runId`):
- All bead `status` values — determines zero-repair (all `done`, no `failed`)
- `consent_beads` — any `verdict: denied` entries indicate governance violations

From **ArtifactGraphDO** (by `runId`):
- `Verdict` nodes — Coherence verdict (Mediation Agent DO step 4) and Fidelity verdict(s) (LoopClosureService BP3)
- `Divergence` nodes — presence indicates non-zero-repair
- `Amendment` nodes — presence + status indicates amendment loop was triggered
- `AtomDirective` nodes — source of atom type + dependency topology for signature computation

From **Dream DO DO SQLite**:
- `quality_signals` for this `runId` (written during execution by LoopClosureService)

### 4.3 Decision: zero-repair path vs. repair path

```typescript
const coherenceVerdict = verdicts.find(v => v.verdictType === 'coherence')
const fidelityVerdicts = verdicts.filter(v => v.verdictType === 'fidelity')
const hasDivergences = divergenceNodes.length > 0
const hasFailedBeads = beads.some(b => b.status === 'failed')

if (
  coherenceVerdict?.verdict === 'favorable' &&
  fidelityVerdicts.every(v => v.verdict === 'favorable') &&
  !hasDivergences &&
  !hasFailedBeads
) {
  // Zero-repair run — crystallize PassTemplate
  const sig = computeAtomSignature(atomDirectives)
  const existing = await findTemplateBySignature(sig)
  if (existing) {
    await patchTemplate(existing.id, buildStatsDiff(runId))
    await updateUsage(existing.id, { invocation: true, zeroRepair: true })
  } else {
    await createPassTemplate(runId, sig, atomDirectives, verdicts)
    await initUsage(newTemplate.id)
  }
} else {
  // Repair or unfavorable verdict — write QualitySignals only
  await updateUsage(matchedTemplateId, { invocation: true, repair: true })
  await writeFailureSignals(runId, divergenceNodes, unfavorableVerdicts)
  // DO NOT create or patch templates from failed runs
}
```

### 4.4 Atom signature computation

The atom signature is a deterministic hash of structural features from `AtomDirective` nodes:

- Sorted list of atom concern classes (from `invariantIds` bindings)
- `dependsOn` edge topology (edge count, max depth)
- Signal class from the originating `CommissioningSignal`

Two PRDs with the same atom signature class are structurally similar enough to share a PassTemplate. Not a content hash — a structural fingerprint.

### 4.5 PassTemplate content

A PassTemplate captures:
- `atom_templates`: typed atom skeletons with their expected `toolPolicy.permittedTools` shapes
- `contract_templates`: producer/consumer `dependsOn` relationships that were stable across the run
- `invariant_templates`: `INV-*` bindings with detector specs that produced favorable Fidelity Verdicts

**Invariant (INV-DREAM-05):** PassTemplates are warm-start inputs to the Mediation Agent DO compile sequence (step 3), not compiler replacements. Coherence Verification (step 4) still runs. Fidelity Verification (LoopClosureService BP3) still runs. A PassTemplate that causes an unfavorable Coherence Verdict is flagged with a `coherence_failure` quality signal and its `gate_pass_rate` degrades.

---

## §5 Quality Signal Protocol

Quality signals are written by LoopClosureService and Mediation Agent DO at the moment of Verification-Process verdict — not batched post-run. This is the Factory equivalent of Hermes memory nudges.

### 5.1 When signals are written

| Trigger | Signal type | Written by |
|---|---|---|
| Coherence Verification unfavorable (Mediation Agent DO step 4) | `coherence_failure` | Mediation Agent DO → Dream DO `writeQualitySignal()` |
| Coherence Verification favorable | (no signal — success is captured in crystallization) | — |
| Fidelity Verification unfavorable (LoopClosureService BP3) | `fidelity_failure` | LoopClosureService → Dream DO `writeQualitySignal()` |
| LoopClosureService BP1 Divergence detected | `divergence_detected` | LoopClosureService → Dream DO `writeQualitySignal()` |
| Amendment ADOPTED (Mastra eval T4) | `amendment_adopted` | LoopClosureService BP5 → Dream DO `writeQualitySignal()` |
| Amendment REJECTED | `amendment_rejected` | LoopClosureService BP5 → Dream DO `writeQualitySignal()` |
| Run completes zero-repair (all favorable, no Divergences) | `zero_repair` | CoordinatorDO → `crystallize()` (writes this signal as part of crystallization) |

### 5.2 Signal accumulation window

Quality signals accumulate in the `quality_signals` DO SQLite table. Dream DO reads them:
- During `crystallize()`: signals for the specific `runId`
- During `alarm()` Phase 2: all signals since `last_signal_window_start`

Routing patch proposal threshold: `DREAM_SIGNAL_WINDOW_RUNS` (default: 10 completed runs).

---

## §6 Consolidation Alarm

### 6.1 Schedule

Dream DO sets a CF DO Alarm on first wake and reschedules itself at the end of every consolidation run. Default interval: 7 days (configurable via `DREAM_CONSOLIDATION_INTERVAL_HOURS` env var).

**Idle gate:** Before Phase 1 begins, Dream DO reads `active_pipeline_count` from `dream_state` DO SQLite. If `> 0`, reschedule 2 hours forward and abort. This mirrors Hermes curator's `min_idle_hours` check.

```typescript
async alarm(): Promise<void> {
  const state = await this.ctx.storage.sql
    .exec('SELECT value FROM dream_state WHERE key = ?', 'active_pipeline_count')
  const activePipelines = parseInt(state.results[0]?.value ?? '0')

  if (activePipelines > 0) {
    await this.ctx.storage.setAlarm(Date.now() + 2 * 60 * 60 * 1000) // retry in 2h
    return
  }

  // Prevent concurrent alarm runs
  await this.ctx.storage.sql.exec(
    'UPDATE dream_state SET value = ? WHERE key = ?', '1', 'consolidation_running'
  )

  try {
    await this.runConsolidation()
  } finally {
    await this.ctx.storage.sql.exec(
      'UPDATE dream_state SET value = ? WHERE key = ?', '0', 'consolidation_running'
    )
    await this.ctx.storage.setAlarm(Date.now() + CONSOLIDATION_INTERVAL_MS)
  }
}
```

### 6.2 Phase 1 — Deterministic state transitions

No LLM. Pure data comparison against `pass_template_usage` in DO SQLite.

All Phase 1 transitions happen inside a single DO SQLite savepoint. The savepoint name becomes the `rollback_snapshot_key` on the `ConsolidationReport` node in ArtifactGraphDO.

```sql
SAVEPOINT phase1_consolidation;

-- active → stale
UPDATE pass_templates
SET state = 'stale', updated_at = ?
WHERE state = 'active'
  AND pinned = 0
  AND id IN (
    SELECT template_id FROM pass_template_usage
    WHERE last_invoked_at < datetime('now', '-30 days')
  );

-- stale → retired
UPDATE pass_templates
SET state = 'retired', retired_at = ?, updated_at = ?
WHERE state = 'stale'
  AND pinned = 0
  AND id IN (
    SELECT template_id FROM pass_template_usage
    WHERE last_invoked_at < datetime('now', '-90 days')
  );

RELEASE SAVEPOINT phase1_consolidation;
-- On error: ROLLBACK TO SAVEPOINT phase1_consolidation
```

### 6.3 Phase 2 — LLM consolidation review

Single LLM call via `@factory/task-routing` with `TaskKind.CONSOLIDATION`. Routes to DeepSeek Flash (cheap validation tier) — mirrors Hermes curator's aux-model routing.

The LLM call receives:
- All `active` PassTemplates (full content)
- All `stale` PassTemplates (names + stats only — progressive disclosure)
- `quality_signals` summary since `last_signal_window_start`
- Instructions to: identify overlapping templates for consolidation; propose `patchTemplate` diffs for templates with degraded `gate_pass_rate`; flag templates for retirement if `gate_pass_rate < 0.5` over last 5 invocations

LLM produces structured `LlmProposal[]`:

```typescript
const LlmProposalSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('consolidate'), source_ids: z.array(z.string()), merged_content: PassTemplateContentSchema }),
  z.object({ kind: z.literal('patch'), template_id: z.string(), diff: TemplateDiffSchema }),
  z.object({ kind: z.literal('retire'), template_id: z.string(), reason: z.string() }),
  z.object({ kind: z.literal('pin'), template_id: z.string(), reason: z.string() }),
])
```

**Invariant (INV-DREAM-03):** LLM proposals for pinned templates are discarded without error.  
**Invariant (INV-DREAM-08):** LLM proposals that fail Zod validation are logged in `ConsolidationReport` as rejected, never partially applied.

### 6.4 Consolidation report

After both phases, Dream DO writes a `ConsolidationReport` governance node to ArtifactGraphDO (append-only) with lineage edges to every template touched. The `rollback_snapshot_key` references the Phase 1 DO SQLite savepoint name — pass to `restoreTemplate()` sequence to undo.

---

## §7 Routing Patch Proposals

Dream DO reads `quality_signals` and proposes modifications to `@factory/task-routing` config. Proposals are never auto-applied.

### 7.1 When a proposal is generated

At the end of `alarm()` Phase 2, if:
- At least `DREAM_SIGNAL_WINDOW_RUNS` (default: 10) completed runs in the signal window, AND
- At least one `task_kind` has `fidelity_failure` or `coherence_failure` signal rate > 20%

### 7.2 Proposal format

```typescript
const RoutingPatchSchema = z.object({
  id: z.string(),                    // RP-{nanoid}
  proposed_at: z.string(),
  status: z.enum(['pending', 'applied', 'rejected']),
  evidence_window_runs: z.number(),
  signal_summary: z.record(TaskKindSchema, SignalSummarySchema),
  patches: z.array(z.object({
    task_kind: TaskKindSchema,
    current_provider: z.string(),
    current_model: z.string(),
    proposed_provider: z.string(),
    proposed_model: z.string(),
    rationale: z.string(),           // evidence-based, not heuristic
  })),
  apply_command: z.string(),         // "ff routing apply RP-{nanoid}"
})
```

### 7.3 Operator review flow

```
Dream DO → writes RoutingPatch to routing_patches table (status: pending)
         → ArtifactGraphDO: ConsolidationReport node references patch
         → FF Terminal: Inbox block shows pending patch
         → Operator reviews in Decision Surface block
         → Operator runs: ff routing apply RP-{nanoid}
         → pipeline Worker updates @factory/task-routing config
         → routing_patches.status → 'applied'
         → ArtifactGraphDO: lineage edge written
```

Dream DO never modifies `@factory/task-routing` directly. Operator is always in the loop.

---

## §8 Invariants

Enforced by the DO, not just documented.

| ID | Invariant |
|---|---|
| INV-DREAM-01 | Dream DO never runs during active pipeline execution. Idle gate checks `dream_state.active_pipeline_count` at every alarm wake. |
| INV-DREAM-02 | PassTemplates are never deleted. Retirement is the terminal state. Retired templates are recoverable via `restoreTemplate()`. |
| INV-DREAM-03 | Pinned templates are immune to consolidation, retirement, and LLM proposals. Pinning survives rollback. |
| INV-DREAM-04 | PassTemplates are only crystallized from zero-repair runs (all beads `done`, no Divergence nodes, all Verdicts `favorable`). Failed runs write QualitySignals only. |
| INV-DREAM-05 | PassTemplates are warm-start inputs, not compiler replacements. Coherence Verification (Mediation Agent DO step 4) and Fidelity Verification (LoopClosureService BP3) always run regardless of template presence. |
| INV-DREAM-06 | RoutingPatch proposals are never auto-applied. Operator approval is required. |
| INV-DREAM-07 | All Phase 1 consolidation transitions happen inside a single DO SQLite savepoint. The savepoint name is stored as `rollback_snapshot_key` on the ConsolidationReport node. |
| INV-DREAM-08 | LLM proposals that fail Zod validation are rejected and logged in ConsolidationReport. Never partially applied. |
| INV-DREAM-09 | INV-GATE2A-NEVER-AUTHORITATIVE is not affected by Dream DO. Coherence Verification remains a compile-time structural check; Fidelity Verification remains the authoritative post-execution check. Neither is replaced by template presence. |
| INV-DREAM-10 | Dream DO is itself a Factory-compiled artifact. Its PassTemplates and ConsolidationReport nodes are lineage-tracked per the per-stage lineage write discipline. ArtifactGraphDO is append-only; Dream DO never mutates governance nodes. |

---

## §9 CF Workers Implementation Notes

### DO binding

```toml
# wrangler.toml (in workers/dream-do/)
[[durable_objects.bindings]]
name = "DREAM_DO"
class_name = "DreamDO"

[[migrations]]
tag = "v1"
new_classes = ["DreamDO"]
```

### DO storage

Dream DO uses CF DO SQLite for all durable learning state. This is a change from v1.0 (which specified ArangoDB). Rationale: Dream DO is a singleton; all its state is owned by one DO instance; DO SQLite is the correct substrate for owned singleton state. ArtifactGraphDO receives governance nodes (ConsolidationReport) per the append-only governance node pattern established in SPEC-FF-ILAYER-EXEC-001 v2.0.

### Singleton binding pattern

```typescript
// In Mediation Agent DO (nine-step compile sequence, step 3)
const doId = env.DREAM_DO.idFromName('factory-singleton')
const dreamDO = env.DREAM_DO.get(doId)
const template = await dreamDO.getTemplateForRun(prdSignature)

// In Commissioning Agent Mastra Workflow T1 (on entering executing state)
const dreamDO = env.DREAM_DO.get(env.DREAM_DO.idFromName('factory-singleton'))
await dreamDO.incrementActivePipelines()

// In CoordinatorDO (on COMPLETE — before crystallize)
const dreamDO = env.DREAM_DO.get(env.DREAM_DO.idFromName('factory-singleton'))
await dreamDO.decrementActivePipelines()
await dreamDO.crystallize(runId)

// In LoopClosureService (after each Verification-Process verdict)
const dreamDO = env.DREAM_DO.get(env.DREAM_DO.idFromName('factory-singleton'))
await dreamDO.writeQualitySignal(signal)
```

### Alarm API

```typescript
// Schedule on first wake (if not already set)
const existing = await this.ctx.storage.getAlarm()
if (!existing) {
  await this.ctx.storage.setAlarm(Date.now() + CONSOLIDATION_INTERVAL_MS)
}
```

---

## §10 Integration Points

```
Stage commissioning (Commissioning Agent Mastra Workflow T1)
  → dream_do.incrementActivePipelines()       // on entering executing state
  ↓
Mediation Agent DO: nine-step compile sequence
  → step 3: dream_do.getTemplateForRun(prdSignature)  // warm-start prior
  → step 4: Coherence Verification
            → dream_do.writeQualitySignal(coherenceSignal)  // on unfavorable
  ↓
CoordinatorDO: claimBead / releaseBead / failBead loop
  ↓
LoopClosureService
  → BP1-BP3: Fidelity Verification
            → dream_do.writeQualitySignal(fidelitySignal)   // per verdict
  → BP2-BP3: Divergence detection
            → dream_do.writeQualitySignal(divergenceSignal)
  → BP4-BP5: Amendment lifecycle
            → dream_do.writeQualitySignal(amendmentSignal)
  ↓
CoordinatorDO: COMPLETE
  → dream_do.decrementActivePipelines()
  → dream_do.crystallize(runId)
        → zero-repair? → create/patch PassTemplate in DO SQLite
        → otherwise?   → write QualitySignals only
  ↓
[idle period — active_pipeline_count = 0]
  ↓
Dream DO alarm
  → idle gate: active_pipeline_count > 0? → reschedule 2h, abort
  → Phase 1: DO SQLite savepoint; state transitions (active→stale→retired)
  → Phase 2: DeepSeek Flash — consolidation review
             → LlmProposal[] applied (Zod-validated, pinned templates immune)
             → RoutingPatch written to routing_patches table if signal threshold crossed
  → ConsolidationReport node written to ArtifactGraphDO (append-only)
  → Lineage edges: ConsolidationReport → PassTemplate (per template touched)
  ↓
FF Terminal: Inbox block / Decision Surface
  → operator reviews RoutingPatch (status: pending)
  → ff routing apply RP-{nanoid}   // operator-gated
  → routing_patches.status → 'applied'
```

---

## §11 Open Items

| Item | Blocking |
|---|---|
| `active_pipeline_count` initialization — if Dream DO cold-starts while a pipeline is mid-run, the counter may be 0 when it should be non-zero. Need a reconciliation query against CoordinatorDO on Dream DO wake. | No — edge case; low frequency in production. |
| FTS5 search quality — SQLite FTS5 recall for PassTemplate warm-start needs evaluation against the AQL FULLTEXT approach from v1.0. May need Porter stemmer tokenizer config. | No — implement basic first, tune if warm-start quality is poor. |
| `ConsolidationReport` rollback — the savepoint rollback restores DO SQLite state but the ArtifactGraphDO node is already written (append-only). Rollback of the report node is not possible by design. Operator should be aware that a rollback restores template states but not the report node itself. | No — document in operator runbook. |

---

## §12 Bootstrap Note

Dream DO is subject to the Factory's bootstrap principle: the Factory builds itself first.

The Dream DO's own PassTemplates are Factory-compiled artifacts. The first PassTemplate the Factory crystallizes is the one for the pipeline run that builds Dream DO. This is not circular — the first run produces Dream DO without a template (cold start). The second run can warm-start from the template produced by the first.

The `dream.ts` stub at `.agent/tools/dream.ts` should be updated to reference this spec once Dream DO is deployed.
