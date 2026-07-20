# Data Delta — 003-flue-retirement

> Diff against model extracted in `_reversa_sdd/`
> Generated: 2026-06-12

---

## 1. CoordinatorDO SQLite — No Change

Schema extracted in `_reversa_sdd/ksp-gears/design.md#7.1` is unchanged:

```sql
execution_beads(id, type, content, status, assigned_to, attempt_count, created_at, updated_at)
work_graph(id, run_id, org_id, molecule_id, work_graph_id, work_graph_version, seeded_at)
```

No migrations required. SM-6 transitions are driven by the same `claimHook()` / `releaseHook()` / `failHook()` calls, now issued from `ThinkExecutor.executeAtom()` instead of `atom-execution.ts`.

---

## 2. D1 factory-bead-audit — No Change

Schema from `_reversa_sdd/ksp-gears/design.md#7.2`:

```sql
bead_audit(run_id, bead_id, gear_id, agent_id, verdict, attempt, ts)
```

`writeAudit()` in CoordinatorDO is unchanged. `ThinkExecutor` calls the same CoordinatorDO `/release` and `/fail` routes; the audit write happens inside CoordinatorDO, not in the executor.

---

## 3. ThinkExecutor DO SQLite — New, Internal

`ThinkExecutor extends Think<Env>` gains its own DO SQLite via `@cloudflare/shell` for the durable workspace filesystem. This storage is:
- Scoped to the `ThinkExecutor` DO instance (per-run isolation)
- Managed internally by `@cloudflare/shell` — no manual schema migration needed
- Not exposed to any other Factory package
- Not queried by CoordinatorDO, BeadGraphDO, or ArtifactGraphDO

**wrangler migration required:**
```jsonc
{ "tag": "v2", "new_sqlite_classes": ["ThinkExecutor"] }
```

This is additive — no existing DO classes are modified.

---

## 4. KV Key Patterns — No Change

Patterns from `_reversa_sdd/ksp-gears/contracts.md#Wrangler DO Key Pattern` and `_reversa_sdd/ksp-bead-graph/`:

```
ks:{orgId}:{roleId}:{category}   TTL 300s
head:{orgId}:{bead_type}         TTL 300s
maintenance:{orgId}              TTL 60s
session:{sessionId}              TTL 3600s
coordinator:{runId}              (DO key, not KV)
```

Unchanged. `ThinkExecutor` does not write to KV.

---

## 5. BeadGraph — No Change

ConsentBead writes now originate from `ConsentBeadAuditProcessor` (in Mastra `outputProcessors`) rather than from the Flue session lifecycle. The **write shape** is identical — same bead type, same content schema, same `BeadGraphDO` target. The calling context changes (Mastra processor vs Flue session hook), not the data.

---

## 6. Env Bindings — Delta

Existing bindings (from `_reversa_sdd/ksp-gears/contracts.md#Env Bindings`):

| Binding | Status |
|---------|--------|
| `D1_AUDIT` | Unchanged |
| `ARTIFACT_GRAPH` | Unchanged |
| `BEAD_GRAPH` | Unchanged |
| `KV` | Unchanged |
| `ANTHROPIC_API_KEY` | Unchanged (now injected into Mastra model config, not Flue AgentProfile) |
| `OPENAI_API_KEY` | Unchanged |
| `DEEPSEEK_API_KEY` | Unchanged |
| `GITHUB_TOKEN` | Unchanged |

New bindings added to `wrangler.jsonc`:

| Binding | Type | Purpose |
|---------|------|---------|
| `THINK_EXECUTOR` | `DurableObjectNamespace<ThinkExecutor>` | ThinkExecutor DO — durable execution substrate |
| `DB` | `D1Database` | Mastra Memory (T3 Observational Memory via D1Store) |
| `SANDBOX` | CF Sandbox binding | Tier 4 execution (was already present for Gas City) |
| `LOADER` | Worker loader binding | Tier 1 Dynamic Worker isolate (codemode) |

Removed bindings:

| Binding | Reason |
|---------|--------|
| `Sandbox` (Flue-named) | Replaced by `SANDBOX` (standardised name) — same underlying CF Sandbox |
