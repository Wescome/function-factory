# Ontology Implementation Plan — Map to Territory

**Status:** Architect approved (SE review 2026-04-27)
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

### Phase 0 — Spike: Convert one role end-to-end (validates Phase A approach)

**Purpose:** Reduce risk before committing to all 6 role conversions. Convert the Architect role from `callModel()` wrapper to a `gdk-agent` `agentLoop()` session with tools. This validates: gdk-agent works in CF Workers, tools execute correctly, output shape is compatible with graph.ts.

**Acceptance criteria:**
1. Architect role uses `agentLoop()` with `file_read`, `grep_search`, `arango_query` tools
2. Produces a valid 6-field BriefingScript (same shape as current)
3. Loads DECISIONS.md, LESSONS.md, and MentorScript rules from ArangoDB
4. Runs in V8 isolate (Coordinator DO context)
5. graph.ts `architect` node calls the new session, not `callModel()`
6. One integration test: mock tools → verify BriefingScript output shape

**Blocked by:** Nothing. gdk-agent is in the monorepo.
**Estimated effort:** 1 focused session.

---

### Phase A — Make all agents real (fixes C4, C8)

**The single highest-leverage change.** Convert every remaining role from `callModel()` wrapper to `gdk-agent` `agentLoop()` session with tools.

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

**Blocked by:** Phase 0 (spike validates approach before full conversion).

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
Phase 0 (spike: Architect → gdk-agent)
  ↓
Phase A (all 6 roles → real agents)
  ├──→ Phase B (artifact validation) ← can start after Phase 0
  │      ↓
  │    Phase D (CRP + lifecycle) ← depends on B
  ↓
Phase C (sandbox execution) ← depends on A (Coder/Tester must be real)
  ↓
Phase E (queryable ontology) ← depends on all above
```

**Phase 0 is first.** Validates the approach before committing to all roles.
**Phase A is the critical path.** B can start in parallel after Phase 0 proves feasibility.
**C cannot start until A completes** — sandbox roles need real agent sessions.

---

## Phase F — Deploy + live validation (closes SC-4, SC-7)

Structured deployment and validation using the same ontology-backed methodology.

**Success criteria (binary pass/fail):**

| # | Criterion | Evidence required | Pass condition |
|---|-----------|-------------------|----------------|
| F1 | wrangler deploy succeeds | Deploy log, no errors | HTTP 200 on all 3 workers |
| F2 | ArangoDB seeded | seedOntology() + seedAgentDesigns() output | Counts match: 215 ontology docs + 6 agent designs |
| F3 | Dry-run synthesis completes | POST /trigger-synthesis with dryRun: true | Verdict: pass, all 9 nodes visited |
| F4 | Live synthesis completes | POST /trigger-synthesis with real Signal | Verdict: pass or patch (not error/timeout) |
| F5 | Artifact validator fires | Query consultation_requests after low-confidence run | CRP document exists with correct fields |
| F6 | Lifecycle transitions persist | Query specs_functions for lifecycleState | State matches expected stage |
| F7 | Ontology queryable | ontology_query tool returns constraints for WorkGraph | Returns C1, C6, C13 |

**Risk register:**

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| R7 | wrangler deploy fails on gdk-ai bundle size | Medium | High | Tree-shake unused providers; test with `wrangler deploy --dry-run` first |
| R8 | ArangoDB collections don't exist | Low | High | Create collections via AQL before seeding; idempotent |
| R9 | ofox.ai API key not in Worker secrets | High | Critical | Verify `wrangler secret list` before deploy; block on missing |
| R10 | Sandbox binding not provisioned | Medium | Medium | Tier 2 fallback handles this — gdk-agent in V8 |

**Dependency:** Phases 0-E complete. ArangoDB Oasis reachable. ofox.ai API key set.

**Rollback plan:** `wrangler rollback` to previous deployment. No schema migration — ontology seed is additive.

---

### Phase G — Remaining constraint enforcement (closes SC-2)

Phase B enforces 4 of 16 constraints at persist time (C1, C7, C9, C15). The remaining 12 exist as queryable ontology documents but are not runtime-enforced. This phase adds validators for the rest.

**Constraints to add to artifact-validator:**

| Constraint | What to enforce | Complexity |
|-----------|----------------|-----------|
| C2 — specContent propagation | If upstream Signal has specContent, derivation must carry it | Medium — requires upstream query |
| C3 — BriefingScript completeness | 6 required fields, min lengths | Small — pure validation |
| C4 — Agent is real agent | hasTools, hasMemoryAccess, runsIn on role docs | Small — schema check |
| C5 — Invariant has detector | detectedBy field required | Small — field check |
| C6 — Every artifact reviewed | reviewedBy field required on WorkGraphs and CodeArtifacts | Small — field check |
| C8 — MentorScript enforcement | mentorRulesChecked field on CritiqueReports | Small — field check |
| C10 — Semantic review grounded | groundedIn references original Signal | Medium — requires lineage query |
| C11 — Coder has filesystem | runsIn == SandboxContainer check | Small — config check |
| C12 — Tester runs real tests | runsIn == SandboxContainer check | Small — config check |
| C13 — WorkGraph has atoms | hasNode minCount 1 | Small — array check |
| C14 — Lifecycle transitions | Gate requirements on state changes | Already in lifecycle.ts |
| C16 — Event-driven communication | communicatesVia == synthesisQueue | Small — config check |

**Success criteria:** All 16 constraints have corresponding validators. Artifact-validator test count > 100.

---

## Success Criteria

The ontology implementation is complete when:

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| SC-1 | All 30 competency questions answerable via AQL | **Done** | ontology-loader seeds 215 docs, 33 tests pass |
| SC-2 | All 16 SHACL constraints enforced at persist time | **Partial** | 4/16 enforced (C1, C7, C9, C15), rest queryable. Phase G closes gap |
| SC-3 | Every agent role is a gdk-agent session with tools | **Done** | 6 agents, 55 tests, all use agentLoop + arango_query |
| SC-4 | Factory synthesizes with real code + real tests | **Pending** | Phase F live run required |
| SC-5 | CRPs fire automatically on low confidence | **Done** | crp.ts wired, 7 tests pass |
| SC-6 | MentorScript rules loaded in every Critic review | **Done** | Critic queries mentorscript_rules via arango_query |
| SC-7 | CQ-29 "all activities operational" | **Pending** | Phase F live evidence required |

---

## Estimated Effort

| Phase | Tasks | Effort | Status |
|-------|-------|--------|--------|
| 0 — Spike | Architect role → gdk-agent + 1 test | Small | **Done** |
| A — Real agents | 5 remaining role conversions + tests | Large | **Done** |
| B — Artifact validation | Validator package + integration | Medium | **Done** |
| C — Sandbox execution | run-session.js upgrade + integration | Medium | **Done** |
| D — CRP + lifecycle | CRP auto-gen + lifecycle states | Medium | **Done** |
| E — Queryable ontology | ArangoDB loader + query tool | Small | **Done** |
| F — Deploy + live validation | wrangler deploy + live Signal | Medium | **Next** |
| G — Full constraint enforcement | Remaining 12 validators | Medium | After F |

---

## Risk Register (SE Assessment)

| # | Risk | Likelihood | Impact | Mitigation | Status |
|---|------|-----------|--------|------------|--------|
| R1 | gdk-agent agentLoop incompatible with CF Workers V8 | Medium | Critical | Phase 0 spike validates this FIRST | **Retired** — 336 tests pass |
| R2 | Tool execution latency exceeds Workflow step timeout | Medium | High | AbortSignal.timeout per tool; budget-check node | Open |
| R3 | SHACL validation adds unacceptable latency to writes | Low | Medium | TS validators (not RDF engine); benchmark in Phase B | **Retired** — 51 tests, <1ms per validation |
| R4 | Sandbox Container cold-start too slow for inner loop | Medium | High | Fork-based repair; workspace prep during compile | Open — Phase F validates |
| R5 | MentorScript rules stale or contradictory | Low | Medium | Version MentorScripts; Critic checks rule freshness | Open |
| R6 | CRP waitForEvent blocks pipeline indefinitely | Low | High | CRP timeout (7d); auto-escalation on expiry | **Mitigated** — CRP is non-blocking |
| R7 | wrangler deploy fails on gdk-ai bundle size | Medium | High | Tree-shake unused providers; --dry-run first | Open — Phase F |
| R8 | ArangoDB collections don't exist | Low | High | Create collections via AQL before seeding | Open — Phase F |
| R9 | ofox.ai API key not in Worker secrets | High | Critical | Verify before deploy; block on missing | Open — Phase F |
| R10 | Sandbox binding not provisioned | Medium | Medium | Tier 2 fallback handles this | Open — Phase F |
