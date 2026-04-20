# Agent Permissions

These are the hard boundaries for coding agents working on this repository.
Read before every tool call. Blocked means blocked; escalate rather than
bypass.

## Always allowed (no approval needed)
- Read any file in the project directory.
- Read `.agent/memory/` at any depth.
- Read `specs/` at any depth.
- Run `pnpm test`, `pnpm build`, `pnpm lint`, `pnpm typecheck`.
- Create files in `specs/prds/`, `specs/pressures/`, `specs/capabilities/`,
  `specs/functions/`, `specs/invariants/`, `specs/coverage-reports/`,
  `specs/signals/`, `specs/deltas/`.
- Write to `.agent/memory/working/` and `.agent/memory/episodic/`.
- Write to `.agent/memory/semantic/LESSONS.md` and `DECISIONS.md` — the
  Factory's learning loop requires autonomous memory accumulation. Agents
  record lessons and decisions as they work; the Architect reviews via
  git log, not per-write approval. Gating institutional memory on human
  approval breaks the closed-loop learning the Factory depends on.
- Create branches.
- Create draft pull requests.
- Update `WORKSPACE.md` and `AGENT_LEARNINGS.jsonl` as part of normal
  operation.
- Run the compiler (`pnpm compile <prd-path>`) in a non-destructive mode.

## Requires explicit approval
- Modify files in `packages/*/src/` (every package boundary is a contract).
- Modify any file in `.agent/skills/` (skills are architecturally
  load-bearing — changes require review).
- (Moved to Always-allowed: LESSONS.md and DECISIONS.md are now
  autonomously writable — see above.)
- Modify this file (`permissions.md`). Only humans edit this file.
- Merge pull requests.
- Create files in `specs/workgraphs/` by hand (WorkGraphs are compiler
  output; hand-authoring requires approval. Compiler-emitted WorkGraphs
  via `pnpm compile` are always-allowed — see above).
- Install new npm dependencies.
- Modify CI/CD configuration (`.github/workflows/`).
- Promote a Function's lifecycle state (`designed` → ... → `monitored`).
- Transition a Function to `retired`.
- Delete files in `specs/` (lineage-carrying artifacts; deletion is
  destructive and requires architect sign-off).

## Never allowed
- Force push to `main` or any protected branch.
- Access secrets, credentials, or `.env` files directly.
- Send HTTP requests to domains not in the approved list.
- Modify `permissions.md`, `.agent/AGENTS.md`, `packages/schemas/src/core.ts`
  (the canonical schema module), or the six non-negotiables in README.md
  without architect involvement.
- Disable or bypass `pre_tool_call.py` or any lifecycle hook.
- Emit a WorkGraph that fails Gate 1.
- Promote a Function to `monitored` without Gate 2 passing.
- Fabricate source references. If lineage is unknown, it is UNCERTAIN,
  not empty.
- Invent expansions for project-specific TLAs. If an acronym is not
  defined in the canonical source, search conversation history, search
  `.agent/memory/`, or ask. Do not guess.

## Approved external domains
- `registry.npmjs.org`
- `api.github.com`
- `pypi.org` (for Python tooling, if any)

## Approval protocol

If an action requires approval, the agent:
1. Describes the action and its intended artifact IDs.
2. Waits for architect confirmation.
3. On approval, performs the action and logs the approval event to
   episodic memory with the architect's confirmation as context.
4. On denial, logs the denial and stops. Does not work around it.
