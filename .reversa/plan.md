# Exploration Plan — function-factory

> Created by Reversa on 2026-06-17
> Mark each task with ✅ when completed.
> You can edit this plan before starting: add, remove, or reorder tasks as needed.

---

## Phase 1: Discovery 🔍

- [ ] **Scout** — Map folder structure and technologies
- [ ] **Scout** — Analyze dependencies and package managers
- [ ] **Scout** — Identify entry points, CI/CD, and configuration

## Spec organization decision 🗂️

> Between Scout and Archaeologist, Reversa asks how you want to organize specs (by module, use case, endpoint, hybrid, feature-based, or custom). The choice is saved in `.reversa/config.toml` under `[specs]` and will not be asked again in future runs. To show the menu again, remove that section manually.

## Phase 2: Excavation 🏗️

> Reversa fills this section with real modules after Scout finishes discovery.

- [ ] **Archaeologist** — Analyze modules identified by Scout

## Phase 3: Interpretation 🧠

- [ ] **Detective** — Git archaeology and retrospective ADR review
- [ ] **Detective** — Implicit business rules and state machines
- [ ] **Detective** — Permission matrix (RBAC/ACL)
- [ ] **Architect** — C4 diagrams (Context, Containers, Components)
- [ ] **Architect** — Full ERD and external integrations
- [ ] **Architect** — Spec Impact Matrix

## Phase 4: Generation 📝

- [ ] **Writer** — SDD specs per component
- [ ] **Writer** — OpenAPI (if applicable)
- [ ] **Writer** — User Stories (if applicable)
- [ ] **Writer** — Code/Spec Matrix

## Phase 5: Review ✅

- [ ] **Reviewer** — Cross-review generated specs
- [ ] **Reviewer** — Resolve gaps with user
- [ ] **Reviewer** — Final confidence report

---

## Independent Agents

> Run these agents when resources are available — they can execute in any phase.

- [ ] **Visualizer** — Interface analysis via screenshots
- [ ] **Data Master** — Full database analysis
- [ ] **Design System** — Design token extraction
- [ ] **Tracer** — Dynamic analysis (requires accessible target system)

---

## Next step

After Discovery Team completes and `_reversa_sdd/` is populated, you can run one of the following flows:

- `/reversa-migrate`: orchestrator for the **Migration Team** (Paradigm Advisor → Curator → Strategist → Designer → Screen Translator → Inspector). Generates specs for the new system. Output in `_reversa_sdd/migration/` and `_reversa_sdd/screens/`.
- `/reversa-reconstructor`: generates a bottom-up plan to reimplement the software from legacy specs (one task per session).
