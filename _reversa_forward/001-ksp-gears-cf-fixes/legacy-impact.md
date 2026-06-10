# legacy-impact.md — 001-ksp-gears-cf-fixes
Date: 2026-06-10

## Arquivos Afetados

| Arquivo afetado | Componente | Tipo | Severidade | Justificativa |
|-----------------|-----------|------|-----------|---------------|
| `.flue/wrangler.jsonc` | ff-flue Worker / Flue workflow runtime | `regra-nova` | HIGH | Added 5 missing DO bindings — without these, `routeWorkflowRequest` returned null for all workflow names |
| `.agents/tools/skill_loader.ts` | Skill discovery / .agents layer | `regra-alterada` | MEDIUM | SKILLS_DIR path corrected from `.agent/skills` to `.agents/skills` — was reading from stale directory |

## Diff conceitual por componente

**ff-flue Worker (`wrangler.jsonc`):** The 5 Flue-generated DO classes (`FlueAtomExecutionWorkflow`, `FlueFactoryBuildWorkflow`, `FlueFactoryCompileWorkflow`, `FlueFactoryVerifyWorkflow`, `FlueRegistry`) were present in `migrations.new_sqlite_classes` but had no corresponding `durable_objects.bindings` entries. The auto-generated `_entry.ts` looked up these bindings by name at runtime — all returned `undefined`, causing silent routing failure for every workflow invocation. Now bound correctly.

**Skill loader (`.agents/tools/skill_loader.ts`):** `SKILLS_DIR` was hardcoded to `.agent/skills` (singular), the pre-rename path. The Step 46 rename created `.agents/skills/` (plural) as a copy but never updated this reference. Skills were still loading from the old path. Now points to `.agents/skills`. The old `.agent/skills/` directory still exists and should be deleted by running `rm -r .agent/` (only `skills/` is inside it).

## Preservadas

All confirmed 🟢 domain rules from `_reversa_sdd/domain.md` are intact:
- BR-KSP-16: `POST /init` before `getNextReady()` — not touched
- BR-KSP-17: `writeAudit()` D1 insert — not touched
- BR-KSP-18: `evaluateSuccessCondition` async with harness — not touched
- BR-KSP-19: `PROFILE_BY_ROLE[directive.role]` — not touched
- GD-002: Deterministic CoordinatorDO key — not touched
- W002/W007: No `sandbox`/`skill` fields on profiles — not touched

## Modificadas

None — no business rules were changed, only config and a path constant.
