# Reversa Skills → Factory Assembly Line

**Generated:** 2026-06-17  
**Source:** All 49 skills read from `/Users/wes/Developer/reversa/agents/`  
**Purpose:** Map every Reversa skill onto its position in the Factory production pipeline

---

## The Core Insight

Reversa pauses at every CONTINUAR gate and waits for a human.  
The Factory replaces each CONTINUAR with the next skill running automatically.  
Same work. Different execution model.

The Factory's production pipeline is Reversa's forward pipeline running headlessly.

---

## Stage 0 — Signal Intelligence (pre-CommissioningAgentDO)

| Skill | Role | What it does | Factory position |
|---|---|---|---|
| `reversa-visor` | WeOps capture | Screenshots → structured signal | WeOps → CommissioningSignal |
| `reversa-ideator` | Intent formation | Brief → 6 divergent angles → structured disposition | Disposition event → CommissioningSignal |
| `reversa-researcher` | Context enrichment | Personas + journeys for new domains | Signal enrichment for unknown verticals |
| `reversa-scout` | Surface mapping | Folders, languages, entry points → inventory | ElucidationArtifact content (target repo) |
| `reversa-extract-soul` | Essence distillation | One-page executive spec from full codebase | `fetchElucidationStep` → ElucidationArtifact |
| `reversa-data-master` | Schema intelligence | DB tables, relationships, constraints | ElucidationArtifact data schema section |
| `reversa-n8n` | Adapter | N8N workflow JSON → SDD → CommissioningSignal | We-layer → Gateway adapter |

---

## Stage 1 — CommissioningAgentDO

| Skill | Role | What it does | Factory position |
|---|---|---|---|
| `reversa` | Meta-orchestrator | Sequences all discovery agents, owns session state | CA main loop (orchestrates 6 compiler passes) |
| `reversa-forward` | Forward orchestrator | Detects current stage, routes to next skill | CA per-session compiler chain |
| `reversa-new` | Greenfield init | Idea → personas → PRD → SDD for net-new repos | CA init when no ElucidationArtifact exists |
| `reversa-requirements` | Pressure synthesis | Natural language brief → anchored requirements | `synthesizePressureStep` → PRS-* |
| `reversa-clarify` | Ambiguity resolution | ≤5 clarifying questions before locking requirements | **GAP** — no equivalent before IS-* locks |
| `reversa-drafter` | PRD author | Ideation + personas → full PRD (problem, metrics, scope) | `compilePrdStep` → IS-* |
| `reversa-quality` | Signal gate | Requirements prose quality audit | CommissioningSignal validation pre-chain |

---

## Stage 2 — MediationAgentDO (compile passes)

| Skill | Role | What it does | Factory position |
|---|---|---|---|
| `reversa-plan` | Dependency pass | Technical roadmap as delta on legacy | Atom ordering + dependency graph |
| `reversa-archaeologist` | Compile context | Deep code analysis module by module | What exists to modify (compile context) |
| `reversa-detective` | Invariant pass | Business rules + retroactive ADRs from git | Invariant pass (rules that can't break) |
| `reversa-architect` | Interface pass | C4 diagrams, ERD, traceability matrix | Contracts between atoms (interface pass) |
| `reversa-principles` | Principles accumulation | Durable project principles propagated to templates | SPEC-KSP-PRINCIPLES-ACCUMULATION-001 |
| `reversa-writer` | Binding pass | Per-module requirements + design + tasks | Atom ↔ target file binding |
| `reversa-spec-sdd` | Decompose pass | PRD → per-component SDD specs | IS-* → AtomDirective[] (decompose pass) |
| `reversa-to-do` | Assembly pass | Roadmap → atomic actions with IDs and dependencies | AtomDirective[] → WorkGraph (WG-*) |
| `reversa-audit` | Coherence gate | Cross-check requirements vs roadmap vs actions | Coherence Verification (MediationAgentDO gate) |
| `reversa-reviewer` | Post-compile gate | Confidence report + gaps register | WG-* quality gate before molecule grouping |

---

## Stage 3 — CoordinatorDO + ConductingAgent (atom execution)

| Skill | Role | What it does | Factory position |
|---|---|---|---|
| `reversa-coding` | Coder | Executes actions.md → real code + legacy-impact.md | Coder ConductingAgent (kimi-k2.6) |
| `reversa-reconstructor` | Full rebuild | Bottom-up rebuild from SDD, one task at a time | ThinkExecutor fiber running ConductingAgent chain |
| `reversa-inspector` | Parity tests | Behavioral equivalence specs in Gherkin | Verifier ConductingAgent (M-3 molecule) |
| `reversa-resume` | Resumption | Re-activates paused feature by swapping active-requirements | `handleDivergence` → re-queue + continue |

---

## Stage 4 — ArchitectAgentDO sign-off

| Skill | Role | What it does | Factory position |
|---|---|---|---|
| `reversa-architect` | Sign-off | C4 + ERD + traceability at every review cycle | ArchitectAgentDO (fires after every molecule verdict) |
| `reversa-designer` | Remedy design | Target architecture for gaps-found fix atoms | ArchitectAgentDO gaps-found → fix molecule design |

---

## Stage 5 — Amendment loop

| Skill | Role | What it does | Factory position |
|---|---|---|---|
| `reversa-migrate` | Amendment orchestrator | 6-agent migration pipeline post-reverse | CommissioningAgentDO Divergence → Hypothesis → AMD-* |
| `reversa-paradigm-advisor` | Root cause | Detects paradigm gap between legacy and target | `buildHypothesis` — what fundamentally failed |
| `reversa-curator` | Divergence triage | Rule by rule: migrate / discard / human decision | Triage what to fix vs what to abandon |
| `reversa-strategist` | Amendment proposal | Migration strategy + risk register + cutover plan | `proposeAmendment` → AMD-* node |
| `reversa-screen-translator` | Screen specs | Legacy screens → executable specs for target platform | UI atom generation (screen-level amendments) |

---

## Stage 6 — Observability (WP-OBS-1..4 gate)

| Skill | Role | What it does | Factory position |
|---|---|---|---|
| `reversa-docs` | Obs orchestrator | HTML mini-site from all extracted knowledge | WP-OBS orchestrator (currently architecture gate) |
| `reversa-docs-analyst` | WP-OBS-1 | Highcharts dashboards — LOC, complexity, dependency sankey | ExecutionTrace metrics + atom counts |
| `reversa-docs-mapper` | WP-OBS-2 | 3D Code City + 2D force-directed module map | ArtifactGraph lineage visualization |
| `reversa-docs-storyteller` | WP-OBS-3 | Glossary + slide deck + per-feature How-It-Works | Lineage narrative — what was built and why |
| `reversa-docs-publisher` | WP-OBS-4 | index.html + seal integration + link validation | synthesis_passed report published |
| `reversa-selo-generativo` | Completion badge | Deterministic generative seal for certified output | synthesis_passed badge |

---

## We-layer / tooling (outside Factory runtime)

| Skill | Role | Notes |
|---|---|---|
| `reversa-design-system` | Design tokens | WeOps UI — CSS/Tailwind design token extraction |
| `reversa-highcharts-visualizer` | Charts | Can feed docs stage |
| `reversa-especialista-d3` | D3 graphs | `@factory/graph` lineage visualization |
| `reversa-arquitetura-3d` | 3D topology | Factory topology visualization |
| `reversa-image-prompt-json` | Image prompts | Visual artifact generation |
| `reversa-pricing-estimate` | Billing | WorkGraph effort → 3-scenario cost estimate |
| `reversa-pricing-profile` | Billing | Developer rate + markup + tax regime |
| `reversa-pricing-size` | Billing | WorkGraph T-shirt sizing → sprint/cost |
| `reversa-agents-help` | Docs | Skill catalogue with analogies |

---

## Numbers

- **39 of 49 skills** map onto Factory production stages
- **10** are We-layer / tooling / visualization
- **3 gaps** in the current Factory:
  1. `reversa-clarify` — no ambiguity resolution pass before IS-* locks
  2. WP-OBS-1..4 — observability gate not yet built (architecture gate)
  3. `reversa-reviewer` post-compile gate — missing before molecule grouping

---

## The amendment loop = the migration pipeline

Reversa calls it "migration." Factory calls it "amendment." Same FSM:

```
Reversa:  migrate → paradigm-advisor → curator → strategist → designer → inspector
Factory:  Divergence → buildHypothesis → triage → proposeAmendment → fix atoms → parity tests
```
