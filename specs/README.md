# Factory Specs And Artifacts

`specs/` is the Factory's artifact store. Many files here are lineage-bearing
inputs or outputs of the Factory pipeline, not ordinary documentation. Diataxis
helps humans navigate these files, but it does not change their artifact
locations.

Markdown files can exist in two different roles:

- Native Factory references and PRDs live here when they are part of the
  architecture/spec corpus.
- Agent-facing files such as `AGENTS.md`, `spec.md`, or `tasks.md` are portable
  emission targets the Factory can generate from native artifacts; they do not
  replace the typed artifact graph.

## Ground Rule

Do not reorganize Factory artifacts by tutorial/how-to/reference/explanation
category. Artifact paths are part of the repository's discovery and lineage
surface. Any move of canonical references or generated artifacts requires an
explicit architecture decision and link/lineage verification.

## Primary Indexes

| Need | Read |
| --- | --- |
| Human docs hub | [`../docs/README.md`](../docs/README.md) |
| Architecture/reference corpus | [`reference/README.md`](reference/README.md) |
| Agent-facing Markdown emission rationale | [`reference/ONTOLOGICAL-SELF-SENSING-2026-05-03.md`](reference/ONTOLOGICAL-SELF-SENSING-2026-05-03.md) |
| Project overview | [`../README.md`](../README.md) |
| Architecture map | [`../ARCHITECTURE.md`](../ARCHITECTURE.md) |

## Artifact Buckets

| Directory | Artifact family | Notes |
| --- | --- | --- |
| [`signals/`](signals/) | `SIG-*` | Stage 1 inputs. Signals may cite external origins via their `source` field. |
| [`signal-batches/`](signal-batches/) | `SNB-*` | Signal normalization batches. |
| [`pressures/`](pressures/) | `PRS-*` | Forcing functions synthesized from signals. |
| [`recalibrated-pressures/`](recalibrated-pressures/) | `RPRS-*` | Feedback-adjusted pressures. |
| [`capabilities/`](capabilities/) | `BC-*` | Capabilities the Factory must provide. |
| [`delta-drift-inputs/`](delta-drift-inputs/) | `DDI-*` | Drift inputs for capability-delta work. |
| [`deltas/`](deltas/) | `DEL-*` | Capability deltas. |
| [`functions/`](functions/) | `FP-*` | Function proposals. |
| [`architecture-candidates/`](architecture-candidates/) | `AC-*` | Candidate execution/architecture arrangements. |
| [`candidate-reliabilities/`](candidate-reliabilities/) | `CRL-*` | Candidate reliability evidence. |
| [`selection-bias-inputs/`](selection-bias-inputs/) | `SBI-*` | Selection-bias adjustment inputs. |
| [`candidate-selections/`](candidate-selections/) | `ACS-*` | Selected candidate records. |
| [`prds/`](prds/) | `PRD-*` | Stage 5 compiler inputs. |
| [`workgraphs/`](workgraphs/) | `WG-*` | Stage 5 compiler outputs. These are latest-known-good graph artifacts, not append-only history. |
| [`coverage-reports/`](coverage-reports/) | `CR-*` | Gate reports. These are timestamped evidence and should be treated as append-only. |
| [`critic-reviews/`](critic-reviews/) | `CRV-*` | Critic review artifacts. |
| [`runtime-admissions/`](runtime-admissions/) | `RAD-*` | Runtime admission decisions. |
| [`execution-starts/`](execution-starts/) | `EXS-*` | Execution lifecycle start records. |
| [`execution-traces/`](execution-traces/) | `EXT-*` | Execution traces. |
| [`execution-results/`](execution-results/) | `EXR-*` | Execution results. |
| [`effectors/`](effectors/) | `EFF-*` | Controlled effector artifacts. |
| [`effector-realizations/`](effector-realizations/) | `EFFR-*` | Safe execution realizations. |
| [`observations/`](observations/) | `OBS-*` | Observability feedback artifacts. |
| [`governance/`](governance/) | `GOV-*` | Base governance policies. |
| [`policy-stress-reports/`](policy-stress-reports/) | `PSR-*` | Policy stress reports. |
| [`governance-proposals/`](governance-proposals/) | `GOVP-*` | Governance proposals. |
| [`governance-decisions/`](governance-decisions/) | `GOVD-*` | Governance decisions. |
| [`policy-successor-notes/`](policy-successor-notes/) | `GOVS-*` | Policy successor notes. |
| [`policy-activations/`](policy-activations/) | `GOVA-*` | Policy activations. |
| [`rollback-plans/`](rollback-plans/) | `GOVR-*` | Rollback plans. |
| [`invariants/`](invariants/) | `INV-*` | Reserved bucket for standalone invariants. Current invariant content may also be embedded in PRD/WorkGraph-derived artifacts. |
| [`ontology/`](ontology/) | Ontology assets | TTL, shapes, implementation notes, and visual assets for the orientation ontology. |
| [`reference/`](reference/) | Architecture/reference corpus | Canonical architecture, ADRs, design notes, reviews, research, and handoffs. See [`reference/README.md`](reference/README.md). |

## Diataxis Classification

| Diataxis mode | Where it currently lives |
| --- | --- |
| Tutorial | Not introduced in this pass. Future guided workflows should live under `docs/tutorials/`. |
| How-to | Operational docs currently live under [`../docs/`](../docs/README.md). |
| Reference | Artifact buckets live here; architecture/reference docs are indexed in [`reference/README.md`](reference/README.md). |
| Explanation | Most rationale, reviews, and research live under [`reference/`](reference/README.md), indexed in place. |

## Verification Before Moving Anything

Run the docs and lineage audit:

```bash
pnpm audit:docs
```

Before any future file move under `specs/`:

1. List inbound markdown links and artifact references.
2. Verify every `source_refs` ID still resolves to an existing artifact.
3. Confirm the file is not compiler output, gate evidence, or a canonical architecture source.
4. Record the migration decision if the file is canonical, generated, or lineage-bearing.

The current audit recognizes two explicit non-file cases:

- `ATOM-*` source refs are non-materialized compiler intermediates accepted by
  current WorkGraph artifacts.
- `OBS-META-ARCHITECTURE-CANDIDATE-EXECUTION-2` is a historical unresolved
  lineage gap named in `scripts/audit-docs.mjs`; new unresolved refs still fail
  the audit.
