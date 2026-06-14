# Regression Watch — 003-flue-retirement

> Feature: Retire `@flue/runtime`; migrate atom execution to Cloudflare Agents SDK + Project Think (Option B)
> Source: `legacy-impact.md` §Modificadas

---

## Watch Items

| ID | Origem (arquivo, seção) | Regra esperada após mudança | Tipo de verificação | Sinal de violação |
|----|------------------------|----------------------------|--------------------|--------------------|
| W001 | `workers/ff-pipeline/wrangler.jsonc`, `durable_objects.bindings` | `THINK_EXECUTOR` binding with `class_name: "ThinkExecutor"` present; no `ATOM_EXECUTOR`, `FlueAtomExecutionWorkflow`, or `FlueRegistry` bindings. | presença + ausência | Any binding named `ATOM_EXECUTOR`, `FlueAtomExecutionWorkflow`, or `FlueRegistry` found in wrangler config. |
| W002 | `workers/ff-pipeline/src/queue-handler.ts`, atom-execute branch | `env.THINK_EXECUTOR.idFromName(`think-${executableSpecificationId}-${atomId}`)` is the DO dispatch pattern. No `ATOM_EXECUTOR` or `atom-${...}` identifier. | redação | `atom-${executableSpecificationId}` or `ATOM_EXECUTOR` identifier found in atom-execute branch. |
| W003 | `packages/gears/src/index.ts`, barrel exports | `ThinkExecutor`, `buildConductingAgent`, `MODEL_BY_ROLE`, `ConsentBeadAuditProcessor` exported. No `flue/` path exports. | presença + ausência | Any export path containing `./flue/` found in barrel. Any of the four required symbols missing from barrel. |
| W004 | `packages/gears/src/agents/models.ts`, `MODEL_BY_ROLE` | kimi-k2.6 `coder` role model has `gateway: false` or equivalent direct Workers AI binding (BR-FLUE-04). | redação | `MODEL_BY_ROLE['coder']` routes through AI Gateway (no bypass flag). |
| W005 | `workers/ff-pipeline/src/queue-bridge.test.ts`, v5.1 atom-execute suite | 4 tests mock `THINK_EXECUTOR` binding; `idFromName` called with `think-${executableSpecificationId}-${atomId}` pattern. | presença | Any test mocking `ATOM_EXECUTOR`; `mockIdFromName` called with `atom-${...}` pattern. |
| W006 | `packages/gears/` (repo-wide grep) | Zero hits for `@flue/runtime` in `.ts`/`.js` files under `packages/` and `workers/`. | ausência | `grep -r "@flue/runtime" packages/ workers/ --include="*.ts" --include="*.js"` returns any hit. |
| W007 | `workers/ff-pipeline/src/queue-handler.ts`, `trigger-synthesis-handler.ts` — import section | Both files use only type-only static imports; no direct static import of `@factory/gears`, `@cloudflare/*`, or `cloudflare:*` (BR-FLUE-06). | redação | Any non-type static import of `@factory/gears` or `@cloudflare/` in either handler file. |
| W008 | `packages/gears/src/processors/consent-bead-audit-processor.ts`, `processOutputStep` | `ConsentBeadAuditProcessor` checks tool name against `directive.permittedTools` BEFORE tool runs; throws `ConsentDeniedError` on denied tool. Fail-closed single enforcement point. | redação | I4 enforcement moved out of `outputProcessors` (e.g., into `beforeToolCall` on ThinkExecutor which has no LLM lifecycle, or removed entirely). |

---

## Histórico de Re-extrações

_(Preenchido pelo agente reverso quando `/reversa` for executado novamente.)_

---

## Arquivadas

_(Itens de watch que se tornaram irrelevantes serão movidos aqui.)_

---

## Observações (não são itens de regressão)

| Origem | Observação |
|--------|-----------|
| `investigation.md §8` (🟡 INFERRED) | `session.withSkill(skillRef)` path parity: `@cloudflare/think` uses SkillSource registry model, not path resolution. Any Factory code using path-based skill invocation must migrate (tracked separately). Not a regression for this feature — `ThinkExecutor` does not invoke skills directly. |
| `legacy-impact.md §Modificadas` (BR-FLUE-05) | `storeFullOutput` non-fatal write to R2 (`WORKSPACE_BUCKET`): this was a Flue-specific behavior. `ThinkExecutor` does not have an equivalent write. If R2 output archiving is needed, it must be added explicitly. |
