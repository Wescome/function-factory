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
- No adoption phase — Container reconnects immediately
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

*Pending — to be added after Architect review.*
