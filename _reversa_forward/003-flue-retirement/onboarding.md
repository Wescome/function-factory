# Onboarding — 003-flue-retirement

> Step-by-step for a human testing this feature for the first time
> Generated: 2026-06-12

---

## Prerequisites

- Cloudflare account with Workers, Durable Objects, D1, KV enabled
- `pnpm` installed, repo cloned, `pnpm install` already run
- `wrangler` CLI authenticated (`wrangler whoami` returns your account)
- `@cloudflare/think` available (CF internal / early access — verify access before step 1)

---

## Step 1 — Verify the clean cut

After the feature is implemented:

```bash
# Must return zero hits
grep -r "@flue/runtime" packages/ workers/ --include="*.ts" --include="*.js"

# Must pass (may have pre-existing failures unrelated to this feature)
pnpm -r tsc --noEmit
```

Expected: no `@flue/runtime` references; `tsc` reports zero errors in `packages/gears/` and `workers/ff-pipeline/`.

---

## Step 2 — Start the local dev server

```bash
cd workers/ff-pipeline
wrangler dev
```

Expected: starts without binding errors. New DO binding `THINK_EXECUTOR` appears in the wrangler output. No `Cannot find class Sandbox` or Flue-related errors.

---

## Step 3 — Smoke test: single atom end-to-end (AC-1)

Seed a run and dispatch a single atom. The simplest path:

```bash
# From a test script or the wrangler dev console:
# 1. POST /init on CoordinatorDO (seeded run)
# 2. Dispatch via queue-handler (or trigger-synthesis-handler)
# 3. Observe: ThinkExecutor.executeAtom() runs, fiber completes
# 4. Verify: CoordinatorDO receives /release, D1 audit row written
```

You can use the existing `pnpm test` suite in `workers/ff-pipeline` to verify the dispatch path:

```bash
cd workers/ff-pipeline && pnpm test
```

Expected: all 26 previously-passing tests pass. No `vi.mock('@flue/runtime')` blocks in output.

---

## Step 4 — Kill-and-recover test (AC-2, NFR-01)

This is the primary durability test. It requires a live CF Workers environment (not `wrangler dev`):

1. Dispatch an atom that takes > 30 seconds (use a long-running `successCondition`)
2. Mid-execution, force-kill the Worker isolate (via `wrangler tail` + `Ctrl+C` on the isolate, or by deploying a new version while the fiber runs)
3. Observe: `onFiberRecovered` fires (check logs)
4. Observe: CoordinatorDO's stale-bead alarm (fires every 5 min) re-dispatches the bead
5. Observe: atom completes on the second dispatch

Expected: atom outcome is `success` or `failure` (never left in `in_progress`). No double-execution.

---

## Step 5 — I4 enforcement test (AC-6, NFR-02)

Dispatch an atom with a restricted `permittedTools` allowlist that excludes one tool the LLM will try to call:

```typescript
// In the AtomDirective:
permittedTools: ['workspace_read']  // excludes 'execute', 'sandbox_run', etc.
```

Expected:
- LLM attempts a disallowed tool call
- `ConsentBeadAuditProcessor` throws `ConsentDeniedError` in Mastra `outputProcessors`
- Tool is never executed
- CoordinatorDO receives `/fail` with the bead ID
- Bead transitions to `failed` per SM-6

---

## Step 6 — Skill parity (AC-5)

Run a directive that was working under Flue with a `skillRef` pointing to an existing `.agents/skills/<name>/SKILL.md`:

```typescript
skillRef: 'reversa'  // or any other skill in .agents/skills/
```

Expected: `session.withSkill(skillRef)` loads the same file content as `session.skill(skillRef)` did previously. No skill files should be modified.

---

## Step 7 — Update Linear issues (FR-10)

Update WEO-7, WEO-8, WEO-9, WEO-12, WEO-15 to reflect that Flue/Gas City execution paths are replaced. Mark any blocked issues as unblocked.
