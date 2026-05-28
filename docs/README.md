# Function Factory Docs

This directory is the human-facing documentation hub for operating and
developing the Function Factory. It uses Diataxis as a navigation model:
tutorials teach, how-to guides help complete tasks, reference pages provide
precise lookup material, and explanation pages describe why the system works
the way it does.

`docs/` is not the Factory artifact store. Lineage-bearing artifacts remain in
[`../specs/`](../specs/README.md), and architecture/reference material remains
indexed from [`../specs/reference/`](../specs/reference/README.md).

Agent-facing Markdown files such as `AGENTS.md`, `spec.md`, and `tasks.md` are
best understood as portable views the Factory may emit from native artifacts,
not as replacements for `PRS-*`, `BC-*`, `FP-*`, `IS-*`, `ES-*`, `INV-*`, or
`VR-*` artifacts. See
[`../specs/reference/ONTOLOGICAL-SELF-SENSING-2026-05-03.md`](../specs/reference/ONTOLOGICAL-SELF-SENSING-2026-05-03.md).

## Start Here

| Need | Read |
| --- | --- |
| Plain-English product intro | [`LAYMAN_PRODUCT_GUIDE.md`](LAYMAN_PRODUCT_GUIDE.md) |
| Project overview | [`../README.md`](../README.md) |
| Product documentation | [`PRODUCT_DOCUMENTATION.md`](PRODUCT_DOCUMENTATION.md) |
| Current architecture map | [`../ARCHITECTURE.md`](../ARCHITECTURE.md) |
| Factory artifact registry | [`../specs/README.md`](../specs/README.md) |
| Architecture and specs index | [`../specs/reference/README.md`](../specs/reference/README.md) |
| Agent-facing Markdown emission rationale | [`../specs/reference/ONTOLOGICAL-SELF-SENSING-2026-05-03.md`](../specs/reference/ONTOLOGICAL-SELF-SENSING-2026-05-03.md) |
| Repository/process ADRs | [`adr/README.md`](adr/README.md) |
| Operator procedures | [`how-to/README.md`](how-to/README.md) |

## Current Docs By Mode

### How-To

Task-oriented operator and developer guidance.

| Document | Purpose |
| --- | --- |
| [`how-to/README.md`](how-to/README.md) | How-to guide index and migration boundary. |
| [`how-to/OPERATOR_RUNBOOK_GAS_CITY_PRODUCTION.md`](how-to/OPERATOR_RUNBOOK_GAS_CITY_PRODUCTION.md) | Production operator runbook for Factory + Gas City on Cloudflare. |
| [`how-to/INCIDENT_RUNBOOK_GAS_CITY.md`](how-to/INCIDENT_RUNBOOK_GAS_CITY.md) | Incident response runbook for dispatch/webhook/autonomy failures. |
| [`how-to/SLO_DASHBOARD.md`](how-to/SLO_DASHBOARD.md) | SLO dashboard command and threshold reference. |
| [`how-to/STRATEGY_RECIPES_DOGFOOD.md`](how-to/STRATEGY_RECIPES_DOGFOOD.md) | Run the Strategy.Recipes autonomous-scheduler dogfood flow. |

### Reference

Precise lookup material for architecture, artifacts, schemas, and decisions.

| Document | Purpose |
| --- | --- |
| [`FACTORY_GAS_CITY_E2E.md`](FACTORY_GAS_CITY_E2E.md) | End-to-end production reference: architecture, endpoints, secrets, lifecycle, dispatch flow, webhook, autonomy monitor. |
| [`LAYMAN_PRODUCT_GUIDE.md`](LAYMAN_PRODUCT_GUIDE.md) | Non-technical, plain-English overview of what the product does and how it helps teams. |
| [`PRODUCT_DOCUMENTATION.md`](PRODUCT_DOCUMENTATION.md) | Product-level guide to what Function Factory does, how it works, and how to operate it. |
| [`../specs/README.md`](../specs/README.md) | Directory-level map of Factory artifact buckets. |
| [`../specs/reference/README.md`](../specs/reference/README.md) | Status-aware index of architecture, ADR, review, research, and handoff documents. |
| [`adr/README.md`](adr/README.md) | Repository/process ADR index. |
| [`TERMINAL_INTEGRATION_CONTRACT.md`](TERMINAL_INTEGRATION_CONTRACT.md) | Terminal integration contract for repo, artifact, gateway, and config behavior. |
| [`TERMINAL_IMPLEMENTATION_BACKLOG.md`](TERMINAL_IMPLEMENTATION_BACKLOG.md) | Terminal implementation atoms, acceptance criteria, and phase gates. |

### Explanation

Background and rationale live primarily under
[`../specs/reference/`](../specs/reference/README.md). Those files are indexed
in place because many are canonical or lineage-relevant inputs.

| Document | Purpose |
| --- | --- |
| [`AUTONOMOUS_FACTORY_TRANSITION.md`](AUTONOMOUS_FACTORY_TRANSITION.md) | Explains the transition from manual Codex work to queued runner work. |
| [`PRODUCTION_READINESS_MILESTONES.md`](PRODUCTION_READINESS_MILESTONES.md) | Tracks remaining production readiness milestones, exit criteria, and evidence. |

### Tutorials

No tutorial files have been introduced in this index-only pass. Add tutorials
only when there is a real guided workflow to exercise end to end.

## Migration Rule

Do not move files under `specs/` as part of docs cleanup. First classify and
index in place, then run link and lineage checks. Moving canonical reference or
Factory artifact files requires an explicit architecture decision.

For `docs/` moves, keep a compatibility stub at the old path while existing
links may still target it. The docs audit enforces the current stub inventory,
section README files, and orphan-doc checks.

Run the Stage 2 audit with:

```bash
pnpm audit:docs
```
