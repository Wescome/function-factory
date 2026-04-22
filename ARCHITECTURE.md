# Architecture

The Function Factory is a closed-loop compiler that transforms Signals
(observations about the world) into trustworthy executable Functions, then
feeds runtime observations back as new Signals. Every artifact carries full
lineage. Every invariant has a detector. Every gate is fail-closed.

This document covers the full pipeline, every artifact type, every package,
and every governance policy. A new engineer should be able to navigate the
entire system after reading it.

---

## 1. Pipeline Flow

```
                         CLOSED-LOOP PIPELINE
                         ====================

  INTAKE                          ANALYSIS                    PLANNING
  ------                          --------                    --------
  SIG ---> normalize ---> SNB     PRS (raw)                   DEL ---> FP
           dedupe                   |                            |
           weight                   v                            v
           (signal-hygiene)       RPRS (recalibrated)          AC (candidates)
                                    |                            |
                                    v                           SBI (bias adj)
                                  DDI (drift)                    |
                                    |                            v
                                    v                          ACS (selected)
                                  DEL (delta)

  SPECIFICATION                   EXECUTION                   OBSERVATION
  -------------                   ---------                   -----------
  PRD ---> compiler (8 passes)    RAD ---> EXS ---> EFF       OBS
           |                                |         |         |
           v                                v         v         v
         WG + AC                          EXT <-- EFFR        SIG (feedback)
           |                                |                   |
           v                                v                   |
         CR (coverage)                    EXR                   |
                                                                |
                      <-------- feedback loop ---------<--------+

  GOVERNANCE
  ----------
  PSR ---> GOVP ---> GOVD (human) ---> GOVS ---> GOVA ---> GOVR (rollback)
```

### Pipeline in sequence

```
Stage 7.25:  SIG --> [normalize, dedupe, weight] --> SNB
Stage 2-3:   SNB --> PRS --> BC
Stage 8:     PRS --> RPRS (recalibrated) --> DDI (drift indicator)
Stage 4:     BC + DDI --> DEL (capability delta) --> FP (function proposals)
Stage 4.5:   FP --> AC (architecture candidates)
Stage 8.5:   AC + DDI --> CRL --> SBI (selection bias adjustment)
Stage 4.75:  AC + SBI --> ACS (selected candidate)
Stage 5:     FP --> PRD --> [8 compiler passes] --> WG + ATOM + CONTRACT + INV + DEP + VAL
Stage 5.5:   WG --> CR (coverage gates 1/2/3, fail-closed)
Stage 6:     ACS + WG --> RAD (runtime admission, allow/deny)
Stage 6.25:  RAD --> EXS (execution start) --> EXT (execution trace) --> EXR (result)
Stage 6.5:   EXS --> EFF (controlled effectors, tool policy enforcement)
Stage 6.75:  EFF --> EFFR (effector realization, safe_execute)
Stage 7:     EXR + EFFR + EXT --> OBS (observation) --> SIG (feedback loop)
Stage 9:     [all policies] --> PSR --> GOVP --> GOVD --> GOVS
Stage 10:    GOVS --> GOVA (activation, shadow/partial/full) --> GOVR (rollback plan)
```

---

## 2. Artifact Prefix Glossary

Every Factory artifact ID matches the pattern `<PREFIX>-<ALPHANUM>`. The
canonical regex lives in `packages/schemas/src/lineage.ts`.

| Prefix | Full Name | Schema Location | Pipeline Stage |
|--------|-----------|-----------------|----------------|
| `SIG` | External Signal | `schemas/core.ts` | 1 -- Signal Intake |
| `SNB` | Signal Normalization Batch | `schemas/signal-hygiene.ts` | 7.25 -- Signal Hygiene |
| `PRS` | Pressure (Forcing Function) | `schemas/core.ts` | 2 -- Pressure Synthesis |
| `BC` | Business Capability | `schemas/core.ts` | 3 -- Capability Mapping |
| `RPRS` | Recalibrated Pressure | `schemas/adaptive-recalibration.ts` | 8 -- Adaptive Recalibration |
| `DDI` | Delta Drift Input | `schemas/adaptive-recalibration.ts` | 8 -- Adaptive Recalibration |
| `DEL` | Capability Delta | `schemas/capability-delta.ts` | 4 -- Capability Delta |
| `FP` | Function Proposal | `schemas/core.ts` | 4 -- Capability Delta |
| `FN` | Function (realized) | reserved (no schema yet) | Post-execution |
| `AC` | Architecture Candidate | `schemas/architecture-candidate.ts` | 4.5 -- Architecture Candidates |
| `CRL` | Candidate Reliability | `schemas/selection-bias.ts` | 8.5 -- Selection Bias |
| `SBI` | Selection Bias Input | `schemas/selection-bias.ts` | 8.5 -- Selection Bias |
| `ACS` | Architecture Candidate Selection | `schemas/candidate-selection.ts` | 4.75 -- Candidate Selection |
| `PRD` | PRD Draft | `schemas/core.ts` | 5 -- PRD Authoring |
| `ATOM` | Requirement Atom | `schemas/core.ts` | 5 -- Compiler Pass 1 |
| `CONTRACT` | Contract | `schemas/core.ts` | 5 -- Compiler Pass 2 |
| `INV` | Invariant (with detector) | `schemas/core.ts` | 5 -- Compiler Pass 3 |
| `DET` | Detector | reserved (embedded in INV) | 5 -- Compiler Pass 3 |
| `DEP` | Dependency | `schemas/core.ts` | 5 -- Compiler Pass 4 |
| `VAL` | Validation Spec | `schemas/core.ts` | 5 -- Compiler Pass 5 |
| `WG` | Work Graph | `schemas/core.ts` | 5 -- Compiler Pass 6 |
| `CR` | Coverage Report | `schemas/coverage.ts` | 5.5 -- Coverage Gates |
| `CTR` | Commit Triage Record | `schemas/commit-triage.ts` | Infrastructure |
| `TRJ` | Trajectory | `schemas/core.ts` | 7 -- Observability |
| `PF` | Problem Frame | `schemas/core.ts` | 7 -- Observability |
| `INC` | Incident | `schemas/core.ts` | 7 -- Observability |
| `RAD` | Runtime Admission Decision | `schemas/runtime-admission.ts` | 6 -- Runtime Admission |
| `EXS` | Execution Start | `schemas/runtime-admission.ts` | 6.25 -- Execution Lifecycle |
| `EXT` | Execution Trace | `schemas/execution-trace.ts` | 6.25 -- Execution Lifecycle |
| `EXR` | Execution Result | `schemas/runtime-admission.ts` | 6.25 -- Execution Lifecycle |
| `EFF` | Effector Artifact | `schemas/controlled-effectors.ts` | 6.5 -- Controlled Effectors |
| `EFFR` | Effector Realization | `schemas/effector-realization.ts` | 6.75 -- Effector Realization |
| `OBS` | Observation Artifact | `schemas/observation.ts` | 7 -- Observability Feedback |
| `RGD` | Regression Detection | reserved (no schema yet) | 7 -- Observability |
| `GOV` | Governance Policy (base) | reserved (no schema yet) | 9 -- Meta-Governance |
| `PSR` | Policy Stress Report | `schemas/meta-governance.ts` | 9 -- Meta-Governance |
| `GOVP` | Governance Proposal | `schemas/meta-governance.ts` | 9 -- Meta-Governance |
| `GOVD` | Governance Decision | `schemas/meta-governance.ts` | 9 -- Meta-Governance |
| `GOVS` | Policy Successor Note | `schemas/meta-governance.ts` | 9 -- Meta-Governance |
| `GOVA` | Policy Activation | `schemas/policy-activation.ts` | 10 -- Policy Activation |
| `GOVR` | Policy Rollback Plan | `schemas/policy-activation.ts` | 10 -- Policy Activation |

All schema locations are relative to `packages/schemas/src/`.

---

## 3. Package Dependency Map

The monorepo uses pnpm workspaces. Every package lives under `packages/`.

```
@factory/schemas  (zod)                     <-- foundation, no internal deps
    |
    +-- @factory/coverage-gates             (schemas, zod, yaml)
    |       |
    |       +-- @factory/compiler           (schemas, coverage-gates, zod, yaml)
    |
    +-- @factory/capability-delta           (schemas, zod, yaml)
    +-- @factory/assurance-graph            (schemas, zod)
    +-- @factory/runtime                    (schemas, zod)
    +-- @factory/architecture-candidates    (schemas)
    +-- @factory/candidate-selection        (schemas)
    +-- @factory/runtime-admission          (schemas)
    +-- @factory/execution-lifecycle        (schemas)
    +-- @factory/controlled-effectors       (schemas)
    +-- @factory/effector-realization       (schemas)
    +-- @factory/observability-feedback     (schemas)
    +-- @factory/signal-hygiene             (schemas)
    +-- @factory/adaptive-recalibration     (schemas)
    +-- @factory/selection-bias             (schemas)
    +-- @factory/meta-governance            (schemas)
    +-- @factory/policy-activation          (schemas)
    +-- @factory/prd-authoring              (schemas)
    +-- @factory/recursion-governance       (schemas)
    +-- @factory/harness-bridge             (no package.json -- bridge utility)
```

Key observations:
- `schemas` is the sole shared dependency. Every package depends on it.
- `compiler` is the only package with a two-level internal dependency chain
  (`compiler` -> `coverage-gates` -> `schemas`).
- All other packages depend only on `schemas` directly.
- External dependencies are minimal: `zod` (validation), `yaml` (serialization).

---

## 4. Pipeline Stages

| Stage | Name | Package(s) | Consumes | Produces |
|-------|------|------------|----------|----------|
| 1 | Signal Intake | `schemas` | External events | `SIG` |
| 2 | Pressure Synthesis | `schemas` | `SIG` | `PRS` |
| 3 | Capability Mapping | `schemas` | `PRS` | `BC` |
| 4 | Capability Delta | `capability-delta` | `BC`, `DDI` | `DEL`, `FP` |
| 4.5 | Architecture Candidates | `architecture-candidates` | `FP` | `AC` |
| 4.75 | Candidate Selection | `candidate-selection` | `AC`, `SBI` | `ACS` |
| 5 | PRD Compilation | `prd-authoring`, `compiler` | `FP`, `PRD` | `ATOM`, `CONTRACT`, `INV`, `DEP`, `VAL`, `WG` |
| 5.5 | Coverage Gates | `coverage-gates` | `WG`, `INV`, `VAL`, `DEP` | `CR` (Gate 1/2/3) |
| 6 | Runtime Admission | `runtime-admission` | `ACS`, `WG` | `RAD` |
| 6.25 | Execution Lifecycle | `execution-lifecycle` | `RAD` | `EXS`, `EXT`, `EXR` |
| 6.5 | Controlled Effectors | `controlled-effectors` | `EXS`, `WG` | `EFF` |
| 6.75 | Effector Realization | `effector-realization` | `EFF` | `EFFR` |
| 7 | Observability Feedback | `observability-feedback` | `EXR`, `EFFR`, `EXT` | `OBS`, `SIG` (feedback) |
| 7.25 | Signal Hygiene | `signal-hygiene` | `SIG` (raw + feedback) | `SNB` |
| 8 | Adaptive Recalibration | `adaptive-recalibration` | `PRS`, `OBS` | `RPRS`, `DDI` |
| 8.5 | Selection Bias | `selection-bias` | `AC`, `DDI`, `OBS` | `CRL`, `SBI` |
| 9 | Meta-Governance | `meta-governance` | All policies, drift data | `PSR`, `GOVP`, `GOVD`, `GOVS` |
| 10 | Policy Activation | `policy-activation` | `GOVS` | `GOVA`, `GOVR` |

Cross-cutting packages:

| Package | Role |
|---------|------|
| `schemas` | Canonical Zod schemas for every artifact type. Foundation for all packages. |
| `assurance-graph` | Incident propagation via typed dependencies (5 types: blocks, constrains, implements, validates, informs). |
| `runtime` | Trust scoring, invariant health, regression detection (`TRJ`, `PF`, `INC`). |
| `recursion-governance` | Prevents unbounded self-modification. PRD quality gate and recursion depth checks. |
| `harness-bridge` | Connects the pipeline to external execution harnesses (Claude Code, etc.). |

### Compiler passes (Stage 5 detail)

The `compiler` package runs 8 narrow passes over a `PRDDraft`:

| Pass | Name | Input | Output |
|------|------|-------|--------|
| 1 | Atomize | `PRD` | `ATOM` (requirement atoms) |
| 2 | Contract extraction | `ATOM` | `CONTRACT` |
| 3 | Invariant derivation | `ATOM`, `CONTRACT` | `INV` (each with `DetectorSpec`) |
| 4 | Dependency analysis | `ATOM`, `CONTRACT`, `INV` | `DEP` |
| 5 | Validation planning | `ATOM`, `CONTRACT`, `INV` | `VAL` |
| 6 | Work graph synthesis | All prior passes | `WG` |
| 7 | Cross-reference audit | All artifacts | Lineage consistency check |
| 8 | Coverage evaluation | `WG` vs `ATOM`/`CONTRACT`/`INV` | `CR` (via coverage-gates) |

Each pass is narrow: it reads only its declared inputs and writes only its
declared outputs. No pass may skip or reorder.

---

## 5. Coverage Gates

Three gates, all fail-closed:

| Gate | Name | What it checks | When it runs |
|------|------|----------------|--------------|
| 1 | Compile Coverage | Every ATOM, CONTRACT, and INV is reachable from the WG. Detectors exist for all invariants. In bootstrap mode, verifies META- prefix on all artifact IDs. | After compiler pass 8 |
| 2 | Simulation Coverage | WorkGraph execution in simulation produces expected outputs and no invariant violations. | Before promoting from `verified` to `monitored` |
| 3 | Monitoring Coverage | Active detectors are fresh and firing. Silence is a regression. | Continuous, while Function is `monitored` |

A failed gate blocks downstream progress. Gate 1 failure means the PRD is
incomplete -- go back upstream. Gate 2 failure means the implementation
is untested. Gate 3 failure means production monitoring has gone silent.

---

## 6. Governance Policy Chain

The meta-governance system manages six named policies. Each policy governs a
specific aspect of the pipeline's self-modification behavior:

| Order | Policy ID | Governs |
|-------|-----------|---------|
| 1 | `GOV-META-BOOTSTRAP-RUNTIME-ADMISSION` | Which WorkGraphs are admitted for execution |
| 2 | `GOV-META-SIGNAL-HYGIENE-WEIGHTING` | How signals are normalized, deduped, and weighted |
| 3 | `GOV-META-ADAPTIVE-PRESSURE-RECALIBRATION` | How feedback adjusts Pressure strength/urgency |
| 4 | `GOV-META-SELECTION-BIAS-ADAPTATION` | How observation outcomes adjust candidate scoring |
| 5 | `GOV-META-POLICY-EVOLUTION` | How policies themselves are proposed and approved |
| 6 | `GOV-META-POLICY-ACTIVATION-ROLLOUT` | How approved policy changes roll out (shadow -> partial -> full) |

### Policy lifecycle

```
detect stress (PSR) --> propose change (GOVP) --> human decision (GOVD)
    --> successor note (GOVS) --> activate (GOVA, shadow first)
    --> rollback plan (GOVR, always present)
```

Policy changes always start in `shadow` mode. Promotion to `partial` and
then `full` requires evidence that the change does not degrade pipeline
behavior. Every activation carries a rollback plan targeting the predecessor
policy.

---

## 7. Lineage and Explicitness

Every artifact extends the `Lineage` mixin (`packages/schemas/src/lineage.ts`):

- `id` -- artifact ID matching the prefix regex
- `source_refs` -- array of upstream artifact IDs that contributed to this artifact
- `explicitness` -- `"explicit"` (directly stated in upstream) or `"inferred"` (derived by the Factory)
- `rationale` -- why this artifact exists; must be substantive when `explicitness` is `"inferred"`

When a compiler pass cannot confidently produce an artifact, it emits an
`UncertaintyEntry` (prefix `UNC-`) instead of guessing. Uncertainty entries
are not artifacts -- they are signals that human input is needed.

---

## 8. Non-Negotiables

Six rules from the whitepaper that have no exceptions:

1. **Lineage preservation** -- every artifact carries `source_refs`.
2. **Narrow-pass discipline** -- compiler passes read only declared inputs, write only declared outputs.
3. **Explicit invariants with detectors** -- an `INV` without a `DetectorSpec` is rejected at Gate 1.
4. **Typed assurance dependencies** -- 5 types (`blocks`, `constrains`, `implements`, `validates`, `informs`), no defaults.
5. **Trajectory-driven closure** -- drift detection feeds back as new Signals.
6. **Three coverage gates, fail-closed** -- Gate 1 (compile), Gate 2 (simulation), Gate 3 (monitoring).

---

## 9. Repository Layout

```
function-factory/
  packages/
    schemas/                    Foundation: Zod schemas for all artifact types
    signal-hygiene/             Stage 7.25: normalize, dedupe, weight signals
    adaptive-recalibration/     Stage 8: recalibrate pressures from feedback
    capability-delta/           Stage 4: compute delta, emit function proposals
    architecture-candidates/    Stage 4.5: generate architecture candidates
    selection-bias/             Stage 8.5: adjust candidate scoring from observations
    candidate-selection/        Stage 4.75: score and select candidates
    prd-authoring/              Stage 5: author PRD drafts from function proposals
    compiler/                   Stage 5: 8-pass PRD-to-WorkGraph compiler
    coverage-gates/             Stage 5.5: fail-closed coverage evaluation
    runtime-admission/          Stage 6: admit/deny WorkGraphs for execution
    execution-lifecycle/        Stage 6.25: start, trace, result lifecycle
    controlled-effectors/       Stage 6.5: tool policy enforcement
    effector-realization/       Stage 6.75: safe execution of effector actions
    observability-feedback/     Stage 7: observations back to signals
    meta-governance/            Stage 9: policy stress, proposals, decisions
    policy-activation/          Stage 10: shadow/partial/full rollout
    recursion-governance/       Cross-cutting: prevent unbounded self-modification
    assurance-graph/            Cross-cutting: incident propagation
    runtime/                    Cross-cutting: trust scoring, regression
    harness-bridge/             Infrastructure: external harness integration
  specs/
    signals/                    SIG-* artifacts
    pressures/                  PRS-* artifacts
    capabilities/               BC-* artifacts
    functions/                  FP-* artifacts
    prds/                       PRD-* artifacts
    workgraphs/                 WG-* artifacts
    invariants/                 INV-* + detector specs
    coverage-reports/           CR-* artifacts (Gate 1/2/3 outputs)
  .agent/                       Coding agent infrastructure (memory, skills, protocols)
```

---

## 10. Bootstrap Phase

The Factory is currently in `bootstrap` mode (`FactoryMode = "bootstrap"` in
`packages/schemas/src/core.ts`). This means:

- Signals are internal (whitepaper, ConOps, build events, agent traces).
- The first Pressures are meta-Pressures on the Factory's own construction.
- The first Capabilities are the Factory's own abilities.
- The first Functions **are** the Factory -- every compiler pass, gate, and
  schema validator is a Function with full lineage.
- Gate 1 enforces the `META-` prefix on all bootstrap artifact IDs.
- Coverage Reports are generated even when coverage fails. The Report is the
  product at this stage.

The Factory builds itself. Its operational history is the proof that it works.
