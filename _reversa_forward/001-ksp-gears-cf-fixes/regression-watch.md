# regression-watch.md — 001-ksp-gears-cf-fixes
Feature: 001-ksp-gears-cf-fixes | Date: 2026-06-10

## Watch Items

No items — the two changes were additive config (new DO bindings) and a path constant correction. No existing business rules were modified or removed.

## Observations (🟡 — no regression weight)

| ID | Source | Observation |
|----|--------|-----------|
| OBS-01 | `.flue/wrangler.jsonc` — migrations | The 5 Flue workflow DO classes remain in `new_sqlite_classes`. If class names change in `_entry.ts`, bindings must be updated to match. |
| OBS-02 | `.agents/tools/skill_loader.ts:16` | `.agent/skills/` still exists on disk. Re-extraction will find both paths. Delete `.agent/` when convenient. |

## Re-extraction history

_(empty — filled on the next reverse extraction)_

## Archived

_(empty)_
