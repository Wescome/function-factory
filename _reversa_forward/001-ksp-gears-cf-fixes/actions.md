# actions.md — ksp-gears CF Gate Fixes
> Feature: 001-ksp-gears-cf-fixes
> Source: _reversa_sdd/gate-diagnostics/cf-diagnosis-ksp-gears.md
> Date: 2026-06-10
> Note: CF001 (agents/zod-4 conflict) is an ARCHITECTURE GATE — requires Wes decision before T003+ can proceed.

---

## Fase 1 — Preparação

| ID | Ação | Arquivo(s) | Dep | Par | Status |
|----|------|-----------|-----|-----|--------|
| T001 | Add 5 Flue workflow DO bindings to `.flue/wrangler.jsonc` durable_objects.bindings — CF002 | `.flue/wrangler.jsonc` | — | — | [X] |
| T002 | Fix `skill_loader.ts:16`: change `".agent/skills"` to `".agents/skills"`, then delete `.agent/skills/` directory — CF005 | `.agents/tools/skill_loader.ts` | — | — | [X] |

---

## Fase 2 — Núcleo (BLOQUEADA — CF001 architecture gate)

| ID | Ação | Arquivo(s) | Dep | Par | Status |
|----|------|-----------|-----|-----|--------|
| T003 | ⛔ BLOCKED: Resolve agents/zod-4 conflict — choose: (A) patch agents, (B) isolate workers, (C) migrate @factory/* to zod 4 | TBD | CF001 decision | — | [ ] |
| T004 | Fill `<provision>` D1 database_id in `packages/gears/wrangler.jsonc` with real ID `6a72d5c3-bcbb-41e3-b29d-d8de5834c3b3` — CF004 | `packages/gears/wrangler.jsonc` | CF001 | — | [ ] |
| T005 | Provision KV namespace via `wrangler kv namespace create factory-gears-kv`, fill returned ID — CF004 | `packages/gears/wrangler.jsonc` | CF001 | — | [ ] |
| T006 | Verify `wrangler dev` boots after CF001 fix and T001-T005 applied | `.flue/wrangler.jsonc` | T001,T002,T003,T004,T005 | — | [ ] |
