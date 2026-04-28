# Function Factory Terminal Implementation Backlog

Status: source-of-truth backlog for implementing the Function Factory Terminal.

This backlog is intentionally atomized so each item can be implemented by an autonomy level 3 loop: apply changes, run gates, and commit. Each atom should be one issue and one commit unless explicitly stated otherwise.

## Operating Rules

- Force one issue at a time.
- Keep `RALPH_AUTONOMY=3` for implementation iterations.
- Use `RALPH_AUTONOMY=4` only after issue comments and closure are safe.
- Do not let autonomy choose freely from the full terminal spec.
- Phase reviews are manual gates.

## Phase 0: Contract and Repo Alignment

### FFTERM-0001: Terminal integration contract

Acceptance:

- `docs/TERMINAL_INTEGRATION_CONTRACT.md` exists.
- It identifies `Wescome/function-factory` as the canonical domain repo.
- It documents `specs/`, YAML/Markdown handling, `source_refs`, gateway routes, and polling-first pipeline status.

### FFTERM-0002: Terminal implementation backlog

Acceptance:

- `docs/TERMINAL_IMPLEMENTATION_BACKLOG.md` exists.
- Backlog is split into autonomy-safe atoms.
- Backlog references manual phase gates.

### FFTERM-0003: Wave fork target decision

Acceptance:

- Decide and document the terminal repo name (recommended: `Wescome/function-factory-terminal`).
- Decide whether the fork is public or private.
- Decide the initial supported OS target (recommended: macOS first, keep Wave cross-platform build paths intact).

## Phase 1: Fork, Gut, Build

### FFTERM-0101: Fork Wave Terminal and verify baseline

Acceptance:

- Wave Terminal fork exists.
- `task init` and `task dev` or current equivalent works.
- A terminal block opens and can run shell commands.

### FFTERM-0102: Rebrand application identity

Acceptance:

- App name is Function Factory Terminal.
- Window title and package metadata no longer say Wave Terminal where user-visible.
- Existing terminal block still works.

### FFTERM-0103: Preserve core blocks and layout

Acceptance:

- Terminal block works.
- File preview works for Markdown/JSON/YAML.
- Code editor opens files.
- Webview block still renders.
- Split, drag, resize, and tab behavior still works.

### FFTERM-0104: Remove generic AI views

Acceptance:

- Remove Wave AI view/panel/file-diff registrations.
- Build still passes.
- No default widget points to removed views.

### FFTERM-0105: Remove irrelevant generic views

Acceptance:

- Remove sysinfo/help/tips/launcher/tsunami/vdom views only after confirming registrations.
- Build still passes after each removal group.
- Remaining core blocks still work.

### FFTERM-0106: Rename `wsh` CLI to `ff`

Acceptance:

- CLI binary is `ff`.
- Environment variables are renamed or bridged to `FF_BLOCKID` and `FF_TABID`.
- Existing "CLI creates/controls block" path still works.

### FFTERM-0107: Add `ff:` configuration keys

Acceptance:

- Add `ff:repopath`, `ff:gatewayurl`, `ff:gatewayauth`, `ff:defaulttab`.
- `ff:gatewayauth` supports env-var reference convention.
- Local mode works with only `ff:repopath`.

## Phase 2: Local Inspect and Lineage

### FFTERM-0201: Add Factory RPC envelopes for inspect and trace

Acceptance:

- Add `FFInspectRequest`, `FFInspectResponse`, `FFTraceRequest`, `FFTraceResponse`.
- Generate Go and TypeScript RPC stubs.
- Build passes.

### FFTERM-0202: Implement local artifact resolver

Acceptance:

- Resolve artifact ID to `specs/**/*.yaml` or `specs/**/*.md`.
- Read YAML artifacts into maps.
- Read Markdown PRDs into an envelope with raw content.
- Unit tests cover YAML and Markdown.

### FFTERM-0203: Implement local inspect handler

Acceptance:

- `ff:inspect` returns artifact ID, type, source refs, explicitness, rationale, and data/content.
- Works for at least `PRD-META-COMPILER-PASS-8` and one YAML artifact.
- Unit tests pass.

### FFTERM-0204: Build minimal `ff-inspect` block

Acceptance:

- Block registers as `ff-inspect`.
- Renders common metadata and raw body.
- Has loading and error states.

### FFTERM-0205: Add `ff inspect <artifact-id>` CLI

Acceptance:

- Running `ff inspect PRD-META-COMPILER-PASS-8` opens an inspect block.
- Missing artifact returns a clear error.

### FFTERM-0206: Implement local lineage traversal

Acceptance:

- Traverse upstream lineage through `source_refs`.
- Build graph nodes/edges from local artifacts.
- Unit tests cover missing refs and cycles.

### FFTERM-0207: Build minimal `ff-lineage` block

Acceptance:

- Block registers as `ff-lineage`.
- Renders lineage graph from RPC response.
- Selecting a node can open `ff-inspect`.

### FFTERM-0208: Add `ff trace <artifact-id>` CLI

Acceptance:

- Running `ff trace PRD-META-COMPILER-PASS-8` opens a lineage block.
- Missing artifact returns a clear error.

## Phase 3: Gateway and Pipeline

### FFTERM-0301: Add gateway client package

Acceptance:

- Client supports `/health`, `/specs`, `/lineage`, `/impact`, `/pipeline`, `/pipeline/:id`, `/approve/:id`.
- Auth token is read from env-var-backed config.
- Unit tests use mock HTTP server.

### FFTERM-0302: Add pipeline RPC envelopes

Acceptance:

- Add compile/status/review/inbox/health RPC envelopes aligned to current gateway routes.
- Do not add WebSocket-only assumptions.

### FFTERM-0303: Implement `ff health`

Acceptance:

- Local mode reports repo health.
- Gateway mode reports `/health`.
- CLI prints status in terminal.

### FFTERM-0304: Implement `ff compile <prd-id> --dry-run`

Acceptance:

- Local mode returns clear unsupported or simulated result.
- Gateway mode translates PRD intent into current `/pipeline` signal payload.
- Opens pipeline monitor block.

### FFTERM-0305: Implement polling pipeline monitor

Acceptance:

- `ff-pipeline` polls `GET /pipeline/:id`.
- Shows state, elapsed time, stage/pass, and errors.
- Handles completed/failed/paused states.

### FFTERM-0306: Implement decision surface shell

Acceptance:

- `ff-decision` displays pending CRP/MRP/gate failure data.
- Submit action calls `/approve/:id` where supported.

## Phase 4: Operator Dashboards

### FFTERM-0401: Inbox block

Acceptance:

- Reads `/crps/pending` and `/mrps/pending` in gateway mode.
- Shows local placeholder state in local mode.
- Badge count available for widget bar.

### FFTERM-0402: Coverage block

Acceptance:

- Displays gate status for an artifact or PRD.
- Supports local coverage report files under `specs/coverage-reports/`.

### FFTERM-0403: Cost block

Acceptance:

- Displays token/cost entries from pipeline status if available.
- Handles empty cost data gracefully.

### FFTERM-0404: Memory block

Acceptance:

- Displays available memory layers or gateway memory response.
- Handles missing gateway memory API gracefully.

### FFTERM-0405: Factory command palette

Acceptance:

- Finds Factory commands.
- Finds local artifact IDs from `specs/`.
- Opens inspect, trace, coverage, inbox, and pipeline blocks.

### FFTERM-0406: Tab presets

Acceptance:

- Compile, Explore, Review, and Monitor presets exist.
- Each creates the expected block layout.

## Phase Gates

Manual review required after:

- Phase 1 fork/rebrand/gut
- Phase 2 local inspect/trace
- Phase 3 gateway/pipeline
- Phase 4 full operator workflow

