# DO Migration Research — bd/Dolt Feature Analysis

Date: 2026-05-31
Status: Research complete — Architect assessment pending
Scope: What Gas City gets from bd/Dolt, what DO SQLite loses, and whether those losses are acceptable for the Factory

---

## 1. Dolt Architecture (from Wes, 2026-05-31)

Dolt does not contain Git or MySQL code. It is three pieces:
- **Noms** — version-controlled storage layer
- **Vitess** — MySQL-compatible parsing and serving
- **Dolt glue** — commit graph management, Prolly Tree maintenance

The storage engine is a Git-style commit graph of **Prolly Trees** — a novel search tree related to B-trees but with version-control properties. Table schema and data is stored in these trees; their roots are stored in a commit graph to provide Git-style versioning.

**Critical implication:** The commit graph IS the storage cost, not the rows. Every committed change generates a Dolt commit-graph node. DELETE a row and the commit that wrote it still exists in history. `dolt gc` reclaims unreferenced chunks but the commit graph grows forever. Full compaction requires `DELETE + rebase + gc`, not just `DELETE + gc`.

---

## 2. bd CLI Version-Control Features (sourced from gastownhall/beads)

Every `bd` write command (`bd create`, `bd update`, `bd close`) calls `maybeAutoCommit()` which fires `DOLT_COMMIT -Am` after the operation. There is no CRUD-only mode. **The commit history IS the persistence unit.**

### Fully implemented in bd

| Feature | Command | Description |
|---------|---------|-------------|
| Auto-commit | every write | `DOLT_COMMIT -Am` after every mutation |
| Manual checkpoint | `bd vc commit -m` | explicit commit with message |
| Per-issue history | `bd history <id>` | full Dolt commit walk for one bead — real time-travel, not a changelog table |
| Cross-ref diff | `bd vc diff <ref1> <ref2>` | field-level diff between any two Dolt refs |
| Branching | `bd branch [name]` | create/list Dolt branches |
| Multi-agent merge | `bd vc merge --strategy ours\|theirs` | cell-level 3-way merge on concurrent writes |
| Remote sync | `bd dolt push/pull` | push/pull to Dolt remotes (R2, DoltHub, S3) |
| Auto-push | config `dolt.auto-push=true` | debounced push after writes, hash-based change detection |
| Native backup | `bd backup sync/restore` | Dolt-native, preserves full commit history and branches |
| Conflict detection | `bd vc conflicts` | list unresolved merge conflicts |
| Conflict resolution | `bd vc resolve` | resolve conflicts after multi-agent pull |
| Orphan detection | `bd doctor --agent` | structured JSON cross-referencing open issues against Dolt history |

### Auto-commit behavior by mode

- **Embedded mode** (standalone): auto-commit ON — one Dolt commit per write command
- **Server mode** (Gas City managed Dolt): auto-commit OFF by default to avoid race conditions under concurrent agent access. Commits triggered manually or via `bd vc commit`.

---

## 3. Gas City Agent Usage of bd

### What agents actually call

Gas City's `BdStore` (`internal/beads/bdstore.go`) calls the `bd` CLI as a subprocess via `s.runner("bd", ...)`. Every call confirmed in source:

```
bd init --server          — initialize store
bd create --json          — create bead
bd show --json <id>       — get bead
bd update --json <id>     — update bead
bd close --force --json   — close bead
bd reopen --json <id>     — reopen bead
bd delete --force --json  — delete bead
bd list --json            — list beads
bd query --json           — query beads
bd ready --json           — get ready beads
bd dep list               — list dependencies
bd dep remove             — remove dependency
bd purge --json           — cleanup
bd config set             — config
```

### What Gas City does NOT call

Zero confirmed calls in Gas City source to:
- `bd history`
- `bd vc diff`
- `bd branch`
- `bd vc merge`
- `bd vc commit`
- `bd dolt push/pull`
- `bd doctor --agent`

### How agents interact with the VC layer

Gas City agents are **passive consumers of bead state**. They don't manage version control — the supervisor owns the bead lifecycle. The Dolt substrate provides:

1. **Implicit audit trail** — every write auto-commits (server mode: OFF; embedded mode: ON). Full history of bead state changes available to operators via `dolt log`.
2. **Multi-agent merge safety** — Dolt's cell-level 3-way merge prevents concurrent agent writes from corrupting bead state in server mode.
3. **Rollback capability** — operators can `dolt checkout <commit>` to restore bead state after a bad agent run. No agent calls this; it's an operational escape hatch.
4. **`bd doctor --agent`** — structured JSON for detecting orphaned beads via Dolt history. Gas City uses this in doctor checks; agents could consume it.

---

## 4. Gas City Version Status

- Current branch: `factory` (Wescome fork)
- **0 commits behind upstream** `gastownhall/gascity main`
- **32 commits ahead** (Factory-specific additions)
- We are on the latest upstream Gas City

### Notable upstream commits already merged

- `d0f6ad0d Allow CachingStore to wrap any beads Store` — DO-backed store can be wrapped in CachingStore to reduce round-trip latency
- `ef7fb4f1 Add minimal Store.Tx contract` — Tx interface just got upstream minimal contract
- `a6f900b4 fix(beads): skip dolt auto-recover on ENOSPC` — Dolt disk-full cascade fix (relevant: we're replacing Dolt, not fixing it)
- `37824e04 fix(cmd/gc/bd): surface bd silent on-disk fallback as loud error` — bd silent failure fix

---

## 5. Rig-Level Bead Stores

Gas City has **two distinct bead store scopes**:

1. **City store** — one store for the whole city (`beads.provider` in `city.toml`). The DO spec addresses this.
2. **Rig stores** — `standaloneRigStores` in `CityRuntime` (`city_runtime.go:89`). Each declared `[[rig]]` in `city.toml` gets its own `beads.Store` opened at `rig.Path` via `openStoreAtForCity(rig.Path, cityPath)`. Used for session sync, orphan sweeping, pool assignment, work dispatch.

`buildStandaloneRigStores` (`city_runtime.go:2394`) opens a separate store for each rig. `rigBeadStores()` (`city_runtime.go:2226`) returns the map; called in control loop, session sync, orphan sweep, pool assignment.

**Gap in DO spec:** The spec addresses the city store only. Rig stores are not addressed. Each rig that uses `provider = "bd"` has its own Dolt instance at `rig.Path/.beads/`. With DO, where does `DoStore` for a rig point — same DO with rig-scoped routes, or separate DO keyed by rig name?

---

## 6. DO SQLite Feature Losses

Replacing `bd`/Dolt with DO SQLite loses:

| Feature | Lost | Severity | Factory Uses It? |
|---------|------|----------|-----------------|
| Audit trail (commit history) | Yes | Medium | No direct usage confirmed |
| Rollback via `dolt checkout` | Yes | Medium | No — operational escape hatch only |
| Multi-agent 3-way merge | Yes | Low-Medium | Partially — 3 concurrent coders + 1 dispatcher |
| `bd doctor --agent` history | Yes | Low | Not confirmed in ff-pipeline |
| Native backup with history | Yes | Low | Replaced by DO persistence |
| `bd history <id>` | Yes | Low | Not called by Gas City |
| `bd vc diff` | Yes | Low | Not called by Gas City |
| Commit graph growth (unbounded) | Eliminated | Benefit | n/a |
| Dolt cold-start / adoption hang | Eliminated | Benefit | Was causing production failures |

### What DO SQLite gains

- No commit graph — storage cost = live row set only
- No cold-start — DO is always live
- Adoption phase remains in startup FSM, but Dolt-specific blocking/cold-start behavior is removed
- Real SQLite FKs across execution/knowledge planes (`emission_bead_id`)
- Single-writer serialization (no concurrent write corruption, different mechanism from Dolt merge)
- `PRAGMA foreign_keys = ON` — referential integrity at storage layer

---

## 7. Open Questions for Architect Assessment

1. Does the Factory need per-bead audit trail? The Factory has its own lineage system (`source_refs`, Factory artifacts, `emission_bead_id` FK). Does bead-level commit history add anything not already captured in the knowledge plane?

2. Is rollback via `dolt checkout` a real operational need? Molecules are short-lived. If a molecule corrupts bead state, can the Factory recover by re-dispatching rather than rolling back?

3. Is 3-way merge safety required? Factory runs `max_active_sessions = 3` coders + 1 control-dispatcher. DO SQLite serializes writes — is that sufficient, or do concurrent writes require merge semantics?

4. Is `bd doctor --agent` used anywhere in the Factory pipeline? If not, its loss is theoretical.

5. How are rig stores handled? If the Factory's `factory-coding-v1` formula uses `[[rig]]` declarations, those rig stores need a DO solution too.

---

## 8. Architect Assessment

Date: 2026-05-31
Reviewer: Architect agent
Method: Read §1–§7 in full, then verified each claimed loss against live source —
`workers/gascity-supervisor/factory/city.toml`, `workers/ff-pipeline/src/**`,
and `workers/ff-pipeline/src/gascity/**`. Findings below cite the evidence, not the
research narrative.

### Evidence base

- `factory/city.toml`: `[beads] provider = "bd"`; one `coder` agent block with
  `max_active_sessions = 3`; one `control-dispatcher` with `max_active_sessions = 1`.
  **No `[[rig]]` blocks declared** (grep for `[[rig]]` / `rig` returned empty).
- `bd doctor`, `bd history`, `bd vc diff/merge/commit`, `bd branch`, `bd dolt push/pull`:
  **zero references** anywhere under `ff-pipeline/src/` (non-test). The single match for
  "rollback" is `coordinator.ts:397` — a git-revert escape hatch for a Gate-6 commit,
  entirely unrelated to Dolt/bead rollback.
- `emission_bead_id` / `doctor`: **zero non-test references** in `ff-pipeline/src/`.
  The FK lives in the webhook/knowledge-plane payload schema, threaded through
  `source_refs[]` chains in `gascity/webhook-receiver.ts` (lines 171, 449, 476, 530)
  and `gascity/autonomy-monitor.ts` (line 322), plus a hard `lineage_mismatch` 409
  guard (webhook-receiver.ts:129–136). Factory lineage is reconstructed from
  artifact `source_refs`, not from bead commit history.

### Per-loss assessment

**1. Audit trail (bead-level commit history) — ACCEPTABLE.**
The Factory's audit truth lives in the knowledge plane: every emitted artifact carries
`source_refs[]` and an `emission_bead_id` FK, and the webhook receiver hard-rejects any
emission whose lineage does not resolve (409 `lineage_mismatch`). Dolt's per-write commit
log records *bead state transitions*, which are mechanical work-queue events — not Factory
provenance. The provenance the Factory actually reasons over is already captured, in a
queryable form, independent of bead storage. Bead-level commit history adds an operator
convenience (`dolt log`) the pipeline never consumes.

**2. Rollback (via `dolt checkout`) — ACCEPTABLE.**
No code path invokes Dolt rollback; the only rollback in the pipeline is git-based and
operates on the workspace, not the bead store. Molecules are short-lived (seconds–minutes)
and beads are work-queue state, not the system of record — the artifacts are. Corrupted bead
state is recovered by re-dispatch, and DO single-writer serialization plus `PRAGMA
foreign_keys = ON` makes partial/torn writes far less likely than the failure modes Dolt
itself introduced (ENOSPC auto-recover cascade, cold-start/adoption hang). Re-dispatch is a
strictly simpler and already-exercised recovery path.

**3. Multi-agent merge safety — ACCEPTABLE.**
Dolt's cell-level 3-way merge defends against *concurrent writers to the same store* with no
serialization. DO SQLite removes the premise: a Durable Object is a single-threaded,
single-writer actor — all writes from the 3 coders + 1 dispatcher are serialized by the DO
event loop, so there is no concurrent-write window to merge. The contention Dolt merge solves
cannot occur. Serialization is not merely sufficient; it is a stronger guarantee (no
conflicts to resolve, no `bd vc conflicts`/`resolve` surface to operate) at this scale. The
only caveat is throughput: 4 writers serialized through one DO is fine at
`max_active_sessions = 3`; it would need revisiting at city scales an order of magnitude
larger, which is out of scope here.

**4. `bd doctor --agent` — ACCEPTABLE (loss is theoretical).**
Zero references in `ff-pipeline/src/`. Gas City's own doctor checks may call it, but the
Factory pipeline does not consume orphan-detection-via-Dolt-history. Orphan detection that
the Factory cares about (artifacts whose lineage does not resolve) is enforced at emission
time by the `lineage_mismatch` guard, not after the fact via bead history. The loss is
theoretical for the Factory.

**5. Rig stores — ACCEPTABLE (moot).**
`factory/city.toml` declares **no `[[rig]]` blocks**. The §5 gap — "where does `DoStore`
for a rig point?" — has no referent in the Factory's actual configuration. The DO spec's
city-store-only scope fully covers the Factory as configured today. If a future formula
introduces `[[rig]]` declarations, the rig-store routing question (rig-scoped routes within
one DO vs. a DO keyed by rig name) reopens and must be answered before that formula ships —
but it is not a blocker now.

### Final verdict

**DO migration is ACCEPTABLE for the Factory.**

Every claimed loss is either (a) already compensated by the Factory's own lineage system
(`source_refs` + `emission_bead_id` + emission-time `lineage_mismatch` enforcement), (b)
structurally eliminated by the DO single-writer model (merge safety), or (c) unused by the
pipeline today (audit log, `dolt checkout` rollback, `bd doctor --agent`, rig stores). The
migration also removes two losses that were causing real production failures — the Dolt
cold-start/adoption hang and the unbounded commit-graph growth — which the Factory's
quality-over-speed and self-healing posture cannot tolerate. Trading version-control features
the Factory never calls for the elimination of two confirmed production failure modes is a
net architectural win.

No compensations are *required* to proceed. Three conditions attach as guardrails, not
blockers:

1. **Rig-store gate.** Before any formula introduces a `[[rig]]` block, answer the
   rig-store routing question (rig-scoped routes in one DO vs. DO-per-rig). Track as an
   open architecture gate, not a migration blocker.
2. **Throughput watch.** DO single-writer serialization is sufficient at
   `max_active_sessions = 3`. If active sessions scale up by ~10x, re-evaluate whether one
   DO per city remains adequate or whether sharding is needed. (Note: §4 records that
   upstream `CachingStore` can wrap the DO-backed store to cut read round-trips — relevant
   if read latency, not write throughput, becomes the constraint.)
3. **Operator escape hatch.** Re-dispatch replaces `dolt checkout` as the recovery path.
   Confirm the operator runbook documents re-dispatch as the sanctioned recovery for
   corrupted bead state, since the Dolt time-travel escape hatch is going away.
