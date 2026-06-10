# CF Diagnosis — ksp-gears
**Phase:** ksp-gears  
**Error source:** build (rolldown bundler) + wrangler config  
**Spec:** SPEC-FF-JUSTBASH-001-004, SPEC-FF-GEARS-001  
**Generated:** 2026-06-10  

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 1 |
| HIGH     | 3 |
| MEDIUM   | 2 |
| LOW      | 1 |

**Blocker chain:** CF001 must be resolved before any wrangler dev boot is even attempted. CF002 must be resolved before workflow routing works. CF003 is a local dev constraint. CF004 blocks D1 audit writes. CF005 and CF006 are non-blocking but will cause runtime regressions once the build is green.

---

## Findings Table

| ID | Severity | Error Pattern | Component | Spec Section | Description | Proposed Fix |
|----|----------|--------------|-----------|--------------|-------------|--------------|
| CF001 | CRITICAL | `[IMPORT_IS_UNDEFINED] fromJSONSchema` from `zod/v3/external.js` | `.flue/.flue-vite/_entry.ts` line 5 — `import { Agent, getAgentByName } from 'agents'` | SPEC-FF-GEARS-001 §6, NFR-06 | `agents@0.11.6` and `agents@0.14.1` both declare `peerDependencies.zod: ^4.0.0`. Monorepo is pinned to `zod@^3.23.0`. Flue's auto-generated entry bundles `agents` which pulls `zod@3.25.76` — that version has no `v3/external.js` and no `fromJSONSchema`. Build fails at rolldown/bundler stage before wrangler dev can start. | **3 options — Wes must choose (architecture gate):** (a) Patch: `pnpm patch agents` to remove the `fromJSONSchema` import. (b) Isolate: move `agents` behind its own worker so the zod-4 bundle never coexists with zod-3 in one Vite build. (c) Migrate: upgrade entire `@factory/*` schema layer to `zod@^4.0.0` (large blast radius). |
| CF002 | HIGH | `reqEnv.FLUE_ATOM_EXECUTION_WORKFLOW` is `undefined` at runtime → workflow routing silently fails | `.flue/wrangler.jsonc` — `durable_objects.bindings` section | SPEC-FF-JUSTBASH-004, Step 8 (Step 46 in tasks.md) | `.flue/wrangler.jsonc` has 5 classes in `migrations.new_sqlite_classes` (`FlueAtomExecutionWorkflow`, `FlueFactoryBuildWorkflow`, `FlueFactoryCompileWorkflow`, `FlueFactoryVerifyWorkflow`, `FlueRegistry`) but **no corresponding `durable_objects.bindings` entries**. `_entry.ts` expects bindings named `FLUE_ATOM_EXECUTION_WORKFLOW`, `FLUE_FACTORY_BUILD_WORKFLOW`, `FLUE_FACTORY_COMPILE_WORKFLOW`, `FLUE_FACTORY_VERIFY_WORKFLOW`, and `FLUE_REGISTRY`. Without these, `routeWorkflowRequest` always returns `null` and no workflow ever runs. | Add to `.flue/wrangler.jsonc` `durable_objects.bindings`: `{"name":"FLUE_ATOM_EXECUTION_WORKFLOW","class_name":"FlueAtomExecutionWorkflow"}`, `{"name":"FLUE_FACTORY_BUILD_WORKFLOW","class_name":"FlueFactoryBuildWorkflow"}`, `{"name":"FLUE_FACTORY_COMPILE_WORKFLOW","class_name":"FlueFactoryCompileWorkflow"}`, `{"name":"FLUE_FACTORY_VERIFY_WORKFLOW","class_name":"FlueFactoryVerifyWorkflow"}`, `{"name":"FLUE_REGISTRY","class_name":"FlueRegistry"}`. |
| CF003 | HIGH | `COORDINATOR_DO`, `ARTIFACT_GRAPH`, `BEAD_GRAPH`, `Sandbox` stubs unresolvable in isolated local dev | `.flue/wrangler.jsonc` — all 4 DO bindings carry `"script_name": "ff-pipeline"` | SPEC-FF-JUSTBASH-004 §"Env interface" | All DO bindings in `.flue/wrangler.jsonc` use cross-script service bindings pointing at `ff-pipeline`. In local `wrangler dev`, cross-script bindings require the target worker (`ff-pipeline`) to be running simultaneously. Running `wrangler dev` on `.flue` alone will not resolve these stubs — any call to `COORDINATOR_DO`, `Sandbox`, etc. will fail at runtime. This is not a config error per se but is the primary availability constraint for local e2e testing. | Two options: (a) Run both workers in parallel: `wrangler dev --config .flue/wrangler.jsonc` + `wrangler dev --config packages/ff-pipeline/wrangler.jsonc` simultaneously. (b) For isolated dev: temporarily replace `script_name: ff-pipeline` with local class declarations (add the DO class exports to `.flue`'s own entry) — then revert before deploy. |
| CF004 | HIGH | `D1_AUDIT` and `KV` bindings have `<provision>` placeholder IDs | `packages/gears/wrangler.jsonc` — `kv_namespaces[0].id` and `d1_databases[0].database_id` | SPEC-FF-GEARS-001 §11 | `packages/gears/wrangler.jsonc` (the merge reference doc) contains `"id": "<provision>"` for `KV` and `"database_id": "<provision>"` for `D1_AUDIT`. The skill reference table lists a known provisioned D1: `ff-factory`, id `6a72d5c3-bcbb-41e3-b29d-d8de5834c3b3`. The `D1_AUDIT` binding must carry this real ID before `wrangler d1 execute` can verify `writeAudit()` (Step 5a gate). `.flue/wrangler.jsonc` has no `d1_databases` section at all — if `D1_AUDIT` is needed by the `ff-flue` worker (rather than owned entirely by `ff-pipeline`), it must be added there too. | Replace `"database_id": "<provision>"` with `"6a72d5c3-bcbb-41e3-b29d-d8de5834c3b3"` in `packages/gears/wrangler.jsonc`. For `KV` id: provision via `wrangler kv namespace create factory-gears-kv` and fill in the returned ID. Confirm whether `D1_AUDIT` belongs to `ff-flue` or `ff-pipeline` — if `ff-pipeline`, remove from `packages/gears/wrangler.jsonc` merge reference and add to `ff-pipeline`'s wrangler instead. |
| CF005 | MEDIUM | Skills loaded from `.agent/skills` (old path) — W008 regression | `.agents/tools/skill_loader.ts` line 16: `const SKILLS_DIR = ".agent/skills"` | SPEC-FF-JUSTBASH-004 Step 46 (tasks.md Step 46) | Step 46 renamed `.agent/skills/` → `.agents/skills/` but was a copy not a move — both directories exist with identical content. `skill_loader.ts:16` still hardcodes the old singular path `.agent/skills`. Skills are currently found (old dir still present) but will silently break once `.agent/skills/` is cleaned up. `flue dev` skill discovery gate for Step 46 is unverified because the wrong dir is being read. | One-line fix: change `skill_loader.ts:16` from `".agent/skills"` to `".agents/skills"`. Then delete `.agent/skills/` directory. Run `flue dev` to confirm skill discovery from new path. |
| CF006 | MEDIUM | `Sandbox` container image path `./Dockerfile` does not exist | `packages/gears/wrangler.jsonc` line 27: `"image": "./Dockerfile"` | SPEC-FF-JUSTBASH-002 §"Sandbox container" | `packages/gears/wrangler.jsonc` declares a container with `"image": "./Dockerfile"` but no `Dockerfile` exists in `packages/gears/`. `wrangler dev` with container bindings will warn/error on missing image. | Either create the Dockerfile for the sandbox container image, or use the `@cloudflare/sandbox` pre-built image if available. If sandbox is only needed in production (not local dev), add a `wrangler.dev.jsonc` override that omits the containers section for local runs. |
| CF007 | LOW | `packages/gears/wrangler.jsonc` named `factory-gears` — could be confused with deployable worker | `packages/gears/wrangler.jsonc` header comment | SPEC-FF-GEARS-001 §11 | The file is a merge reference (says so in comment at top) but has `"name": "factory-gears"` which looks like a standalone worker. It cannot be deployed standalone since it references local class exports that need the full worker entry point. | Rename to `wrangler.merge-reference.jsonc` or add a more prominent banner comment: `// MERGE REFERENCE ONLY — not a standalone worker`. No runtime impact. |

---

## CRITICAL Detail — CF001

**Spec reference:** SPEC-FF-GEARS-001 §6 — "Only verified Flue APIs"; NFR-06 — "`tsc --noEmit` gate on every step" (build must pass before wrangler dev gate).

**Error origin:**
```
.flue/.flue-vite/_entry.ts:5  ← auto-generated by @flue/cli
  import { Agent, getAgentByName } from 'agents';
```

`agents@0.11.6` → `peerDependencies: { zod: "^4.0.0" }`  
`agents@0.14.1` → `peerDependencies: { zod: "^4.0.0" }`  (bumping version does NOT fix it)  
Monorepo resolved zod → `3.25.76` (no `v3/external.js`, no `fromJSONSchema`)  

**Option A — Patch (lowest blast radius):**
```bash
pnpm patch agents@0.11.6
# In patched dist/client-*.js: remove the fromJSONSchema import line
# OR stub it: export const fromJSONSchema = undefined;
pnpm patch-commit '/path/to/patch'
```

**Option B — Isolate (cleanest architecture):**
Move any code that imports `agents` into a separate worker package that pins `zod@^4.0.0`. `@factory/gears` and `atom-execution.ts` do not import `agents` directly — only `@flue/runtime` (via `_entry.ts`) does. So this may be moot: Flue's `_entry.ts` always pulls `agents` into the bundle.

**Option C — Migrate (most correct long-term):**
```bash
pnpm --filter '@factory/*' update zod@^4.0.0
```
Blast radius: every package that uses `z.infer`, `z.object`, etc. — requires testing all schema validation paths.

**Tasks.md reference:** Step 8 gate — "wrangler dev starts" — is blocked until CF001 is resolved.

---

## HIGH Detail — CF002

**Auto-generated `_entry.ts` expects these bindings in wrangler.jsonc `durable_objects.bindings`:**

```jsonc
// Add to .flue/wrangler.jsonc — durable_objects.bindings array:
{ "name": "FLUE_ATOM_EXECUTION_WORKFLOW",   "class_name": "FlueAtomExecutionWorkflow" },
{ "name": "FLUE_FACTORY_BUILD_WORKFLOW",    "class_name": "FlueFactoryBuildWorkflow" },
{ "name": "FLUE_FACTORY_COMPILE_WORKFLOW",  "class_name": "FlueFactoryCompileWorkflow" },
{ "name": "FLUE_FACTORY_VERIFY_WORKFLOW",   "class_name": "FlueFactoryVerifyWorkflow" },
{ "name": "FLUE_REGISTRY",                  "class_name": "FlueRegistry" }
```

These 5 classes are already in `migrations.new_sqlite_classes` ✓ — they just need binding declarations added.

**Tasks.md reference:** Step 8 — `cloudflare.ts + wrangler.jsonc` additions gate.

---

## HIGH Detail — CF003

**Cross-script binding topology (`ff-flue` ↔ `ff-pipeline`):**

| Binding | Owner worker | Where class lives |
|---------|-------------|------------------|
| `COORDINATOR_DO` | `ff-pipeline` | `@factory/gears` → `CoordinatorDO` |
| `ARTIFACT_GRAPH` | `ff-pipeline` | `@factory/artifact-graph` |
| `BEAD_GRAPH` | `ff-pipeline` | `@factory/bead-graph` |
| `Sandbox` | `ff-pipeline` | `@cloudflare/sandbox` → `Sandbox` |

For `wrangler dev` to work with these cross-script bindings, run both workers:
```bash
# Terminal 1 — ff-pipeline (owns the DO classes)
wrangler dev --config workers/ff-pipeline/wrangler.jsonc --port 8788

# Terminal 2 — ff-flue (Flue workflow runner, references ff-pipeline DOs)
wrangler dev --config .flue/wrangler.jsonc --port 8787
```

**Tasks.md reference:** Step 8 gate — "wrangler dev starts" — this is an operational constraint, not a config bug.

---

## Verified Clean Items

- `compatibility_date`: `.flue/wrangler.jsonc` → `"2026-06-10"` ✓
- `compatibility_flags`: `["nodejs_compat"]` ✓
- `SANDBOX_OUTPUT_BUCKET` R2 binding: `"bucket_name": "ff-workspaces"` ✓
- `KV_KS` namespace: ID `9fe793fc61174920b8030ac1d06cfd8c` (real provisioned ID) ✓
- `atom-execution.ts` Env interface: `COORDINATOR_DO`, `SANDBOX_OUTPUT_BUCKET`, `Sandbox`, API keys — matches expected bindings ✓
- `PROFILE_BY_ROLE` — no `sandbox` or `skill` fields on profiles ✓ (W002/W007 clean)
- `CoordinatorDO` exported from `packages/gears/cloudflare.ts` ✓
- `Sandbox` exported from `packages/gears/src/flue/sandbox.ts` ✓
- `atom-execution.ts` uses verified Flue API only (`createAgent`, `ctx.init`, `harness.fs.*`, `harness.session`, `session.skill`) ✓
- `migrations.new_sqlite_classes` in `.flue/wrangler.jsonc` correctly lists all 5 Flue DO classes ✓
- `tsc --noEmit` on `@factory/gears` → zero errors ✓
- Steps 45, 46 (partial), 47: marked `[X]` in tasks.md ✓

---

## No source or config files were modified.

---

## Next Steps

**CRITICAL (CF001):** Cannot proceed to `wrangler dev` until the `agents`/zod-4 conflict is resolved. Surface to `reversa-coding` with this report. Wes must choose strategy (A/B/C) — this is an architecture gate.

**HIGH (CF002):** Fix is mechanical (add 5 binding entries to `.flue/wrangler.jsonc`). Can be done immediately after CF001 unblocks. Surface to `reversa-coding`.

**HIGH (CF003):** Operational constraint — no code change needed. Document the two-terminal dev procedure.

**HIGH (CF004):** Fill `<provision>` IDs before `wrangler d1 execute` gate (Step 5a). Confirm D1 ownership (ff-flue vs ff-pipeline). Surface to `reversa-coding`.

**MEDIUM (CF005, CF006):** Pass to `reversa-coding` with proposed fixes inline — not blocking `wrangler dev` start, but will cause runtime failures before first real e2e execution.
