# Investigation — 003-flue-retirement

> Background research, alternatives evaluated, external sources
> Generated: 2026-06-12

---

## 1. Why Flue Is Being Retired

Flue (`@flue/runtime`) provided two things the Factory actually used:
1. The virtual sandbox (just-bash execution, zero cold-start via `createAgent()`)
2. The `init()` → `harness.session()` loop (durable session management)

Everything else attributed to Flue (DO SQLite, AGENTS.md injection, KV/D1 persistence, CoordinatorDO lifecycle) was Factory code that *called* Flue's session primitives. The primitives themselves were thin wrappers.

Flue signals: ~3.8K GitHub stars, no production SLA, experimental status, no CF-native support contract. The Factory is 100% Cloudflare-native — every other layer is a CF primitive. Flue was the only third-party dependency with no production guarantee.

**Source:** `SPEC-FF-FLUE-RETIRE-001 §1`; `_reversa_sdd/ksp-flue-workflow/design.md#2.3` (five bridge points are the totality of Flue API usage)

---

## 2. Project Think (`@cloudflare/think`)

Project Think is Cloudflare's first-party opinionated harness for Durable Object-backed agents.

- `Think<Env>` base class: DO with lifecycle hooks (`configureSession`, `beforeToolCall`, `afterToolCall`, `onChatResponse`)
- `runFiber(name, fn)`: durable execution fiber with `ctx.stash()` checkpointing — survives Worker eviction mid-stream
- Sub-agents via Facets: collocated DO-isolated sub-agents (unused in this feature)
- Execution ladder: Tier 0 `@cloudflare/shell` (filesystem workspace), Tier 1 `@cloudflare/codemode` (Dynamic Worker isolate for LLM-generated JS), Tier 4 `@cloudflare/sandbox` (full CF Container)

Version: v0.12.4 (May 2026). Active changelog. Used internally by Cloudflare for their own agent infrastructure.

**Why `ThinkExecutor` does NOT extend Think for the LLM loop:** Option B separates the LLM orchestration concern (Mastra owns model routing, memory, processors, evals) from the durable execution concern (Think owns crash recovery, workspace, sandbox). Extending Think for the LLM loop would force the model binding into Think's lifecycle, bypassing Mastra's processor chain — breaking I4.

---

## 3. Mastra Agent Integration (`@mastra/core`)

Mastra `Agent` provides:
- `model`: resolved per `MODEL_BY_ROLE[role]` — supports CF Workers AI bindings directly
- `inputProcessors` / `outputProcessors`: typed `BaseProcessor` chain, fires `processOutputStep` after LLM response, before tool dispatch
- `memory`: `@mastra/memory` + `D1Store` (`@mastra/cloudflare-d1`) — T3 Observational Memory
- `tools`: async resolver via `requestContext` — tools are factory functions, not instances

`processOutputStep` timing: fires synchronously after the model returns a tool call but before the tool executor receives it. This is the correct I4 enforcement moment. Verified in D-2 clarification (2026-06-12).

---

## 4. Alternatives Evaluated

| Option | Description | Rejected because |
|--------|-------------|-----------------|
| **Option A** | `ConductingAgent extends Think<Env>`, Mastra used only for T1/T4 | Mastra's processor chain not in the tool-call path; I4 enforcement split across frameworks; evals and memory not wired into the execution loop |
| **Option B (chosen)** | `ConductingAgent` is Mastra `Agent`; `ThinkExecutor extends Think` for substrate only | Mastra owns full orchestration; Think owns durability; clean boundary at tool API |
| **Keep Flue** | Continue with current substrate | No production SLA; experimental; CF-native alternative now available and architecturally superior |

---

## 5. Cloudflare Agents SDK (`agents`)

The `agents` package is the CF Agents SDK. Provides `Agent` base class and `AgentWorkflow`. `ThinkExecutor extends Think` (not `Agent`) because Think provides `runFiber()` crash recovery and workspace primitives that `Agent` does not.

**Source:** `developers.cloudflare.com/agents`; `cloudflare/agents` GitHub changelog (v0.12.4, May 2026)

---

## 6. kimi-k2.6 Gateway Bypass (BR-FLUE-04)

The Cloudflare AI Gateway's SSE connection closes the response body prematurely on kimi-k2.6 text turns, causing stream reads to hang. The coder role profile must keep `gateway: false` in `MODEL_BY_ROLE` (equivalent to the prior `coderProfile.gateway = false` in `agents.ts`). This is a confirmed production failure mode — not a preference.

**Source:** `_reversa_sdd/domain.md#BR-FLUE-04`; commit 46b4868

---

## 7. Module Ownership

`@factory/gears` becomes the sole Mastra-dependent Factory package. This is intentional isolation — no other Factory package (ff-pipeline, synthesis-coordinator, KSP packages) takes a `@mastra/*` dependency. The boundary is clean: CoordinatorDO dispatches a directive; `@factory/gears` executes it using whatever substrate it chooses.

---

## 8. Skill Path Parity: `session.withSkill()` vs `@cloudflare/think` (AC-5)

**Verdict: No direct path parity. The skill model is different by design.**

Flue's `session.skill(skillRef)` resolved a skill by reading `.agents/skills/<skillRef>/SKILL.md` from the workspace at runtime — an ad-hoc, path-based invocation model.

`@cloudflare/think` uses a registry model instead:
- Skills are registered at class level by overriding `getSkills(): SkillSource[]`
- `SkillSource` implementations: `fromManifest(manifest)`, `r2(bucket, options)`, or bundled at build time via the Agents Vite plugin (`import skills from "agents:skills"`)
- Skills are keyed by **name**, not path — `SkillRegistry.load(name)` returns a `SkillContent | null`
- There is no `withSkill(skillRef)` or equivalent path-based runtime invocation API in `agents@0.15.0` or `@cloudflare/think@0.8.8`

**Implication for AC-5:** The Factory's skill invocation pattern must migrate from path-based to name-based. Skills should be bundled via the Vite plugin (for static skills) or loaded from R2 (for dynamically updated skills). The R2 source (`r2(bucket, options)`) looks for objects at `<prefix><skillName>/SKILL.md` — the closest structural equivalent to Flue's convention.

**Action required (not in this feature scope):** Any Factory code that invokes Flue skills by `.agents/skills/<name>/SKILL.md` path must be rewritten to use `getSkills()` override + `SkillRegistry`. This is tracked separately — it does not block 003-flue-retirement because `ThinkExecutor` does not invoke skills directly; that happens within the Mastra `Agent` tool resolver layer.

**Source:** `agents@0.15.0/dist/skills/index.js` (SkillRegistry, r2 source, SKILL.md key convention); `@cloudflare/think@0.8.8/dist/think.js` (getSkills override pattern); `@cloudflare/think@0.8.8/dist/cli/index.js` (bundled skill at `agents/assistant/skills/project-helper/SKILL.md` confirms SKILL.md file naming is preserved).
