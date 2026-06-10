# KSP SDD Workflow Roster — Phase 1 (Reversa Analysis)

> function-factory · _reversa_sdd/ · Generated: 2026-06-10

---

## Workflow 1 — Diff Re-run (existing code → patch SDD)

Run when: code changes land that affect existing ff modules.

```
Scout Patch (1 agent, sequential)
    ↓
Archaeologist (parallel fan-out)
  ├─ arch:ff-pipeline
  ├─ arch:synthesis-coordinator
  ├─ arch:gascity-supervisor
  ├─ arch:ff-gates
  ├─ arch:ff-gateway
  ├─ arch:packages/db-client
  ├─ arch:packages/ontology-loader
  ├─ patch-architecture
  └─ patch-domain
    ↓
Merge (1 agent, sequential)
    ↓
Detective → Architect → Writer → Reviewer (sequential)
```

| Agent | Skill | Writes |
|-------|-------|--------|
| scout-patch | `reversa-scout` | `inventory.md`, `surface.json` |
| arch:{module} × 7 | `reversa-archaeologist` | `code-analysis-{module}-patch.md`, `flowcharts/{module}.md` |
| patch-architecture | _(inline)_ | `architecture.md` |
| patch-domain | _(inline)_ | `domain.md` |
| merge-patches | _(inline)_ | `code-analysis.md` (consolidated), deletes patch files |
| detective | `reversa-detective` | `domain.md`, `state-machines.md`, `adrs/` |
| architect | `reversa-architect` | `c4-containers.md`, `c4-components.md`, `erd-complete.md`, `traceability/spec-impact-matrix.md` |
| writer | `reversa-writer` | `{module}/requirements.md`, `design.md`, `tasks.md` |
| reviewer | `reversa-reviewer` | `confidence-report.md`, `questions.md`, `gaps.md` |

---

## Workflow 2 — KSP Forward (new specs → generate SDD)

Run when: new spec files arrive for incoming packages.

```
Scout (1 agent, sequential)
    ↓
Archaeologist (parallel fan-out)
  ├─ arch:ksp-artifact-graph
  ├─ arch:ksp-bead-graph
  ├─ arch:ksp-sdk
  ├─ arch:ksp-loop-closure
  ├─ arch:ksp-factory-graph
  ├─ arch:ksp-gears
  └─ arch:ksp-flue-workflow
    ↓
Merge (1 agent, sequential)
    ↓
Detective → Architect (sequential)
    ↓
Writer (parallel fan-out)
  ├─ writer:ksp-artifact-graph
  ├─ writer:ksp-bead-graph
  ├─ writer:ksp-sdk
  ├─ writer:ksp-loop-closure
  ├─ writer:ksp-factory-graph
  ├─ writer:ksp-gears
  └─ writer:ksp-flue-workflow
    ↓
Reviewer (1 agent, sequential)
```

| Agent | Skill | Writes |
|-------|-------|--------|
| scout-ksp | `reversa-scout` | `inventory.md` (KSP section), `surface.json` |
| arch:{module} × 7 | `reversa-archaeologist` | `code-analysis-ksp-{module}-patch.md`, `flowcharts/{module}.md` |
| merge-ksp | _(inline)_ | `code-analysis.md` (KSP sections appended) |
| detective-ksp | `reversa-detective` | `domain.md` (KSP rules), `state-machines.md`, `adrs/ADR-KSP-00*.md` |
| architect-ksp | `reversa-architect` | `c4-containers.md`, `c4-components.md`, `erd-complete.md`, `traceability/spec-impact-matrix.md` |
| writer:{module} × 7 | `reversa-writer` | `ksp-{module}/requirements.md`, `design.md`, `tasks.md`, `contracts.md` |
| reviewer-ksp | `reversa-reviewer` | `confidence-report.md`, `questions.md`, `gaps.md` |

---

## Skill Reference

| Skill | Role | Phase |
|-------|------|-------|
| `reversa-scout` | Surface mapping — structure, tech, entry points | 1 |
| `reversa-archaeologist` | Deep code/spec analysis per module | 2 (parallel) |
| `reversa-detective` | Business rules, state machines, ADRs | 4 |
| `reversa-architect` | C4 diagrams, ERD, traceability matrix | 5 |
| `reversa-writer` | Per-module requirements/design/tasks | 6 (parallel) |
| `reversa-reviewer` | Quality gate, confidence report, questions | 7 |
