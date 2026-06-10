# Architect Review — Function Factory GEARS
Date: 2026-06-10

## TL;DR
`packages/gears/` and `.flue/workflows/atom-execution.ts` are **already built and type-clean**.
`/Users/wes/Downloads/CLAUDE.md` is a **stale pre-implementation build sheet** — it describes a greenfield state that no longer exists. Do not give it to a coding agent as-is.

---

## What Is DONE (type-clean, spec-aligned)

- `packages/gears/` — fully built: `flue/sandbox.ts`, `flue/agents.ts`, `beads/{types,coordinator-do,hook,d1-audit}.ts`, `gears/{types,role}.ts`, `index.ts` barrel. `pnpm --filter @factory/gears typecheck` → zero errors.
- `.flue/workflows/atom-execution.ts` — fully implemented. All 15 FRs from `requirements.md`: deterministic DO key (sha256), `POST /init` before `getNextReady`, claim/parse/execute/release lifecycle, `PROFILE_BY_ROLE` selection, container-vs-virtual sandbox, retry loop, `evaluateSuccessCondition`, R2 overflow, `extractWorkspaceDelta`.
- `packages/schemas/src/atom-directive.ts` — `skillRef` AND `role` added (lines 87, 94).
- Stub deletion done — `packages/harness-bridge/` and `packages/runtime/` are gone.
- `PROFILE_BY_ROLE` has no `deriveRole()` and no `sandbox`/`skill` fields on profiles — satisfies W002/W007.
- SDD spec (`_reversa_sdd/ksp-flue-workflow/tasks.md`) marks Steps 45-47 `[X]` and records typecheck EXIT 0 across 50 packages.

---

## What Is WRONG

### 1. CLAUDE.md's `agents: ^0.14.1` fix does NOT work — zod 3↔4 conflict
- `agents@0.11.6` requires `zod ^4.0.0`
- `agents@0.14.1` also requires `zod ^4.0.0`
- The entire `@factory/*` schema layer is pinned to `zod ^3.23.0`
- Bumping `agents` version changes nothing — the major-version conflict persists
- Broken call sites: `node_modules/agents/dist/client-D1kFXo80.js:1472` and `experimental/memory/session/index.js:553`
- `agents` is pulled in by `.flue/.flue-vite/_entry.ts` and `workers/ff-pipeline/` — not by `gears` source directly
- **Typecheck is green but `wrangler dev` / `flue dev` cannot boot**

### 2. W008 regression — `.agent/skills/` rename was a copy, not a move
- Both `.agent/skills/` (old) and `.agents/skills/` (new) exist with identical contents
- `.agents/tools/skill_loader.ts:16` still hardcodes `const SKILLS_DIR = ".agent/skills"` (singular)
- Skills are maintained in two places; the loader reads the stale one
- **One-line fix required:** change that path and delete the duplicate dir

### 3. CLAUDE.md's repo map is wrong
| CLAUDE.md claims | Reality |
|-----------------|---------|
| `packages/conducting-agent/src/types.ts` — retire GasCitySession*, add FlueSessionResult | `packages/conducting-agent/` does not exist |
| Edit root `cloudflare.ts` and root `wrangler.jsonc` | These live at `packages/gears/cloudflare.ts`, `packages/gears/wrangler.jsonc`, and `.flue/wrangler.jsonc` |
| `gears/package.json` deps include `agents: ^0.14.1` | Real package.json has no `agents` dep; has `@factory/factory-graph` and `@factory/loop-closure` instead |
| `packages/gears/` does not exist yet | It exists and is complete |
| `.flue/workflows/atom-execution.ts` does not exist yet | It exists and is complete |

### 4. `AtomDirective` has more fields than CLAUDE.md describes
CLAUDE.md says add only `skillRef`. Real schema added `skillRef` + `role` + `atomId` + `runId`, and the field list differs from CLAUDE.md's claimed baseline. This is correct per the SDD spec (FR-13) but any agent reading CLAUDE.md will try to "fix" the schema.

---

## What Is Genuinely Missing / Unresolved

| Item | Blocking what |
|------|--------------|
| `agents`/zod-4 runtime conflict | `wrangler dev` / `flue dev` cannot start |
| `<provision>` placeholders in `packages/gears/wrangler.jsonc` (KV id, D1 database_id) | Cannot `wrangler dev` / deploy |
| `.agents/tools/skill_loader.ts:16` still reads `.agent/skills` | Skills unavailable at runtime |
| Split-worker binding coherence unverified | DO bindings across `ff-flue` ↔ `ff-pipeline` never booted |
| `workers/gascity-supervisor/` still present | Gas City not fully retired |

---

## Architecture Decision Required (Gate — Wes must decide)

### 1. Zod strategy (BLOCKS EVERYTHING)
Three options:
- **(a) Patch `agents`** — pin/patch to a build that supports zod 3 (if one exists)
- **(b) Migrate `@factory/*` to zod 4** — large blast radius across all schema packages
- **(c) Isolate `agents`** — move it behind its own worker so zod-4 island never bundles with zod-3

### 2. Retire or regenerate CLAUDE.md
`/Users/wes/Downloads/CLAUDE.md` will misdirect any coding agent that consumes it. Either delete it or regenerate from the current SDD spec in `_reversa_sdd/ksp-flue-workflow/`.

### 3. Approve W008 fix
Change `skill_loader.ts:16` to `.agents/skills` and delete `.agent/skills/`.

### 4. Confirm split-worker binding topology
Is the `ff-flue` ↔ `ff-pipeline` cross-script DO binding topology intentional before provisioning IDs and booting?

---

## Real Source of Truth
`/Users/wes/Developer/function-factory/_reversa_sdd/ksp-flue-workflow/` — not CLAUDE.md.
