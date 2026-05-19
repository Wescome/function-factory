# Multi-Agent Coding System — Research Synthesis

**Status:** Complete  
**Authored by:** GUV (synthesized from CodexResearcher + hermes-agent research agents)  
**Date:** 2026-05-18  
**Systems analyzed:** SWE-agent, OpenHands SDK, Aider, Codex CLI, LangGraph, SWE-bench top performers (Verdent 76.1%), Sweep AI, hermes-agent (8 total)  
**Source reads:** ~140 files, 16 minutes elapsed  
**Lineage:** CODING-ADAPTER-MULTIAGENT-PROPOSALS.md, observability-se-diagnosis.md

---

## Critical Reversal: N-Parallel-PATCH is NOT What Winners Do

The Architect's Problems A-F proposed Agentless-style N=4-8 parallel PATCH → SelectBestPatch. The research overturns this:

> **Verdent AI 76.1% Verified explicitly disclaims "generating multiple candidates and then selecting one."**  
> Top performers use **sequential repair with a reviewer subagent** — not parallel sample-and-vote.

Parallel sampling is mostly absent from production SWE-bench leaders. Sequential repair + critic is the proven pattern.

**Revised recommended pipeline:**
```
LOCALIZE → PATCH (single) → CRITIC (fresh session, read-only) → repair loop ≤ 3 → VERIFY
```

This matches Proposals A1/C from CODING-ADAPTER-MULTIAGENT-PROPOSALS.md, augmented with the hermes two-stage critic.

---

## Findings by System

### SWE-agent (princeton-nlp/SWE-agent)

**Repo materialization** — shallow fetch pattern (NOT clone):
```bash
git init && git remote add origin <token-url>
git fetch --depth 1 origin <base_commit>
git checkout FETCH_HEAD
```
Reset between runs: `git restore . && git reset --hard && git checkout <base> && git clean -fdq`

**Write scope:** NO path-level enforcement. Container IS the scope. Tool blocklist only (vim, gdb, python, bash, make, etc).

**PR submission:** NOT in the agent. Emits `git diff --cached > /root/model.patch`. Harness handles submission externally.

**Multi-agent:** NOT parallel. `RetryAgent` runs serial attempts. Parallelism is at the benchmark-harness layer (one container per task).

### OpenHands SDK

**Repo materialization:** Container-mount based. `DockerSandboxService` runs a container per sandbox with bind mounts. Clone happens inside container via `openhands.sdk.git.cached_repo`.

**Write scope:** NO `AllowedPaths` mechanism in file editor. `file_editor` validates path, size, binary, directory — NOT workspace-root containment. Security = container isolation + Docker bind mounts.

**Glob:** `GlobExecutor` uses **ripgrep** (`rg --files -g`) with fallback to `glob.glob()`. `is_parallel_safe()` returns True for ripgrep, False for Python glob (process-global `os.chdir()`).

**Multi-agent:** `register_agent()` global registry with RLock. Sub-agents share workspace, have independent conversation contexts. `WORKER_1=8011/WORKER_2=8012` are NOT parallel agents — they're ports for apps the agent runs (dev servers).

### Aider (Aider-AI/aider)

**Write scope (cleanest preventive pattern):**
- `abs_fnames: set[str]` — explicit in-chat writable set
- `abs_read_only_fnames: set[str]` — context-only
- `apply_edits()` iterates ONLY paths in `abs_fnames`. Never escapes the set.
- `.aiderignore` via `pathspec` (gitignore-style PathSpec)
- `subtree_only` flag restricts to working subtree

**Diff format:** Structured `ORIG/UPD` search-replace blocks. Dry-run via `apply_edits_dry_run`. Falls back to trying other in-chat files on match failure.

**Multi-agent:** NONE. `architect_coder.py` + `editor_editblock_coder.py` is a planner→executor split inside one process.

### Codex CLI (openai/codex) — Most Sophisticated Production Stack

**Sandbox:** OS-level enforcement. Linux: bubblewrap + seccomp + Landlock LSM. macOS: Seatbelt (sandbox-exec). Windows: AppContainer.

**AllowedPaths:** `FileSystemSandboxPolicy::get_writable_roots_with_cwd(cwd)`. Patch check via `is_write_patch_constrained_to_writable_paths()` — normalizes path, walks `Components::ParentDir`, checks containment. Returns `AutoApprove | AskUser | Reject{reason}`.

**Apply-patch format:** Text sentinels — `*** Update File: <path>`, `*** Move to: <path>`, `*** Delete File: <path>`, `*** Add File: <path>`, `*** End Patch`. OpenHands borrowed this exact format.

**TurnDiffTracker:** `baseline_by_path` + `current_by_path` HashMaps. Tracks rename pairs from emitted `AppliedPatchDelta` events — NO filesystem rereads. Unified diff rendered in-memory. Ideal for verification without FS re-read.

**Multi-agent registry:**
- `AgentRegistry` with `active_agents: Mutex<ActiveAgents>`, `total_count: AtomicUsize`
- `reserve_spawn_slot(max_threads)` → `Err(AgentLimitReached)` if exceeded
- Depth cap via `next_thread_spawn_depth()` + `exceeds_thread_spawn_depth_limit()`
- Named via scientist/philosopher nicknames (Euclid, Turing, Feynman…) — 100+ names
- Per-role config via `apply_role_to_config()` — TOML overlay, `preserve_current_profile` policy

### LangGraph

**Parallel agents on shared resource (hard rule):**
```python
from langgraph.types import Send
# Fan-out via Send API
def fan_out(state): return [Send("call_agent", {...}) for a in state["agents"]]
# Merge in ONE reducer/arbiter — never let agents write shared state directly
patches: Annotated[list[Patch], operator.add]  # reducer
```
Rule: "Do not let parallel agents overwrite the same shared resource directly. Return patches, merge in one reducer/arbiter step."

**Handoff:** `Command(goto=..., update=..., graph=Command.PARENT)` — coupled routing + state update.

**Supervisor vs Swarm:** `langgraph-supervisor` = centralized router (easier provenance/lineage). `langgraph-swarm` = decentralized handoff. Supervisor recommended for coding harness.

### SWE-bench Top Performers

| System | Score | Reconciliation strategy |
|---|---|---|
| Verdent AI | 76.1% Verified | Sequential repair + review subagent. **ZERO parallel-sample-and-rank.** |
| Codex CLI w/ GPT-5.2 | 63% Terminal-Bench | Sequential agent loop. No public vote/judge/reranker. |
| Meta Context Engineering | 89.1% | Evolutionary context optimization — different problem. Not a SWE-bench system. |

**Implication:** Parallel sample-and-rank is mostly absent from leaders. Sequential repair-with-tests is dominant.

### Sweep AI (sweepai/sweep)

**Forensic write validation (`validate_and_sanitize_multi_file_changes`):**
```python
all_fcr_file_names = set(os.path.normpath(fcr.filename) for fcr in fcrs)
for file_name in all_file_names:
    if os.path.normpath(file_name) in all_fcr_file_names \
       or file_exists_in_repo(repo, file_name):
        sanitized_file_changes[file_name] = ...
    else:
        file_removed = True  # strip-and-warn
```
Files must be in FCR set OR already exist in repo — otherwise dropped.

**PR submission via GitHub Git Data API (NOT git push):**
```python
blob = repo.create_git_blob(file_contents, "utf-8")
blobs.append(InputGitTreeElement(path=..., mode="100644", type="blob", sha=blob.sha))
new_tree = repo.create_git_tree(blobs, base_tree=base_tree)
commit = repo.create_git_commit(commit_message, new_tree, [parent])
repo.get_git_ref(f"heads/{branch}").edit(sha=commit.sha)
```
Pure REST, no local clone, no credential propagation to agent.

**Multi-agent:** NOT parallel. Sequential role pipeline (search_agent, modify, pr_description_bot, question_answerer, etc).

### hermes-agent (NousResearch/hermes-agent)

**Key:** Single-process Python agent with mature sub-agent + write-scope + multi-provider contracts. Substrate (threads/TLS) doesn't port to CF; contracts do.

**ToolGuardrail (`tool_guardrails.py`):**
- Signs each call via `ToolCallSignature(tool_name, sha256(canonical_args))`
- Tracks per-turn: exact-failure count, same-tool-failure count, idempotent-no-progress count
- Thresholds: warn at 2 exact failures, halt at 5; warn at 3 same-tool, halt at 8
- Returns `ToolGuardrailDecision(action: allow|warn|block|halt)`
- **Port as DO storage rows** — key per `(runId, stageId)`, increment on failure event

**Four-gate taxonomy (`gates-taxonomy.md`):**
- **Pre-flight** — block before work starts
- **Revision** — loop back, max 3 iterations, escalates early if issue count doesn't decrease
- **Escalation** — pause for human, never default
- **Abort** — preserve state, terminate
- Every checkpoint must declare which kind. **Port verbatim to harness gate vocabulary.**

**Two-stage critic (`subagent-driven-development/SKILL.md`):**
Per task: Implementer → **Spec Compliance Reviewer** → **Code Quality Reviewer**
Each critic is a fresh `delegate_task` with `toolsets=['file']` (read-only). Gets original plan + files. Outputs APPROVED / REQUEST_CHANGES.

**Sub-agent coordination (`delegate_tool.py`):**
- `ThreadPoolExecutor` (default 3 concurrent)
- Child gets: fresh conversation, own `task_id`, restricted toolset
- `DELEGATE_BLOCKED_TOOLS`: `delegate_task, clarify, memory, send_message, execute_code` always stripped
- `MAX_DEPTH = 1` (flat by default, raisable to 3 via `orchestrator` role)
- `IterationBudget(parent=90, child=50)` — per-agent thread-safe

**Write scope (three layers):**
1. `file_safety.py` — hardcoded denylist (`~/.ssh/*`, `~/.aws`, `.env`, `id_rsa`)
2. `HERMES_WRITE_SAFE_ROOT` env var — restrict ALL writes to rooted prefix
3. `path_security.py::validate_within_dir(path, root)` — symlink-resolving traversal check

**ProviderTransport ABC (`transports/base.py`):**
`convert_messages`, `convert_tools`, `build_kwargs`, `normalize_response` — clean format-conversion seam. Three modes: `chat_completions`, `codex_responses`, `anthropic_messages`. Same architectural shape for Worker→Pi→Container provider swap.

**Background review fork (`background_review.py`):**
Daemon thread after every turn — forks a new `AIAgent` with memory+skill-only whitelist, asks "should anything be saved?". Hits same prefix cache → essentially free.

---

## Synthesis: 6 Patterns Confirmed for CF-Native Pi Stack

### Pattern 1 — Preventive write scope: TypeScript `allowedPaths` set in Pi tool wrapper
Aider's `abs_fnames` model. Before Pi writes a file, the tool wrapper checks the path against SeedWorkspace declared files. Never escapes the set. Implemented in `workspace-seed.mjs` or as a new `path-guard.mjs`.

### Pattern 2 — Forensic write scope: post-stage strip-and-warn before commit  
Sweep's `validate_and_sanitize_multi_file_changes`. After Pi emits a diff, the Worker strips anything not in the SeedWorkspace manifest or declared FCR set. Logs `[FORENSIC]` warning for each dropped path. This IS the Q12 hybrid forensic layer.

### Pattern 3 — Git Data API from Worker (not container) for PR creation
Sweep pattern. Worker holds GitHub App token. Container emits only a diff. Worker calls `create_git_blob → create_git_tree → create_git_commit → update ref`. This IS the Q7 implementation target.

### Pattern 4 — Sequential repair with read-only critic (hermes two-stage)
PATCH produces CandidatePatch → fresh Pi session (Spec Compliance Reviewer, read-only) → fresh Pi session (Code Quality Reviewer, read-only) → findings returned as `gateFailureContext` → PATCH repair round. Max 3 total (existing `max_repair_rounds`). Replaces N-parallel-PATCH proposal.

### Pattern 5 — ToolGuardrail as DO storage circuit breaker
Port hermes `tool_guardrails.py` contract to CF. Key: `toolguard:{runId}:{stageId}`. Per tool-call event: increment `exact_failure_count` and `same_tool_count`. Halt stage if thresholds exceeded. Prevents infinite Pi loops without external intervention.

### Pattern 6 — Four-gate vocabulary adoption
Rename harness gates to hermes taxonomy: Pre-flight (exists/schema checks), Revision (repair-eligible failures), Escalation (operator intervention required), Abort (terminal). Cleaner operator control surface.

---

## Architect Proposals Needed (Wes disposal)

| ID | Proposal | Replaces |
|---|---|---|
| A-NEW-1 | Single PATCH + two-stage critic loop (replaces N-parallel) | Problems A-F from Architect's swarm design |
| A-NEW-2 | ToolGuardrail DO-native circuit breaker | No prior proposal |
| A-NEW-3 | Adopt hermes four-gate taxonomy in harness vocabulary | No prior proposal |
| A-NEW-4 | `PI_WRITE_SAFE_ROOT` + `validate_within_dir()` in Container | Q12 forensic extension |

---

## Source Quality

All findings backed by direct GitHub raw reads (140 files) + Codex CLI + web search cross-reference. Only weak spot: Sweep CI handlers (`on_failing_github_actions.py`, `on_check_suite.py`) inferred from filenames only — full handler code not read.
