# Commissioning Agent DO — Domain Skill Delivery Specification

**ID**: SPEC-FF-CA-SKILLS-001  
**Version**: 1.0  
**Date**: 2026-06-13  
**Status**: Draft  
**Author**: Wislet J. Celestin / Koales.ai  
**Location**: `packages/commissioning-agent/`  
**Linear**: WEO-10 (parent), WEO-30 – WEO-34 (sub-issues), WEO-13 (cancelled)  
**Depends on**: SPEC-FF-ILAYER-EXEC-001 v2.0, SPEC-MEDIATION-AGENT-DO-001 v3.0, SPEC-FF-FLUE-RETIRE-001, SPEC-FF-GAP-CLOSURES-001 §3  
**Supersedes**: SPEC-COMMISSIONING-AGENT-001 (stateless Worker era — retired)  
**Out of scope**: Mediation Agent DO internals, CoordinatorDO, ThinkExecutor/Mastra Conducting Agent (covered in SPEC-FF-ILAYER-EXEC-001 v2.0)

---

## §0 Purpose

This spec defines the Commissioning Agent as a `CommissioningAgentDO extends Think<Env>` Durable Object with per-phase skill delivery. It replaces the stateless Worker architecture of SPEC-COMMISSIONING-AGENT-001, which could not support per-phase skill switching, persistent org context, or the async amendment loop.

**What this spec changes:**
- CA becomes `CommissioningAgentDO extends Think<Env>` — DO per `orgId`
- Skills are delivered per-phase from a `DomainSkillRegistry`
- The polling loop (WEO-13) is retired; Divergence notifications are push-based via `POST /divergence`
- Two HTTP endpoints replace the four endpoints of the old spec: `/signal` (forward run) and `/divergence` (amendment loop)
- `workspace.writeFile()` via `/workspace/write` enables T2 skill injection by the WeOps gateway before signal arrival

**What this spec does NOT change:**
- All governance artifacts (EluciationArtifact, Hypothesis, Amendment, Verdict) still written to ArtifactGraphDO
- Mediation Agent DO receives `POST /commission` from the CA exactly as before
- CoordinatorDO, ThinkExecutor, Mastra Conducting Agent — unchanged
- ConsentBead enforcement — CA uses Think lifecycle hooks, not Mastra `outputProcessors`
- `.agents/skills/` T3 skills — same files, same paths; CA workspace discovers them at session open

**Three justifications for the DO migration:**
1. Per-phase skill switching requires a session context that persists across the phase boundary
2. Persistent session accumulates org context (domain profile, constraints, prior runs) over time
3. The amendment loop spans async events (Divergence detected → human review → Amendment adoption) — a stateless Worker cannot hold this state

---

## §1 What Changes (Summary Table)

| Component | Old (SPEC-COMMISSIONING-AGENT-001) | New (this spec) |
|---|---|---|
| Runtime | Stateless CF Worker | `CommissioningAgentDO extends Think<Env>`, DO per `orgId` |
| State | ArangoDB collections | DO SQLite (`session_context` table) + ArtifactGraphDO (unchanged) |
| Skill delivery | None — no skills | T1 bundled + T3 workspace + T2 spec: injection |
| Divergence notification | Polling loop (WEO-13, CF Workflow / Cron) | Push: `LoopClosureService.recordOutcome()` → `POST /divergence` |
| Endpoints | `/commission`, `/resume`, `/health/{repoId}`, `/override` | `/signal`, `/divergence`, `/workspace/write` |
| ArangoDB | Primary artifact store | Retired from CA execution path |
| `@factory/harness-bridge` | LLM call routing | Retired; Mastra model routing via `Think` session |

---

## §2 Architecture

### DO Identity

```
DO key: commissioning-agent:{orgId}
Class:  CommissioningAgentDO extends Think<Env>
```

One DO instance per organization. The gateway stubs it by `orgId`:

```typescript
const stub = env.COMMISSIONING_AGENT.get(
  env.COMMISSIONING_AGENT.idFromName(`commissioning-agent:${orgId}`)
);
```

### Session Configuration

`configureSession()` builds three context blocks injected before every turn:

```typescript
async configureSession(): Promise<SessionConfig> {
  const ctx = await this.restoreSessionContext()  // from DO SQLite

  return {
    soul: this.buildSoulPrompt(ctx.domainProfile),
    contextBlocks: [
      {
        label: 'domain-constraints',
        content: ctx.domainProfile.constraints
          .filter(c => c.severity === 'blocking')
          .map(c => `BLOCKING: ${c.description}`)
          .join('\n'),
      },
      {
        label: 'org-context',
        content: ctx.domainProfile.orgContext,
      },
    ],
    withCachedPrompt: true,    // system prompt cached between turns
  }
}
```

### Skill Resolution

```typescript
async getSkills(): Promise<SkillRef[]> {
  const ctx = await this.restoreSessionContext()
  return resolveSkillRefs(
    ctx.domainProfile.vertical,
    ctx.currentPhase,
    ctx.domainProfile.additionalSkillRefs ?? [],
  )
}
```

### HTTP Endpoints

```
POST /signal          Forward run: CommissioningSignal → pattern-appraisal → deliberation → workgraph-authoring → POST /commission to Mediation Agent DO
POST /divergence      Amendment loop: Divergence notification → hypothesis-formation → amendment-proposal → LoopClosureService
POST /workspace/write T2 skill injection by WeOps gateway before /signal fires
```

### DO SQLite Schema

```sql
CREATE TABLE session_context (
  org_id TEXT PRIMARY KEY,
  current_phase TEXT NOT NULL DEFAULT 'idle',
    -- idle | pattern-appraisal | deliberation | workgraph-authoring
    -- | hypothesis-formation | amendment-proposal
  domain_profile TEXT NOT NULL,   -- JSON: DomainProfile
  active_run_id TEXT,             -- runId if a run is in progress
  last_signal_at TEXT,
  last_divergence_at TEXT,
  updated_at TEXT NOT NULL
);
```

---

## §3 DomainProfile

`DomainProfile` is carried in `CommissioningSignal` and persisted to `session_context`.

```typescript
const DomainProfileSchema = z.object({
  vertical: z.enum([
    'gtm-engineering',
    'healthcare-operations',
    'comeflow-commerce',
    'fintech-compliance',
    'generic',            // fallback — always registered (CA-INV-004)
  ]),
  orgContext: z.string(),         // free-form org description for soul block
  constraints: z.array(z.object({
    id: z.string(),               // CONS-{nanoid}
    description: z.string(),
    severity: z.enum(['blocking', 'advisory']),
    // blocking: enforced during workgraph-authoring (CA-INV-003)
    // advisory: surfaced to human but not enforced
  })),
  additionalSkillRefs: z.array(z.string()).optional(), // additive on top of registry
  version: z.string().default('1.0'),
})

// Updated CommissioningSignal carries DomainProfile
const CommissioningSignalSchema = z.object({
  orgId: z.string(),
  workGraphId: z.string().optional(),   // if pre-specified by We-layer
  workGraphVersion: z.string().optional(),
  domainProfile: DomainProfileSchema,
  dispositionEventId: z.string(),       // ELC-* ref (A9)
  elucidationArtifactId: z.string(),
  issuedAt: z.string(),
})
```

---

## §4 DomainSkillRegistry

Five verticals plus the mandatory `generic` fallback. Each entry has `base[]` (all phases) and `phases{}` (per-phase overrides). The authoring chain loads only during `workgraph-authoring` and `amendment-proposal` (CA-INV-006).

```typescript
export const DOMAIN_SKILL_REGISTRY: Record<string, DomainSkillEntry> = {
  'gtm-engineering': {
    base: ['bundled:factory-authoring-core', 'bundled:gtm-signal-pattern-library'],
    phases: {
      'pattern-appraisal': ['bundled:gtm-signal-pattern-library'],
      'deliberation':       ['bundled:gtm-candidate-evaluation'],
      'workgraph-authoring':['workspace:pressure-authoring', 'workspace:capability-authoring',
                             'workspace:function-proposal', 'workspace:prd-authoring',
                             'workspace:grill-me', 'bundled:gtm-acceptance-criteria'],
      'hypothesis-formation':['bundled:gtm-fault-attribution'],
      'amendment-proposal': ['workspace:prd-authoring'],
    },
  },
  'healthcare-operations': {
    base: ['bundled:factory-authoring-core', 'bundled:healthcare-signal-pattern-library'],
    phases: {
      'pattern-appraisal': ['bundled:healthcare-signal-pattern-library'],
      'deliberation':       ['bundled:healthcare-candidate-evaluation'],
      'workgraph-authoring':['workspace:pressure-authoring', 'workspace:capability-authoring',
                             'workspace:function-proposal', 'workspace:prd-authoring',
                             'workspace:grill-me', 'bundled:healthcare-acceptance-criteria'],
      'hypothesis-formation':['bundled:healthcare-fault-attribution'],
      'amendment-proposal': ['workspace:prd-authoring'],
    },
  },
  'comeflow-commerce': {
    base: ['bundled:factory-authoring-core', 'bundled:commerce-signal-pattern-library'],
    phases: {
      'pattern-appraisal': ['bundled:commerce-signal-pattern-library'],
      'deliberation':       ['bundled:commerce-candidate-evaluation'],
      'workgraph-authoring':['workspace:pressure-authoring', 'workspace:capability-authoring',
                             'workspace:function-proposal', 'workspace:prd-authoring',
                             'workspace:grill-me'],
      'hypothesis-formation':['bundled:commerce-fault-attribution'],
      'amendment-proposal': ['workspace:prd-authoring'],
    },
  },
  'fintech-compliance': {
    base: ['bundled:factory-authoring-core', 'bundled:fintech-signal-pattern-library'],
    phases: {
      'pattern-appraisal': ['bundled:fintech-signal-pattern-library'],
      'deliberation':       ['bundled:fintech-candidate-evaluation'],
      'workgraph-authoring':['workspace:pressure-authoring', 'workspace:capability-authoring',
                             'workspace:function-proposal', 'workspace:prd-authoring',
                             'workspace:grill-me', 'bundled:fintech-acceptance-criteria'],
      'hypothesis-formation':['bundled:fintech-fault-attribution'],
      'amendment-proposal': ['workspace:prd-authoring'],
    },
  },
  'generic': {
    // Mandatory fallback — CA-INV-004
    base: ['bundled:factory-authoring-core'],
    phases: {
      'pattern-appraisal': [],
      'deliberation':       [],
      'workgraph-authoring':['workspace:pressure-authoring', 'workspace:capability-authoring',
                             'workspace:function-proposal', 'workspace:prd-authoring',
                             'workspace:grill-me'],
      'hypothesis-formation':[],
      'amendment-proposal': ['workspace:prd-authoring'],
    },
  },
}

export function resolveSkillRefs(
  vertical: string,
  phase: string,
  additionals: string[],
): string[] {
  const entry = DOMAIN_SKILL_REGISTRY[vertical] ?? DOMAIN_SKILL_REGISTRY['generic']
  const base = entry.base ?? []
  const phaseSkills = entry.phases[phase] ?? []
  // deduplication, load order: base → phase-specific → additionals
  return [...new Set([...base, ...phaseSkills, ...additionals])]
}
```

---

## §5 CommissioningAgentDO — Full TypeScript Skeleton

```typescript
// packages/commissioning-agent/src/index.ts
import { Think } from '@cloudflare/think'
import { resolveSkillRefs } from './skill-registry'
import {
  runPatternAppraisal, runDeliberation, runWorkGraphAuthoring,
  runHypothesisFormation, runAmendmentProposal,
} from './phases'

export class CommissioningAgentDO extends Think<Env> {

  async configureSession() {
    const ctx = await this.restoreSessionContext()
    return {
      soul: this.buildSoulPrompt(ctx.domainProfile),
      contextBlocks: [
        {
          label: 'domain-constraints',
          content: ctx.domainProfile.constraints
            .filter(c => c.severity === 'blocking')
            .map(c => `BLOCKING: ${c.description}`)
            .join('\n'),
        },
        { label: 'org-context', content: ctx.domainProfile.orgContext },
      ],
      withCachedPrompt: true,
    }
  }

  async getSkills() {
    const ctx = await this.restoreSessionContext()
    return resolveSkillRefs(
      ctx.domainProfile.vertical,
      ctx.currentPhase,
      ctx.domainProfile.additionalSkillRefs ?? [],
    )
  }

  async beforeTurn() {
    // Restore session context from DO SQLite after hibernation wake
    await this.restoreSessionContext()
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'POST' && url.pathname === '/signal') {
      return this.handleSignal(request)
    }
    if (request.method === 'POST' && url.pathname === '/divergence') {
      return this.handleDivergence(request)
    }
    if (request.method === 'POST' && url.pathname === '/workspace/write') {
      return this.handleWorkspaceWrite(request)
    }

    return new Response('Not found', { status: 404 })
  }

  private async handleSignal(request: Request): Promise<Response> {
    const signal = CommissioningSignalSchema.parse(await request.json())
    await this.persistSessionContext({
      currentPhase: 'pattern-appraisal',
      domainProfile: signal.domainProfile,
    })

    const profile = signal.domainProfile

    // Phase 1: Pattern Appraisal
    await this.setPhase('pattern-appraisal')
    const appraisal = await runPatternAppraisal(this, signal.signal, profile)
    if (!appraisal.matches) {
      return Response.json({ status: 'archived', reason: appraisal.reason })
    }

    // Phase 2: Deliberation
    await this.setPhase('deliberation')
    const candidateSet = await runDeliberation(this, signal, appraisal, this.env)

    // Phase 3: WorkGraph Authoring (with optional human gate)
    await this.setPhase('workgraph-authoring')
    const workGraph = await runWorkGraphAuthoring(
      this, candidateSet, profile, signal.requireHumanApproval ?? true, this.env
    )
    if (!workGraph) {
      return Response.json({ status: 'rejected' })
    }

    // Dispatch to Mediation Agent DO
    await this.setPhase('idle')
    const stub = this.env.MEDIATION_AGENT.get(
      this.env.MEDIATION_AGENT.idFromName(`mediation-agent:${signal.orgId}`)
    )
    const result = await stub.fetch('/commission', {
      method: 'POST',
      body: JSON.stringify({
        runId: crypto.randomUUID(),
        orgId: signal.orgId,
        workGraphId: workGraph.id,
        workGraphVersion: workGraph.version,
        d1ArtifactRefs: workGraph.d1ArtifactRefs,
        eluciationArtifactId: signal.elucidationArtifactId,
      }),
    })

    // Signal Dream DO
    const dreamDO = this.env.DREAM_DO.get(
      this.env.DREAM_DO.idFromName('factory-singleton')
    )
    await dreamDO.fetch('/increment', { method: 'POST' })

    return result
  }

  private async handleDivergence(request: Request): Promise<Response> {
    const { divergenceId, specificationId, runId } = await request.json()

    // Phase 4: Hypothesis Formation
    await this.setPhase('hypothesis-formation')
    const hypothesis = await runHypothesisFormation(
      this, divergenceId, specificationId, runId, this.env
    )

    // Phase 5: Amendment Proposal
    await this.setPhase('amendment-proposal')
    const amendment = await runAmendmentProposal(
      this, hypothesis, specificationId, runId, this.env
    )

    await this.setPhase('idle')
    return Response.json({ status: 'proposed', amendmentId: amendment.id })
  }

  private async handleWorkspaceWrite(request: Request): Promise<Response> {
    // T2 skill injection: WeOps gateway writes spec: files before POST /signal
    const { path, content } = await request.json()
    await this.workspace.writeFile(path, content)
    return Response.json({ status: 'written' })
  }

  private async setPhase(phase: string): Promise<void> {
    await this.persistSessionContext({ currentPhase: phase })
  }

  private async restoreSessionContext(): Promise<SessionContext> {
    const row = this.ctx.storage.sql
      .exec('SELECT * FROM session_context WHERE org_id = ?', this.orgId)
      .one()
    if (!row) {
      return { currentPhase: 'idle', domainProfile: DEFAULT_DOMAIN_PROFILE }
    }
    return {
      currentPhase: row.current_phase as string,
      domainProfile: JSON.parse(row.domain_profile as string),
      activeRunId: row.active_run_id as string | undefined,
    }
  }

  private async persistSessionContext(patch: Partial<SessionContext>): Promise<void> {
    const current = await this.restoreSessionContext()
    const updated = { ...current, ...patch }
    this.ctx.storage.sql.exec(`
      INSERT OR REPLACE INTO session_context
        (org_id, current_phase, domain_profile, active_run_id, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `,
      this.orgId,
      updated.currentPhase,
      JSON.stringify(updated.domainProfile),
      updated.activeRunId ?? null,
      new Date().toISOString(),
    )
  }

  private buildSoulPrompt(profile: DomainProfile): string {
    return `You are the Commissioning Agent for the Function Factory — the planning and governance authority for the ${profile.vertical} vertical.

Your responsibilities:
- Pattern Appraisal: evaluate whether an incoming Signal matches a pattern addressable by the Factory
- Deliberation: build a scored Candidate Set from the Signal; nominate the best option
- WorkGraph Authoring: author a complete WorkGraph (pressure → capability → function proposal → PRD) for the nominated option
- Hypothesis Formation: when a Divergence is reported, attribute fault and build a Hypothesis
- Amendment Proposal: propose a targeted WorkGraph amendment to resolve the Hypothesis

You always produce an EluciationArtifact for every Disposition Event — even auto-approved ones.
You never propose amendments without fault attribution grounded in Divergence evidence.`
  }
}
```

---

## §6 Phase-to-Skill Mapping

| Phase | Authoring skills loaded | Domain skills loaded |
|---|---|---|
| `pattern-appraisal` | none | `{vertical}-signal-pattern-library` (T1) |
| `deliberation` | none | `{vertical}-candidate-evaluation` (T1) |
| `workgraph-authoring` | `pressure-authoring`, `capability-authoring`, `function-proposal`, `prd-authoring`, `grill-me` (T3) | `{vertical}-acceptance-criteria` (T1, if registered) |
| `hypothesis-formation` | none | `{vertical}-fault-attribution` (T1) |
| `amendment-proposal` | `prd-authoring` (T3) | none additional |

**Base skills** (all phases, all verticals): `bundled:factory-authoring-core` — shared authoring discipline, lineage requirements, `explicitness` tag enforcement.

---

## §7 Skill Ref Prefixes

| Prefix | Tier | Resolution |
|---|---|---|
| `bundled:name` | T1 | Build-time import in `packages/commissioning-agent/src/skills/bundled/` |
| `workspace:name` | T3 | Discovered from `.agents/skills/{name}/SKILL.md` in the DO's Think workspace |
| `spec:path` | T2 | Injected by WeOps gateway via `POST /workspace/write` before `/signal` fires |

**T2 timing constraint (CA-INV-005):** WeOps calls `POST /workspace/write` on the `CommissioningAgentDO` stub with `{ path: '/spec/skills/{name}/SKILL.md', content }` before sending `POST /signal`. The gateway is responsible for sequencing this write. This mirrors the Conducting Agent's T2 delivery timing constraint (SPEC-MEDIATION-AGENT-DO-001 v3.0 §5 step-9).

---

## §8 Phase Runner Contracts

Five phase runner functions, each in `packages/commissioning-agent/src/phases/`:

```typescript
// pattern-appraisal.ts
async function runPatternAppraisal(
  do: CommissioningAgentDO,
  signal: CommissioningSignal['signal'],
  profile: DomainProfile,
): Promise<{ matches: boolean; reason: string }>
// CA currentPhase = 'pattern-appraisal' before call (CA-INV-001)
// No-match → { matches: false, reason } → archive, HTTP 200 { status: 'archived' }

// deliberation.ts
async function runDeliberation(
  do: CommissioningAgentDO,
  signal: CommissioningSignal,
  appraisalResult: { matches: boolean; reason: string },
  env: Env,
): Promise<CandidateSet>
// CA currentPhase = 'deliberation'
// Produces scored, nominated CandidateSet (SE-Onto §3.14 evaluated stage)

// workgraph-authoring.ts
async function runWorkGraphAuthoring(
  do: CommissioningAgentDO,
  candidateSet: CandidateSet,
  profile: DomainProfile,
  requireHumanApproval: boolean,
  env: Env,
): Promise<WorkGraph | null>
// CA currentPhase = 'workgraph-authoring'
// Loads full T3 authoring chain (CA-INV-006)
// Enforces blocking constraints from profile.constraints (CA-INV-003)
// Human gate: Mastra workflow suspend() / resume() if requireHumanApproval
// Returns null on rejection

// hypothesis-formation.ts
async function runHypothesisFormation(
  do: CommissioningAgentDO,
  divergenceId: string,
  specificationId: string,
  runId: string,
  env: Env,
): Promise<Hypothesis>
// CA currentPhase = 'hypothesis-formation'
// Uses LoopClosureService.buildHypothesis()
// Claude Opus required as authorModelId (CA-INV-003, ResourceBudgetBead allowlist enforced)
// Returns Hypothesis with faultAttribution

// amendment-proposal.ts
async function runAmendmentProposal(
  do: CommissioningAgentDO,
  hypothesis: Hypothesis,
  specificationId: string,
  runId: string,
  env: Env,
): Promise<Amendment>
// CA currentPhase = 'amendment-proposal'
// Loads workspace:prd-authoring for spec revision (CA-INV-006)
// Calls LoopClosureService.proposeAmendment()
// Amendment.status = CANDIDATE until Mastra eval T4 Verdict
```

---

## §9 wrangler.jsonc Additions

```jsonc
{
  "durable_objects": {
    "bindings": [
      { "class_name": "CommissioningAgentDO", "name": "COMMISSIONING_AGENT" }
    ]
  },
  "migrations": [
    { "tag": "v2", "new_sqlite_classes": ["CommissioningAgentDO"] }
  ]
}
```

DO SQLite migration SQL (runs on first wake):

```sql
CREATE TABLE IF NOT EXISTS session_context (
  org_id TEXT PRIMARY KEY,
  current_phase TEXT NOT NULL DEFAULT 'idle',
  domain_profile TEXT NOT NULL DEFAULT '{"vertical":"generic","orgContext":"","constraints":[],"version":"1.0"}',
  active_run_id TEXT,
  last_signal_at TEXT,
  last_divergence_at TEXT,
  updated_at TEXT NOT NULL
);
```

---

## §10 Invariants

| ID | Invariant |
|---|---|
| CA-INV-001 | `currentPhase` is set before every `getSkills()` call and every phase runner invocation. Skills loaded for phase N are never active during phase N+1. Phase transitions are explicit `setPhase()` calls in the `/signal` and `/divergence` handlers. |
| CA-INV-002 | `domainProfile` is persisted to DO SQLite on every `/signal` invocation and restored in `beforeTurn()` on wake from hibernation. The CA never operates without a domain profile. |
| CA-INV-003 | Domain constraints with `severity: 'blocking'` are surfaced in the soul block and enforced during `workgraph-authoring`. A WorkGraph that violates a blocking constraint must not be dispatched to the Mediation Agent DO. Claude Opus is required as `authorModelId` for `hypothesis-formation` (ResourceBudgetBead allowlist enforced). |
| CA-INV-004 | The `generic` vertical is always registered in `DOMAIN_SKILL_REGISTRY` as the fallback. An unknown `domainProfile.vertical` resolves to `generic`, never errors. |
| CA-INV-005 | T2 skill files (`spec:` prefix) must be written via `POST /workspace/write` before `POST /signal` fires. WeOps gateway is responsible for sequencing this write. |
| CA-INV-006 | The authoring skill chain (`pressure-authoring → capability-authoring → function-proposal → prd-authoring → grill-me`) is only loaded during `workgraph-authoring` and `amendment-proposal` phases. Loading it during `pattern-appraisal` or `deliberation` would bias those phases toward premature artifact production. |

---

## §11 Linear Issues

| Issue | Title | Status |
|---|---|---|
| WEO-10 | CommissioningAgentDO — Think migration + domain skill delivery | Active (parent) |
| WEO-30 | CommissioningAgentDO scaffold: `extends Think<Env>`, `configureSession()`, `getSkills()`, `beforeTurn()`, DO SQLite `session_context`, `wrangler.jsonc` migration | Open |
| WEO-31 | DomainSkillRegistry: five verticals, `resolveSkillRefs()` with generic fallback, deduplication, load order | Open, blocked by WEO-30 |
| WEO-32 | DomainProfile schema + CommissioningSignal update, blocking constraint invariant (CA-INV-003) | Open, blocked by WEO-30 |
| WEO-33 | Five phase runners with full TypeScript signatures, CA-INV-001 and CA-INV-006 | Open, blocked by WEO-30/31/32 |
| WEO-34 | WeOps gateway T2 injection: `POST /workspace/write`, sequencing constraint (CA-INV-005) | Open, blocked by WEO-30 |
| WEO-13 | Polling loop (CF Workflow / Cron Trigger) | **Cancelled** — replaced by push-based `/divergence` + DO hibernation |

---

## §12 Gate

`tsc --noEmit` — typecheck gate before any WEO-* issue is closed.

Manual smoke test for WEO-34:
1. Inject a `spec:custom-acceptance-criteria` skill via `POST /workspace/write`
2. POST `/signal` with `additionalSkillRefs: ['spec:custom-acceptance-criteria']`
3. Verify `getSkills()` returns the injected skill during `workgraph-authoring` phase
