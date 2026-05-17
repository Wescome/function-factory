# ADR-003a: Pi RPC-in-Container as Default Executor — Supersedes ADR-003

## Status

Accepted — 2026-05-17 (Architect review)

## Supersedes

ADR-003 (Pi SDK as Default Coder/Tester Executor, proposed 2026-04-24) — **status: Superseded**

## Date

2026-05-17

## Lineage

ADR-003, ADR-009 (NLAH Runtime), smoke run `smoke-1779050655` (production evidence),
DECISIONS.md (queue bridge canonical pattern), project memory `project_session_2026_04_25_26`
(DO platform constraints)

---

## 1. Decision

Pi runs in **RPC mode inside a CF Container** as the default executor for all harness stages.
The pi SDK embedding path (ADR-003's proposal) is **rejected for the Factory's architecture**.
SDK migration is not planned.

---

## 2. Why ADR-003 Is Wrong for This Architecture

ADR-003 was written comparing pi SDK against OpenHands/Aider/Claude Code — opaque foreign
container executors with no Factory alignment. The actual alternative we built is
**NLAH/DSL-in-Container with pi RPC**, which changes the comparison entirely.

ADR-003 also predates two critical facts that invalidate its premises:

1. **`@mariozechner/pi-coding-agent` is deprecated.** The canonical repo is
   `earendil-works/pi`. An SDK migration would target a deprecated package or require
   rewriting against `earendil-works/pi`'s API surface, which is RPC-shaped anyway.

2. **CF DO platform constraints make SDK-in-DO unworkable.** `setTimeout` is frozen in
   Durable Objects. Pi's event loop, auto-compaction, and timer-based lifecycle assume
   standard Node.js timers. Embedding pi SDK inside a DO causes session hangs,
   compaction failures, and non-deterministic timeouts.

---

## 3. Verdict on ADR-003's Five Arguments

### 3.1 Tool gating (write-domain enforcement)

**Gap that does not matter. Fix lives in `server.mjs`, not in the SDK.**

Every stage gets a fresh `mkdtemp` working directory inside an ephemeral container. Pi
cannot escape `workDir` without explicitly `bash`-ing absolute paths. The artifact-promotion
gate in `harness-dispatcher.ts` and `readDeclaredArtifacts` (execution-contract.mjs)
enforces the only boundary that matters: which files get written to R2.

SDK extensions offer pre-filesystem interception, but they run in Node.js and are equally
bypassable by `bash`. They do not provide kernel-level isolation. If intra-stage write
enforcement ever becomes necessary, the fix is a post-turn file audit inside `server.mjs`,
not SDK embedding.

**Action: none. Revisit only when a Function explicitly requires intra-stage path gating.**

### 3.2 Cost tracking (token accounting)

**Gap closed.** `server.mjs` now extracts `usage` from `message_end` events and accumulates
`observation.totalUsage`. Cost data lands in the observation payload, written to R2 as
`runs/{runId}/artifacts/__observability/STAGE.container-observation.json`. The Factory's
DCE formula can aggregate from there.

ADR-003's argument required pi-ai native cost tracking. The Factory now routes through
ofox.ai (not pi-ai directly), so the substrate alignment argument no longer applies.

### 3.3 Session lineage (Factory evidence)

**Container path is strictly better than SDK-in-DO.**

`server.mjs` now captures pi's session directory as a `tar.gz` archive (capped at 1 MB)
and returns it in the `/execute` response. The harness-dispatcher writes it to
`runs/{runId}/{stageName}/pi-session.tar.gz` in R2. Full session trees, inspection of
repair branches, complete evidence — all in R2, unbounded.

SDK-in-DO would have to write session trees to DO storage, which has a 128 KiB-per-key
limit. The container path produces better lineage, not worse.

### 3.4 Cross-role context continuity

**Container path is architecturally correct. SDK in-memory handoff would break lineage.**

NLAH's `WorkerInput.context.inputArtifacts` is the explicit cross-role handoff. Every
artifact crossing a role boundary goes through R2 with a tracked write, populating
`source_refs`. This is the Factory's lineage contract (AGENTS.md: "Every artifact has a
`source_refs` array. It must be populated. No exceptions.").

ADR-003 conflated model-context-window optimization with cross-stage continuity. In-memory
handoff optimizes the former at the cost of the latter. The Factory requires the latter.
The container path is correct.

### 3.5 Container overhead

**Not real at current scale.** `PI_CONTAINER` uses `idFromName("pi")` — a singleton DO
stub per region. The container stays warm across requests. Stage execution is 30s–5min of
LLM time; container wake overhead (sub-second warm, ~2s cold) is in the noise.

The lease/heartbeat/custody overhead ADR-003 worried about applied to per-task OpenHands
containers. `PI_CONTAINER` is per-deployment, multi-tenant by `mkdtemp` isolation. No
lease protocol exists to create overhead.

---

## 4. Production Evidence

Smoke run `smoke-1779050655` (2026-05-17):

- Trigger: `/trigger-harness`, `harnessKey: pi-smoke`
- Workflow: completed in 11 seconds
- `harness-complete`: `{"overall":"pass","finalStage":"SMOKE"}`
- Container observation written to R2: `runs/smoke-1779050655/artifacts/__observability/SMOKE.container-observation.json`
- Artifact: `runs/smoke-1779050655/artifacts/SmokeArtifact` — 22 bytes — `pi container smoke ok`

The RPC-in-Container path is not a proposal. It is deployed and producing evidence.

---

## 5. When to Revisit

Revisit only if a real Function demands one of:

- **Mid-turn model switching** driven by Factory policy (SDK can do this natively; RPC
  requires a `model` command mid-session — pi RPC supports this, but it's not implemented
  in `server.mjs`)
- **Per-token cost gating** that aborts a Coder turn at a budget threshold (requires
  streaming intercept inside the agent loop — SDK only)
- **Intra-stage file-scope enforcement** that must survive `bash` with absolute paths
  (requires kernel-level overlay FS or seccomp — neither SDK nor RPC provides this)

None of these are bootstrap requirements. None are on the Factory's current backlog.

---

## 6. Consequences

### What this decision changes

- ADR-003 is superseded. Its DECISIONS.md entry is not written.
- Pi SDK embedding is not a target for any current sprint or backlog item.
- `@mariozechner/pi-coding-agent` is not added as a dependency anywhere.
- Container fallbacks (OpenHands, Aider) remain available per ADR-002 for the narrow
  cases ADR-003 §4 still applies to (browser automation, Docker-in-Docker).

### What remains unchanged

- Pi RPC protocol: `--mode rpc --model <id>`, 200ms init, `{type:"prompt"}`, `agent_end`
- NLAH harness dispatch: `HARNESS_QUEUE` → `harness-dispatcher.ts` → `PiContainerAdapter`
- `PI_CONTAINER` DO as singleton warm container
- ofox.ai as the model provider via `OPENROUTER_API_KEY` redirect

### New capabilities added by this decision's companion changes

- `server.mjs`: `message_end` usage extraction → `observation.totalUsage` + `pi.usage` events
- `server.mjs`: pi session directory archive → `sessionArchive` in /execute response
- Caller (harness-dispatcher): writes `sessionArchive` to `runs/{runId}/{stageName}/pi-session.tar.gz` in R2
