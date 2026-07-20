# Session Handoff — 2026-06-11

## Status

Engineer agent deploying abort-fix + thinkingLevel change + e2e run `-012` right now. Check `SendMessage to: 'a989a999afc274a66'`.

---

## What was done this session

### Gas City cleanup
Deleted all Gas City and Arango ops scripts from `scripts/ops/`. Only `configure-r2-lifecycle.sh` and `rollback.sh` remain.

### Flue atom-execution pipeline — every layer proven in production

| Layer | Status |
|-------|--------|
| `POST /debug/seed-molecule` → CoordinatorDO | ✅ |
| `seedBeads()` + `initRun()` on CoordinatorDO | ✅ |
| `getNextReady()` unseeded-vs-complete guard | ✅ |
| `POST /workflows/atom-execution` dispatch | ✅ |
| Flue workflow DO bead claim | ✅ |
| Agent session init + skill discovery before `init()` | ✅ |
| CF Workers AI binding `@cf/moonshotai/kimi-k2.6` reached | ✅ |
| D1_AUDIT `bead_audit` table created in production | ✅ |

### Uncommitted code changes

**`packages/gears/src/beads/coordinator-do.ts`**
- `seedBeads()` — idempotent bead + edge insert, `blockConcurrencyWhile`, deterministic timestamps
- `/seed` HTTP route
- `initRun()` arms stale-bead alarm (was never armed)
- `getNextReady()` throws on unseeded molecule

**`packages/gears/src/flue/workflows/atom-execution.ts`**
- `cwd` desync fix — `cfSandboxToSessionEnv` now receives `cwd`
- `gitCheckout` before `init(agent)` for container atoms
- Skill injection (`SKILL_CONTENT`) before `init()` — pre-seeded `InMemoryFs` for virtual sandbox
- Provider wiring: direct Anthropic/OpenAI (no ofox), `registerProvider + registerApiProvider` for CF Workers AI binding
- `storeFullOutput` non-fatal
- **Timeout fix** (Engineer deploying now): `Promise.race` → `AbortController` + `handle.abort()` on timeout

**`packages/gears/src/flue/agents.ts`**
- `coderProfile` model: `cloudflare/@cf/moonshotai/kimi-k2.6` (correct ID from models.dev)
- `coderProfile` `thinkingLevel: 'low'` (was defaulting to `"medium"` → 5+ min thinking on trivial tasks)

**`packages/gears/package.json`** — `@cloudflare/sandbox` pinned `^0.12.0`

**`workers/ff-pipeline/src/index.ts`** — `POST /debug/seed-molecule` added

**`workers/ff-pipeline/src/types.ts`** — `WORKSPACE_BUCKET: R2Bucket`, `OFOX_API_KEY: string` (both required now)

**Deleted** — `.flue/.flue-vite/_entry.ts` + `.flue/.flue-vite.wrangler.jsonc` (competing DO, was breaking secret propagation)

**Added** — `scripts/ops/e2e-atom.sh`, `workers/ff-pipeline/.dev.vars` template

---

## Known broken tests (pre-existing, same root cause)

Six other test files in `workers/ff-pipeline` fail with the identical `ERR_UNSUPPORTED_ESM_URL_SCHEME` / `cloudflare:` protocol error. All were broken **before this session** — confirmed via `git stash`. They all import `./index` and hit the same `@factory/gears` → `@flue/runtime/cloudflare` barrel taint.

| Test file | Status |
|-----------|--------|
| `src/diagnostic-routes.test.ts` | broken, pre-existing |
| `src/dispatch-formula-route.test.ts` | broken, pre-existing |
| `src/cf-workers.test.ts` (pi-container-execute-route) | broken, pre-existing |
| `src/pr-outcome-queue.test.ts` | broken, pre-existing |
| `src/atoms-complete-wiring.test.ts` | broken, pre-existing |
| `src/cf-gates.test.ts` (smoke-e2e-handler) | broken, pre-existing |

**Fix pattern:** Extract each route/handler into its own module with a clean import graph (type-only imports only), wire `index.ts` to delegate, update test to import the handler directly — exactly what was done for `queue-handler.ts` and `trigger-synthesis-handler.ts` this session.

**Alternative:** Migrate to `@cloudflare/vitest-pool-workers` which natively supports `cloudflare:*` protocol and eliminates the extraction requirement entirely.

---

## Open after e2e passes

1. **Commit everything** — nothing committed this session
2. **`/runs/:id` pagination** — caps at 100 events, ignores `after=`. Blind past event 99.
3. **`WORKSPACE_BUCKET.put` in `storeFullOutput`** — throws despite guard passing. Marked non-fatal. Investigate CF R2 scope in DO context.
4. **`recordOutcome()` in CoordinatorDO** — stub. Phase 3 HARD GATE.
5. **OFOX_API_KEY** — current code bypasses ofox (direct Anthropic). Anthropic key in worker has zero credits. Either top up or keep direct routing.
6. **Arango naming debt** — `checkArango` → `checkD1` in `index.ts`
7. **kimi timeout for real tasks** — `timeoutMs` should be 5–10 min per atom type. Set in WorkGraph compiler when built.

---

## Architecture facts confirmed

- **D1 for `bead_audit`** is intentional — cross-run audit, can't query across DOs
- **`Promise.race` ≠ cancellation** — must use `AbortController` + `handle.abort()`. Flue's cancel chain is fully wired, just needs arming.
- **kimi CF model ID** = `@cf/moonshotai/kimi-k2.6` (from models.dev, not `kimi-k2.6`)
- **`thinkingLevel: 'low'`** is the floor for kimi on CF — `"none"` doesn't exist
- **Competing `.flue-vite` DO** was root cause of missing secrets in DO env

---

## Deploy

```bash
cd /Users/wes/Developer/function-factory/workers/ff-pipeline && wrangler deploy
```

Production: `https://ff-pipeline.koales.workers.dev`
