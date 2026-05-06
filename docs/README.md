# Function Factory Docs

This directory is the human-facing documentation hub for operating and
developing the Function Factory. It uses Diataxis as a navigation model:
tutorials teach, how-to guides help complete tasks, reference pages provide
precise lookup material, and explanation pages describe why the system works
the way it does.

`docs/` is not the Factory artifact store. Lineage-bearing artifacts remain in
[`../specs/`](../specs/README.md), and architecture/reference material remains
indexed from [`../specs/reference/`](../specs/reference/README.md).

## Start Here

| Need | Read |
| --- | --- |
| Project overview | [`../README.md`](../README.md) |
| Current architecture map | [`../ARCHITECTURE.md`](../ARCHITECTURE.md) |
| Factory artifact registry | [`../specs/README.md`](../specs/README.md) |
| Architecture and specs index | [`../specs/reference/README.md`](../specs/reference/README.md) |
| Repository/process ADRs | [`adr/README.md`](adr/README.md) |

## Current Docs By Mode

### How-To

Task-oriented operator and developer guidance.

| Document | Purpose |
| --- | --- |
| [`how-to/STRATEGY_RECIPES_DOGFOOD.md`](how-to/STRATEGY_RECIPES_DOGFOOD.md) | Run the Strategy.Recipes autonomous-scheduler dogfood flow. |
| [`AUTONOMOUS_FACTORY_TRANSITION.md`](AUTONOMOUS_FACTORY_TRANSITION.md) | Understand and operate the transition from manual Codex work to queued runner work. |
| [`TERMINAL_INTEGRATION_CONTRACT.md`](TERMINAL_INTEGRATION_CONTRACT.md) | Use the terminal integration contract. |
| [`TERMINAL_IMPLEMENTATION_BACKLOG.md`](TERMINAL_IMPLEMENTATION_BACKLOG.md) | Track terminal implementation tasks and sequencing. |

### Reference

Precise lookup material for architecture, artifacts, schemas, and decisions.

| Document | Purpose |
| --- | --- |
| [`../specs/README.md`](../specs/README.md) | Directory-level map of Factory artifact buckets. |
| [`../specs/reference/README.md`](../specs/reference/README.md) | Status-aware index of architecture, ADR, review, research, and handoff documents. |
| [`adr/README.md`](adr/README.md) | Repository/process ADR index. |

### Explanation

Background and rationale live primarily under
[`../specs/reference/`](../specs/reference/README.md). Those files are indexed
in place because many are canonical or lineage-relevant inputs.

### Tutorials

No tutorial files have been introduced in this index-only pass. Add tutorials
only when there is a real guided workflow to exercise end to end.

## Migration Rule

Do not move files under `specs/` as part of docs cleanup. First classify and
index in place, then run link and lineage checks. Moving canonical reference or
Factory artifact files requires an explicit architecture decision.

Run the Stage 2 audit with:

```bash
pnpm audit:docs
```
