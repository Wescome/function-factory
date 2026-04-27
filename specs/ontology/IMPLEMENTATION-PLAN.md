# Ontology Implementation Plan — Map to Territory

**Status:** Pending Architect review
**Prerequisite:** factory-ontology.ttl, factory-shapes.ttl, competency-questions.yaml

---

## The Gap

The ontology describes 16 constraints. The Factory currently violates 12 of them.

| Constraint | Status | What's missing |
|-----------|--------|----------------|
| C1 — Lineage completeness | PARTIAL | WorkGraphs have `prdId: "unknown"` |
| C2 — specContent propagation | FIXED | Deployed 2026-04-27 |
| C3 — BriefingScript completeness | PARTIAL | Architect node produces it but isn't a real agent |
| C4 — Agent is real agent | VIOLATED | All roles are callModel wrappers, not gdk-agent sessions |
| C5 — Invariant has detector | OPERATIONAL | Gate 1 enforces this |
| C6 — Every artifact reviewed | VIOLATED | No automated review gate on WorkGraphs |
| C7 — CRP on low confidence | VIOLATED | CRP never fires — no confidence threshold check |
| C8 — MentorScript enforcement | VIOLATED | Rules stored, never loaded by agents |
| C9 — Gate fail-closed | OPERATIONAL | Gate 1 fail-closed works |
| C10 — Semantic review grounded | FIXED | Critic uses specContent as ground truth |
| C11 — Coder has filesystem | VIOLATED | piAiRole fallback, sandbox not executing |
| C12 — Tester runs real tests | VIOLATED | Simulated tests, no real pnpm test |
| C13 — WorkGraph has atoms | OPERATIONAL | Gate 1 checks atom coverage |
| C14 — Lifecycle transitions | NOT IMPLEMENTED | No lifecycle state tracking |
| C15 — No secrets in artifacts | NOT ENFORCED | No runtime check |
| C16 — Event-driven communication | OPERATIONAL | Queue bridge works |

---

## Implementation Phases

### Phase A — Make agents real (fixes C4, C8)

**The single highest-leverage change.** Convert every role from `callModel()` wrapper to `gdk-agent` `agentLoop()` session with tools.

| Role | Current | Target | Tools | Environment |
|------|---------|--------|-------|-------------|
| Architect | callModel wrapper | agentLoop session | file_read, grep_search, arango_query | V8 (Coordinator) |
| Planner | callModel wrapper | agentLoop session | file_read, grep_search | V8 (Coordinator) |
| Coder | callModel wrapper | agentLoop session | file_read, file_write, bash, git | Sandbox Container |
| Critic | callModel wrapper | agentLoop session | file_read, grep_search, arango_query | V8 (Coordinator) |
| Tester | callModel wrapper | agentLoop session | file_read, bash | Sandbox Container |
| Verifier | callModel wrapper | agentLoop session | file_read, grep_search, arango_query | V8 (Coordinator) |

Each session loads: DECISIONS.md, LESSONS.md, active MentorScript rules (C8).

**Implementation:**
1. Create `packages/factory-agents/` with one file per role
2. Each role: `agentLoop(messages, context, config)` from `@weops/gdk-agent`
3. Tools from `@weops/gdk-ts` `buildCoreTools()` + custom `arango_query`
4. MentorScript rules loaded via `fetchMentorRules()` and injected as system context
5. graph.ts nodes call agent sessions instead of `callModel()`
6. TDD: test each role produces correct output shape with mock tools

**Blocked by:** Nothing. gdk-agent is in the monorepo.

---

### Phase B — Enforce constraints at artifact creation (fixes C1, C6, C7, C15)

Create a validation gate that runs SHACL-like checks before any artifact is persisted to ArangoDB.

**Implementation:**
1. Create `packages/artifact-validator/` with constraint functions
2. Each constraint from factory-shapes.ttl becomes a TypeScript validation function
3. The ArangoDB `save()` calls in pipeline stages and coordinator pass through the validator
4. Violations block persistence and emit a structured error
5. CRP auto-generation: when confidence < 0.7, validator creates a CRP document in `consultation_requests`

**Key validators:**
- `validateLineage(artifact)` — source_refs non-empty (C1)
- `validateReviewed(artifact)` — reviewedBy field present (C6)
- `validateConfidence(artifact)` — if < 0.7, require CRP (C7)
- `validateNoSecrets(artifact)` — scan content for key patterns (C15)

---

### Phase C — Activate sandbox execution (fixes C11, C12)

The sandbox Container is deployed. The `buildSandboxDeps()` uses real `@cloudflare/sandbox` calls. What's missing: the Coder and Tester nodes need to call gdk-agent sessions INSIDE the sandbox via `sandbox.exec()`.

**Implementation:**
1. Update `sandbox-scripts/run-session.js` to use gdk-agent `agentLoop()` with tools
2. Coder session: file_read, file_write, bash_execute, grep_search, git
3. Tester session: file_read, bash_execute (read-only gate blocks writes)
4. `sandboxRole()` in graph.ts sends task JSON to sandbox, gets real file diffs back
5. Test with simple Signal: Coder clones repo, writes code, Tester runs pnpm test

**Blocked by:** Phase A (agents must be real before sandbox matters).

---

### Phase D — CRP and lifecycle (fixes C7, C14)

**CRP auto-generation:**
1. Any agent role that produces output with confidence < 0.7 auto-creates a CRP
2. CRP written to `consultation_requests` collection
3. Pipeline enters `waitForEvent('crp-resolved')` until human responds with VCR
4. VCR written to `version_controlled_resolutions`

**Lifecycle state tracking:**
1. Add `lifecycleState` field to FunctionProposal
2. Transitions: proposed → designed (after WorkGraph compiled) → in_progress (Stage 6 starts) → implemented (Coder done) → verified (Gate 2 pass) → monitored (Gate 3 active)
3. Gate 2 must pass before verified. Gate 3 must be active before monitored.
4. Enforce via artifact-validator (C14)

---

### Phase E — Ontology as queryable knowledge graph

Load the OWL ontology into ArangoDB as a queryable graph. Agents can ask:
- "What constraints apply to a BriefingScript?"
- "What tools should the Architect role have?"
- "What's the lifecycle state of Function FN-XXX?"
- "Is there a pending CRP I should escalate?"

**Implementation:**
1. Create `ontology_classes` and `ontology_properties` collections in ArangoDB
2. Load factory-ontology.ttl into these collections at deploy time
3. Create `ontology_query` tool for agents — AQL queries against the ontology graph
4. Agents load role constraints from ontology at session start (not hardcoded)

---

## Dependency Graph

```
Phase A (real agents)
  ↓
Phase B (artifact validation) ← can start in parallel with A
  ↓
Phase C (sandbox execution) ← depends on A
  ↓
Phase D (CRP + lifecycle) ← depends on B
  ↓
Phase E (queryable ontology) ← depends on all above
```

**Phase A is the critical path.** Everything else is additive.

---

## Success Criteria

The ontology implementation is complete when:
1. All 30 competency questions are answerable via AQL queries
2. All 16 SHACL constraints are enforced at artifact creation time
3. Every agent role is a gdk-agent session with tools (not a callModel wrapper)
4. The Factory can synthesize a Function with real code (sandbox Coder) and real tests (sandbox Tester)
5. CRPs fire automatically when agent confidence is low
6. MentorScript rules are loaded and checked in every Critic review
7. CQ-29 answer changes from "most activities aspirational" to "all activities operational"

---

## Estimated Effort

| Phase | Tasks | Effort | Parallel? |
|-------|-------|--------|-----------|
| A — Real agents | 6 role conversions + tests | Large | No (sequential per role) |
| B — Artifact validation | Validator package + integration | Medium | Yes (parallel with A) |
| C — Sandbox execution | run-session.js upgrade + integration | Medium | After A |
| D — CRP + lifecycle | CRP auto-gen + lifecycle states | Medium | After B |
| E — Queryable ontology | ArangoDB loader + query tool | Small | After all |

**Total: 3-5 focused sessions.**
