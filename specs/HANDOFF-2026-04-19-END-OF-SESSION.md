# Handoff — end of 2026-04-19 session

**Status:** Active. Read this cold; no prior conversation context required.
**Date:** 2026-04-19
**Repo:** https://github.com/Wescome/function-factory (private, owner Wescome)
**Head commit at handoff:** `69e6bd7`
**Test baseline:** 118 (39 schemas + 50 coverage-gates + 29 compiler)
**Typecheck:** clean across all packages
**Tag pinning bootstrap milestone:** `bootstrap-stage-5-complete` → `7883038`

---

## What the Factory is (first principles, from the papers)

The Function Factory is a compiler from organizational reality to running code. Its canonical unit is a **Function** — code plus its scaffolding (intent, contract, invariants, validations, implementation, runtime indicators, status). Per whitepaper §2, a Function is "bounded, composable, governable, verifiable, and monitorable."

The pipeline is seven stages (whitepaper §3):

1. **Signals** — raw external + internal input normalized into a common envelope.
2. **Pressures** — signals cluster into forcing functions (control-theory `F(t)`).
3. **Capabilities** — the organization's durable abilities to respond (transfer functions).
4. **Function Proposals** — per-capability deltas become typed proposals (execution / control / evidence / integration).
5. **PRD compiler** — each proposal becomes a PRD; eight narrow passes compile it. **Output: a WorkGraph** (typed DAG). No code generated at this stage.
6. **Dark Factory Execution** — the WorkGraph is read by a five-role coding-agent topology (**Planner / Coder / Critic / Tester / Verifier**). Each role is "a state-transform contract with strict read access, write access, do-not rules, output contract, and a JSON-only footer" (whitepaper §3). "This is the only stage that touches code." Output: the Function's implementation code (plus tests, config, docs per ConOps §9.4).
7. **Simulation, Validation, Convergence** — Digital Twin Universes run scenarios against invariants and validations. Passing code deploys; failures trigger bounded repair. Runtime telemetry feeds invariant health. Trust composes from five dimensions. Regression detected when trusted evidence is invalidated.

The loop closes (whitepaper §4): runtime drift becomes new Pressures into Stage 1.

**Authoritative sources in-repo:**
- `specs/reference/The_Function_Factory_2026-04-18_v4.md` — whitepaper v4 (42KB)
- `specs/reference/The_Function_Factory_ConOps_2026-04-18.md` — ConOps (76KB)

Both are byte-identical to the Dropbox originals at `~/Dropbox/WeOps/Architecture/inbox/`.

---

## Current state of the build (what's done, what isn't)

**Done:**
- Stage 5 pipeline end-to-end (Passes 0–8 with Gate 1 between 7 and 8).
- Compiler lives at `packages/compiler/`; 29 tests; emits WorkGraphs to `specs/workgraphs/`.
- Gate 1 coverage gates at `packages/coverage-gates/`; 50 tests; five checks (atom, invariant, validation, dependency closure, bootstrap_prefix_check).
- Canonical Zod schemas at `packages/schemas/`; 39 tests.
- Five PRDs compile Gate 1 PASS today:
  - `PRD-META-GATE-1-COMPILE-COVERAGE` (Factory compiles its own Gate 1)
  - `PRD-META-DETECT-REGRESSION` (runtime regression detection)
  - `PRD-META-COMPILER-PASS-8` (second-order bootstrap proof)
  - `PRD-V2-CLASSIFY-COMMITS` (first non-meta vertical)
  - (Four meta + one non-meta = five, after this session's deletion of the miscast HARNESS-EXECUTE PRD)

**Not done:**
- **Stage 6** — no implementation. Whitepaper §3 specifies the Planner/Coder/Critic/Tester/Verifier topology; no repo has that coded. No WorkGraph has been handed to Stage 6 yet.
- Stage 7 — no implementation. Stubbed at `packages/runtime/`.
- Assurance graph — stubbed at `packages/assurance-graph/`.
- Gate 2, Gate 3 — not implemented.

---

## Verify independently — don't trust this doc, trust the artifacts

Per Wes's exact instructions at end of session:

**1. Git log on GitHub.** https://github.com/Wescome/function-factory — 4 revert commits + 1 pollution-clearance commit + 1 v2 PRD cleanup commit + 1 Pass-8 PRD cleanup commit + 1 Gate-1-limitation Observed DECISIONS entry. History shows the wrong turn and the recovery, nothing hidden.

**2. Test baseline.** `pnpm -r test` → 118 green. Tests the reverts left valid stay valid. Nothing silently broken.

**3. Grep the repo.** `grep -ri "harness-bridge\|HARNESS-EXECUTE\|ExecutionLog\|shell-exec adapter" --exclude-dir=node_modules --exclude=DECISIONS.md .` — the remaining matches should be the retraction entry in DECISIONS.md (intentional audit trail) and the factory-meta SKILL line that was edited (now says "external integration boundary"). If there's anything else, the cleanup was incomplete.

The two `.agent/` hits (`memory_writer.ts` + `post_execution.ts`) reference a **PAI-agent-infrastructure `ExecutionLog` type**, not the Factory's. Colliding name, unrelated system.

---

## What the prior session got wrong, and the recovery

The session produced a package (`@factory/harness-bridge`) and a PRD (`PRD-META-HARNESS-EXECUTE`) under a **miscast mental model**: Stage 6 as a "generic adapter dispatches WorkGraph nodes as runtime commands." The whitepaper §3 Stage 6 specifies no such thing. Stage 6 is a five-role coding-agent swarm that reads the WorkGraph as specification and emits Function implementation code.

The miscast was compounded by a Step 1 schema addition (`WorkGraphNode.executable` as a shell/in_process discriminated union) that treated WorkGraph nodes as dispatch sites for shell commands. WorkGraph nodes are not dispatch sites; they are specification artifacts the coding swarm reads.

**Recovery commits (visible on GitHub):**
- `9b8b743`, `5f92eb8`, `c9ae3c7`, `69279c3` — four reverts of the miscast session commits (NodeExecutable schema, harness-bridge package, EL- prefix + ExecutionLog schema, Step-2-blocker doc)
- `81593a4` — pollution clearance (removed HARNESS-EXECUTE chain files + empty harness-bridge scaffold + minimal dangling-ref cleanup in README, factory-meta SKILL, DECISIONS.md)
- `3b66857` — v2 PRD stripped of polluted `Integration with harness-bridge` section
- `4a1a0d1` — Pass 8 PRD stripped of polluted harness-adapter-consuming-nodes prose; lockfile regen
- `69e6bd7` — Gate-1-limitation Observed entry in DECISIONS.md (PRD-META-HARNESS-EXECUTE compiled Gate 1 PASS while being entirely conceptually wrong; structural coverage ≠ conceptual correctness)

---

## What the next session should do

**Phase 1 — Author the Stage 6 meta-PRD fresh.** Grounded in whitepaper §3 verbatim:
- Five roles: Planner, Coder, Critic, Tester, Verifier
- Each role is a state-transform contract with strict read/write/do-not/output rules + JSON-only footer
- Verifier's decision set: pass / patch / resample / interrupt / fail
- Stage 6 consumes a WorkGraph; produces code (plus tests, config, docs per ConOps §9.4)
- Nodes are **not** shell-command dispatch sites
- The PRD chain (PRS / BC / FP / PRD) needs a fresh artifact-ID stem — **pending Wes's decision** (candidates: `STAGE-6-CODING-SWARM`, `DARK-FACTORY`, `FUNCTION-SYNTHESIS`, `CODING-AGENT-TOPOLOGY`)

**Phase 2 — Compile the new PRD through Passes 0–8.** Verify Gate 1 PASS. Expect a new WorkGraph in `specs/workgraphs/`.

**Phase 3 — Flag the Gate-1 limitation at Architect review.** Per the 2026-04-19 Observed entry: Gate 1 does not catch conceptual miscasts. The new Stage 6 PRD must pass an explicit Architect review for semantic alignment with whitepaper §3 before any implementation.

**Phase 4 (much later) — Implement the five-role coordinator.** Whether the Factory delegates to an external harness (Claude Code, Cursor, OpenHands — whitepaper §9's "harness-agnostic" framing) or implements its own five-role topology internally is a **pending architectural decision**. The two options produce meaningfully different implementation scopes.

---

## What the next session MUST NOT do

- **Do not recreate the generic-dispatch model.** If you find yourself writing "adapter dispatches WorkGraph nodes," stop. Nodes are not runtime dispatch sites.
- **Do not treat `WorkGraphNode.executable` as a needed schema field.** It was reverted in `5f92eb8`. Shell commands don't belong on WorkGraph nodes. They belong in the code Stage 6 emits.
- **Do not rely on Gate 1 PASS to validate conceptual correctness.** The 2026-04-19 Observed entry in DECISIONS.md proves Gate 1 can PASS on PRDs that are entirely miscast. Architect review is the ground truth for semantic alignment.
- **Do not revive the deleted HARNESS-EXECUTE chain files.** They are recoverable via `git show 81593a4^:specs/prds/PRD-META-HARNESS-EXECUTE.md` for archaeological inspection only. Do not restore them.
- **Do not assume `shellExec` or `spawn` or `child_process` exists in harness-bridge.** There is no harness-bridge package anymore. If a new Stage 6 package needs shell-out primitives (unlikely — Stage 6 emits code, code may internally shell out), build them inside whichever package needs them.

---

## Pending decisions (require Wes before implementation)

1. **Artifact-ID stem for the new Stage 6 chain.** Candidates: `STAGE-6-CODING-SWARM`, `DARK-FACTORY`, `FUNCTION-SYNTHESIS`, `CODING-AGENT-TOPOLOGY`. Pick one, commit to it, name the whole PRS/BC/FP/PRD chain from it.
2. **Delegation vs in-Factory topology.** Whitepaper §9: "The Factory is harness-agnostic. When a harness is good (Claude Code and Cursor both qualify), the Factory delegates Stage 6 to it." Does the new PRD specify a thin coordinator that delegates to an external harness, an in-Factory five-agent implementation, or a hybrid with pluggable binding modes? This is architecturally load-bearing.
3. **Semantic-alignment review mechanism.** Per the Gate-1-limitation finding: a Gate 1.5 (automated), an Architect review gate (human), or Critic-role involvement at PRD authoring time. Not resolved.
4. **Task-list cleanup.** 240+ stale tasks accumulated in this session. Tasks are session-local so they vanish on fresh session start; no repo action needed.

---

## Load-bearing file map for a cold reader

- `specs/reference/The_Function_Factory_2026-04-18_v4.md` — whitepaper v4 (authoritative)
- `specs/reference/The_Function_Factory_ConOps_2026-04-18.md` — ConOps (authoritative)
- `.agent/memory/semantic/DECISIONS.md` — architectural decisions ledger (including retraction + Gate-1 Observed)
- `.agent/skills/factory-meta/SKILL.md` — Factory-meta reasoning skill + vertical-selection rubric
- `packages/compiler/src/passes/` — the 8 pass files; Pass 2 + Pass 3 have acknowledged MVP debt (see Pass 2 docstring lines 10–14 and Pass 3 hardcoded Gate-1-flavored templates at lines 37–109)
- `specs/prds/PRD-V2-CLASSIFY-COMMITS.md` — first non-meta vertical; compiles steady-state
- `specs/workgraphs/WG-V2-CLASSIFY-COMMITS.yaml` — v2's compiled WorkGraph

---

## Reverification discipline

After any claimed cleanup or completion, run all three:

```bash
git log --oneline -20
pnpm -r test
grep -rEln "harness-bridge|HARNESS-EXECUTE|ExecutionLog|shell-exec adapter|dry-run-adapter" --include="*.md" --include="*.ts" --include="*.yaml" --include="*.json" --exclude-dir=node_modules --exclude-dir=dist .
```

If the log has unexplained commits, the tests are fewer than 118, or the grep returns unexpected matches, the cleanup is incomplete. Trust the artifacts, not prose claims of done.
