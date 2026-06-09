# Cloudflare Artifacts Beta Application

**Form:** https://forms.gle/DwBoPRa3CWQ8ajFp7
**Status:** Not yet submitted

---

## Project / Company

**Name:** Function Factory
**GitHub:** https://github.com/Wescome/function-factory
**Plan:** Cloudflare Workers Paid

---

## Use Case Description

Function Factory is an AI-powered software synthesis pipeline running on Cloudflare Workers. It takes a Signal (a natural language requirement), compiles it through a multi-stage LLM pipeline into an ExecutableSpecification and ExecutionPacket, then dispatches it to Gas City (CF Containers) where coding agents implement the function.

We have two specific flows where Cloudflare Artifacts directly replaces current workarounds:

### 1. SeedWorkspace (SPEC-FF-SEEDWORKSPACE-001)

Before a coding agent runs, we need a baseline git repo in the agent's working directory so that `git diff` captures only agent-written files (not the entire codebase).

**Current approach (fragile):**
1. Fetch function-factory HEAD as a GitHub tarball
2. Store in R2 (`skeletons/{fnId}/{timestamp}.tar.gz`)
3. Generate HMAC-signed 2h download URL
4. Agent runs: `curl {{workspace_url}} | tar xz && git init && git add -A && git commit -m baseline`
5. After agent session: `git add -A && git diff --cached` → CandidatePatch

**With Artifacts:**
1. `env.ARTIFACTS.import({ source: 'https://github.com/Wescome/function-factory', target: 'factory-baseline' })` — one-time or on-deploy
2. Per dispatch: `repo.fork('dispatch-{epId}')` → get git remote URL + token
3. Agent runs: `git clone {{artifacts_repo_url}}`
4. After session: native diff API between fork HEAD and baseline commit → CandidatePatch

This eliminates: `skeleton-builder.ts`, HMAC URL generation, the `init` formula step, `skeleton_manifests` D1 collection, and all R2 skeleton keys.

### 2. CandidatePatch (SPEC-FF-JUSTBASH-002)

The agent's implementation output must be captured as a unified diff for Fidelity Verification.

**Current approach:** `git add -A && git diff --cached` — produced near-empty diffs (~440 bytes) when the working tree state was wrong. Required the entire SeedWorkspace scaffolding to fix.

**With Artifacts:** Native diff between the session fork HEAD and the baseline commit. Deterministic, no staging area state, no git working tree management.

### 3. Parallel Atom Execution

Each ExecutableSpecification decomposes into multiple atoms (independent coding tasks). We run these in parallel with isolated agent sessions.

**With Artifacts:** Fork the baseline once per dispatch, then fork per-atom from that. Each atom gets isolated git state. The 10,000-fork capability is exactly the concurrency model we need.

---

## Volume Estimate

| Metric | Current | 3-Month Target |
|--------|---------|----------------|
| Pipeline dispatches/month | ~50 | ~500 |
| Repo forks/dispatch | 1–10 (atom count) | 1–20 |
| Total forks/month | ~200 | ~5,000 |
| Baseline repos | 1 (function-factory HEAD) | 3–5 |

---

## Technical Fit

- **DO per-repo:** matches our per-dispatch isolation model exactly
- **Event subscriptions:** `pushed` event could trigger Fidelity Verification directly (replacing the current HMAC-signed webhook from Gas City)
- **ArtifactFS blobless clone:** critical — function-factory is a large monorepo, cold clone latency matters for agent startup time
- **git-notes:** useful for attaching Factory lineage metadata (ep_id, fn_id, is_id) to commits without polluting history

---

## Contact

**Email:** wislet@gmail.com
**GitHub:** Wescome
