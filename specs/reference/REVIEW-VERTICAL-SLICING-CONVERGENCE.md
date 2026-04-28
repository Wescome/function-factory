# Review: Vertical Slicing Convergence (ADR-005 + SE Assessment)

**Reviewer:** Architect Agent
**Date:** 2026-04-27
**Documents reviewed:**
- ADR-005-vertical-slicing-execution.md (937 lines)
- SE-ASSESSMENT-VERTICAL-SLICING.md (320 lines)
- IMPLEMENTATION-PLAN.md (Phase F status)
- coordinator.ts (live code, post v4.1 Commit 1)
- graph.ts (10-node graph)
- graph-runner.ts (80-line StateGraph)
- state.ts (GraphState type)
- index.ts (queue consumer + callback routes)
- wrangler.jsonc (current bindings)

---

## 1. CONVERGENCE ASSESSMENT

### 1.1 Trade Study Winner vs ADR-005 Recommendation

| Point of comparison | SE Assessment | ADR-005 | AGREE? |
|---|---|---|---|
| Recommended option | Option C (bug fix + full vertical slicing) | Three-phase execution engine (Phase 1/2/3) | AGREE |
| Implementation gradient | Ship A first, then B, then C | v4.1 Commit 1 (A) -> v4.1 Commit 2 (B) -> v5 (C) -> v5.1 (optimization) | AGREE |
| Each step independently deployable | Explicitly stated | Explicitly stated per commit | AGREE |
| Latency reduction mechanism | Parallel atom DOs (DynTaskMAS pattern) | Promise.all on stub.fetch() per dependency layer | AGREE |
| Blast radius mechanism | Per-atom retry isolation | Per-atom retry loop in AtomExecutor DO + per-atom repair budget | AGREE |
| Placeholder resolution | LLMCompiler-style | LLMCompiler-style with concrete `resolvePlaceholders()` function | AGREE |

**Verdict: FULL CONVERGENCE.** The SE Assessment's Option C is precisely the architecture ADR-005 specifies. No contradictions found.

### 1.2 Risk Consistency

| SE Risk | ADR-005 Risk | Alignment |
|---|---|---|
| VS-R1: Cross-atom coherence loss | VS-4: Integration catches problems too late | ALIGNED -- same risk, ADR-005 adds Phase 3 integration verification as mitigation |
| VS-R2: Coordinator orchestration complexity | VS-5: Increased complexity in crash recovery path | ALIGNED -- same risk, ADR-005 adds CompletionLedger as specific mitigation |
| VS-R3: CF platform limits | VS-2: AtomExecutor DO count exceeds CF limits + VS-6: DO-to-DO fetch latency | ALIGNED -- ADR-005 splits into two sub-risks, both assessed as Low |
| VS-R4: Callback self-fetch deadlock | VS-8: Callback from DO to Worker fails | ALIGNED -- same risk. Note: live code already uses Queue relay, not fetch callback |
| VS-R5: Test suite regression | Not explicitly listed | GAP -- ADR-005 does not carry this risk. See amendment A1. |

**Verdict: SUBSTANTIALLY ALIGNED.** One gap (VS-R5 not in ADR-005). See amendments.

### 1.3 FFBD Decomposition vs ADR-005 Three-Phase Design

| FFBD Function | ADR-005 Phase | Match? |
|---|---|---|
| F1: Whole-Graph Processing (Serial) | Phase 1: WorkGraph-level pipeline | MATCH -- same 5 nodes (architect, semantic-critic, compile, gate-1, planner) |
| F2: Per-Atom Synthesis (Parallel AND) | Phase 2: Per-atom parallel execution | MATCH -- same topology (topo sort, layer-serial, atom-parallel) |
| F2.2.1: For each Atom (code, critic, test, verify) | AtomExecutor DO (code, code-critic, test, verify) | MATCH -- same 4-node pipeline |
| F2.2.1.5 retry loop (max 3) | Per-atom repair loop (max 3, configurable) | MATCH |
| F3: Integration Verification | Phase 3: Integration verification | MATCH -- same merge + contract check + integration test + final verdict |

**FFBD decision points the ADR does not resolve:**
- F2.2.1 dispatch method: FFBD lists "separate DO per atom OR sequential in coordinator" and "Queue per atom OR direct DO fetch" as open decision points. ADR-005 resolves both (separate DO, direct fetch via Promise.all). This is correct -- the ADR is more specific than the FFBD, which is the expected relationship.

**Verdict: FULL MATCH.** The FFBD is a correct functional decomposition of the ADR-005 design.

---

## 2. COMPLETENESS GAPS

### 2.1 AtomExecutor DO Design Specificity

**Status: SUFFICIENT WITH GAPS.**

What is specified:
- Class extends `Agent<CoordinatorEnv>` (Section 4.3.1)
- 4-node internal graph: code -> code-critic -> test -> verify (Section 4.3.5)
- Per-atom retry loop with budget-check conditional edge (Section 4.3.5)
- Input: AtomSliceSpec + resolved upstream CodeArtifacts
- Output: AtomResult (CodeArtifact + AtomVerdict + TestReport)
- Uses same StateGraph runner (graph-runner.ts)

**GAP G1: AtomResult type not defined.** ADR-005 references `AtomResult` in multiple places (Sections 4.3.2, 4.3.3, 4.6) but never provides its TypeScript interface. An Engineer needs this.

**GAP G2: AtomExecutor fetch handler not specified.** Section 4.3.1 shows the class signature but not the `fetch()` override that receives the `execute-atom` request. The coordinator calls `stub.fetch(new Request('https://do/execute-atom', ...))` (Section 4.3.2) but the receiving end is not shown.

**GAP G3: AtomExecutor alarm not specified.** Section 4.5 states "If any atom times out, its AtomExecutor DO alarm fires and returns an interrupt verdict" but the alarm handler code is not provided. The per-atom alarm timeout value is not specified.

**GAP G4: AtomExecutor Fiber recovery not specified.** Section 4.5 mentions "Fiber recovery fires" for the coordinator but does not specify the `onFiberRecovered()` handler for the AtomExecutor DO itself. Per-atom crash recovery semantics are mentioned but not implemented.

### 2.2 Placeholder Variable Resolution

**Status: SPECIFIED.**

Section 4.3.3 provides the concrete `resolvePlaceholders()` function and the `extractDependencyArtifact()` helper call. The mechanism is clear: JSON.stringify the spec, replaceAll placeholder strings, JSON.parse back.

**CONCERN C1: String replacement on JSON is fragile.** If a placeholder like `$atom1_interface` appears inside a JSON string value that also contains `$` characters, or if the replacement text contains JSON-special characters (quotes, backslashes), the naive `replaceAll` + `JSON.parse` will break. The ADR should specify that replacement values are JSON-escaped before insertion, or that placeholders are resolved at the object level rather than string level.

### 2.3 Coordinator Orchestration (Fan-out/Fan-in)

**Status: SPECIFIED.**

Section 4.3.2 provides the concrete `Promise.all` dispatch loop. Section 4.6 provides the CompletionLedger for crash recovery. Section 4.5 explains why Promise.all over direct stub.fetch is chosen over alternatives.

**CONCERN C2: Promise.all blocks coordinator DO for entire layer duration.** The coordinator DO is awaiting I/O on all atom fetches simultaneously. If one atom in a layer takes 5 minutes and another takes 30 seconds, the coordinator DO is suspended for 5 minutes. If the coordinator's own alarm fires during this, the alarm handler runs (DOs are single-threaded but alarms can preempt I/O suspension). This is correct behavior but not documented.

**CONCERN C3: What happens if the coordinator DO itself is evicted during Promise.all?** Section 4.5 mentions Fiber recovery but the actual recovery logic is described as "check which atoms completed via their DO storage and resume from the last completed layer." This requires the coordinator to be able to query AtomExecutor DO storage, which is not possible cross-DO. The coordinator can only re-fetch the AtomExecutor DOs -- and if those DOs have already completed and returned their results to a now-evicted coordinator, the results are lost unless the AtomExecutor DOs cache their results. The ADR says "re-dispatching a completed atom returns cached result" (VS-1 mitigation) but this requires AtomExecutor to implement idempotency via DO storage check-before-run. **This is not shown in the AtomExecutor code.**

### 2.4 State Types

**Status: PARTIALLY DEFINED.**

Defined in ADR-005:
- `SlicePlan` (Section 4.2) -- complete
- `AtomLayer` (Section 4.2) -- complete
- `AtomSliceSpec` (Section 4.2) -- complete
- `AtomState` (Section 4.3.6) -- complete
- `WorkGraphState` (Section 4.3.6) -- complete
- `CompletionLedger` (Section 4.6) -- complete

**GAP G5: `AtomResult` type missing** (reiteration of G1).

**GAP G6: `ResolvedAtomSpec` type not defined.** Referenced in `resolvePlaceholders()` return type and `AtomState.atomSpec` but not shown.

**GAP G7: `SharedContext` type not defined.** Referenced in `AtomState.sharedContext` but not shown. Presumably equals `SlicePlan.sharedContext` but not stated.

**GAP G8: Relationship between new `WorkGraphState` and existing `GraphState`.** The ADR introduces `WorkGraphState` (Section 4.3.6) as the orchestrator-level state, but the existing `GraphState` (state.ts) already serves this role. The migration path -- whether `WorkGraphState` replaces `GraphState` or extends it -- is not specified. The existing `GraphState` has fields (`sandboxName`, `freshBackupHandle`, `coderBackupHandle`, `executionMode`) that are per-atom in the new model but per-WorkGraph in the current model. This needs explicit handling.

### 2.5 wrangler.jsonc Changes

**Status: PARTIALLY SPECIFIED.**

Section 5.2 Commit 5 states: "Add ATOM_EXECUTOR DO binding. Add migration tag for new DO class." Section 6 lists "AtomExecutor DO (new)" as a CF primitive.

**GAP G9: No concrete wrangler.jsonc diff.** The ADR should show the exact binding entry and migration tag. Current wrangler.jsonc has two bindings (COORDINATOR, SANDBOX) and two migrations (v1, v2). The ADR should specify the v3 migration tag for AtomExecutor's SQLite class.

**GAP G10: SYNTHESIS_RESULTS queue binding needed on AtomExecutor.** If AtomExecutor DOs need to notify the coordinator (or the Worker) on completion, they need access to the Queue binding. But per Section 4.5, the design uses Promise.all (coordinator awaits response), not Queue. So Queue binding is NOT needed on AtomExecutor. However, the AtomExecutor's `CoordinatorEnv` type (Section 4.3.1 shows `extends Agent<CoordinatorEnv>`) implies it shares the same env type as the coordinator. If so, it has access to SYNTHESIS_RESULTS. If not, a separate env type is needed. **This is ambiguous.**

---

## 3. METHODOLOGY COMPLIANCE

### 3.1 Binary Success Criteria

| Phase | Has binary criteria? | PASS/FAIL |
|---|---|---|
| v4.1 Commit 1 (bug fix) | Yes -- V1-V4, V6 in Section 8.1 | PASS |
| v4.1 Commit 2 (retry isolation) | Yes -- V5 in Section 8.1 | PASS |
| v5 (vertical slicing) | Yes -- V7-V12 in Section 8.2 | PASS |
| v5.1 (adaptive depth) | Yes -- V13-V15 in Section 8.3 | PASS |

**Note:** SE Assessment Section 4 also has evidence requirements per phase, which align with ADR-005's criteria. Convergence confirmed.

### 3.2 Risk Register

| Phase | Has risk register? | PASS/FAIL |
|---|---|---|
| v4.1 | Covered by VS-8 (callback failure) | PASS |
| v5 | VS-1 through VS-7 | PASS |
| v5.1 | No new risks introduced (logic-only change) | PASS |
| SE Assessment | VS-R1 through VS-R5 with TRM six-question format | PASS |

### 3.3 Pre-flight Checklists

**Status: NOT IN ADR-005.**

The ADR-005 does not include pre-flight checklists for any deployment. IMPLEMENTATION-PLAN.md Phase F has pre-flight checklist PF1-PF6, but those apply to Phase F (general deploy), not specifically to v5 vertical slicing.

**GAP G11: No v5-specific pre-flight checklist.** v5 introduces a new DO class which requires a migration. A pre-flight should verify: new migration tag applied, ATOM_EXECUTOR binding resolves, AtomExecutor DO can be instantiated, existing SynthesisCoordinator unaffected by migration.

### 3.4 Rollback Triggers

**Status: NOT IN ADR-005.**

IMPLEMENTATION-PLAN.md Phase F specifies: "Rollback triggers: F1 fails or F3 fails." ADR-005 does not specify rollback triggers for v5.

**GAP G12: No rollback triggers for v5.** What conditions trigger reverting v5 to v4.1? The gradient design implies "fall back to B" but the operational trigger is not defined.

### 3.5 Evidence Requirements Specificity

| Criterion | Specific? | PASS/FAIL |
|---|---|---|
| V1: Queue consumer acks within 1 second | Timing assertion -- specific | PASS |
| V7: Both execute in parallel, total time < 2x single | Timing comparison -- specific | PASS |
| V8: Atom_3 input contains actual TypeScript interface from Atom_1 | Assertion on input content -- specific | PASS |
| V9: Atom_2 fails, retries 3x, other atoms unaffected | Behavioral assertion -- specific | PASS |
| V11: Simulate DO eviction after layer 0 | Requires infrastructure for controlled eviction -- **how?** | CONCERN |
| V12: Set 30s atom timeout, atom takes 60s | Requires controllable atom execution time -- **how?** | CONCERN |

**CONCERN C4:** V11 and V12 require infrastructure for simulating DO eviction and controlling atom execution time. These are not impossible (mock the DO, inject delays) but the test approach is not specified. For a methodology audit, the HOW of evidence collection matters.

---

## 4. LIVE EVIDENCE INCORPORATION

### 4.1 Eight Live Runs in Risk Register

| Live finding | In risk register? | Location |
|---|---|---|
| v1: dry-run PASS | Baseline -- not a risk | N/A |
| v2: CriticAgent timeout at 120s | Retired -- captured in historical context | ADR Section 2.2 (latency pathology) |
| v3: Critic caught hallucinated invariant | Retired -- hardened Stage 4 prompt | Not explicitly captured as retired risk |
| v4: DO alarm at 180s killed synthesis | Retired -- raised to 900s | ADR Section 2.1 (alarm behavior) |
| v5: DO callback self-fetch blocked by CF | **CRITICAL -- partially captured** | ADR Section 3.2 shows callback design. But live code uses Queue relay (SYNTHESIS_RESULTS), which is the actual fix. ADR Section 3 still proposes fetch-based callback as the design. See Amendment A2. |
| v6: Gate 1 failed (unbound atoms) | Retired -- binding safety net | Not in risk register. Historical only. |
| v7: Synthesis timed out after DO eviction | Captured -- VS-1 (coordinator eviction) and alarm handler | ADR Sections 3.6, 4.5 |
| v8: 10 serial LLM calls exceed DO lifetime | Root cause for vertical slicing -- whole ADR addresses this | ADR Section 2.2 |

**GAP G13: ADR-005 Section 3 (Bug Fix Design) proposes fetch-based callback, but shipped code uses Queue relay.** The `notifyCallback()` in coordinator.ts (line 372-388) publishes to `SYNTHESIS_RESULTS` queue, not a fetch to `/synthesis-callback`. The ADR's Section 3 is partially obsolete -- it describes the design that was rejected in favor of the Queue pattern discovered during v5/v6 debugging. The `/synthesis-callback` route in index.ts (line 95-133) exists as a secondary path but the primary path is Queue-based.

This is not a blocking issue (the Queue pattern is strictly better -- it avoids self-fetch deadlock), but the ADR should be updated to reflect shipped reality.

### 4.2 Self-Fetch Blocker as Constraint

**Status: PARTIALLY DOCUMENTED.**

ADR Section 3.7 error handling table mentions "Worker unreachable from DO" with the note "DO self-fetch works (same zone)." This is WRONG per live evidence -- CF blocks DO-to-own-Worker self-fetch. The shipped code (coordinator.ts line 362-388) uses Queue relay specifically because self-fetch is deadlocked.

SE Assessment VS-R4 correctly identifies "Queue fallback" as mitigation. But ADR-005 Section 3 still describes the fetch-based pattern as primary.

**GAP G14: ADR-005 Section 3 must be updated to show Queue relay as primary, not fetch callback.** The fetch callback is a fallback for external callers, not the DO-to-Workflow notification path.

---

## 5. IMPLEMENTATION GRADIENT INTEGRITY

### 5.1 Dependency Chain

| Step | Depends on | Independently deployable? | PASS/FAIL |
|---|---|---|---|
| v4.1 Commit 1 (Queue relay) | Nothing -- base | Yes -- **SHIPPED** | PASS |
| v4.1 Commit 2 (per-atom retry) | v4.1 Commit 1 | Yes -- modifies graph.ts verifier edge logic only | PASS |
| v5 Commit 1 (AtomExecutor DO) | v4.1 Commit 1 (Queue relay pattern) | Yes -- new file, no existing code changes | PASS |
| v5 Commit 2 (SlicePlan + Phase 1) | v5 Commit 1 (AtomExecutor exists) | Yes -- modifies planner output shape | **CONCERN** |
| v5 Commit 3 (Coordinator orchestration) | v5 Commits 1+2 | Yes -- modifies coordinator.ts | **CONCERN** |
| v5 Commit 4 (Phase 3 integration) | v5 Commit 3 | Yes -- adds new function | PASS |
| v5 Commit 5 (wrangler.jsonc) | v5 Commits 1-4 | Yes -- infrastructure only | PASS |
| v5.1 (adaptive depth) | v5 complete | Yes -- logic change in AtomExecutor | PASS |

**CONCERN C5: v5 Commits 2 and 3 are not independently deployable.** If you deploy v5 Commit 2 (SlicePlan output from planner) without Commit 3 (coordinator orchestration that consumes SlicePlan), the planner produces output the coordinator cannot consume. The monolithic graph expects `Plan`, not `SlicePlan`. These two commits must be deployed together, or Commit 2 must maintain backward compatibility (emit both Plan and SlicePlan shapes).

**CONCERN C6: v5 Commit 1 (AtomExecutor DO) requires Commit 5 (wrangler.jsonc).** You cannot instantiate AtomExecutor DOs without the wrangler binding. Commit 5 should be Commit 1 (or merged with Commit 1). Deploy the infrastructure before the code that uses it.

### 5.2 Verification Criteria Per Step

| Step | Has verification? | Criteria |
|---|---|---|
| v4.1 Commit 1 | V1-V4, V6 | Complete |
| v4.1 Commit 2 | V5 | Complete |
| v5 Commits 1-5 | V7-V12 | Complete but at v5-aggregate level, not per-commit |

**GAP G15: No per-commit verification criteria for v5.** V7-V12 are all v5-aggregate. Commit 1 (AtomExecutor DO) should have its own verification: "AtomExecutor runs independently with mock agents." Commit 2 should have: "Planner produces valid SlicePlan from WorkGraph." These are mentioned in the commit descriptions but not in the formal verification table.

---

## 6. AMENDMENTS REQUIRED

### Critical (must fix before implementation)

**A1: Add VS-R5 (test regression risk) to ADR-005 Risk Register.**
The SE Assessment correctly identifies this risk. ADR-005 omits it. v5 changes the graph topology fundamentally; many existing 401 tests assume monolithic flow. The ADR must acknowledge this and specify the mitigation strategy (incremental shipping, backward-compatible planner output).

**A2: Update ADR-005 Section 3 to reflect shipped Queue relay pattern.**
Section 3 describes a fetch-based callback design. The shipped code uses `SYNTHESIS_RESULTS` Queue. Section 3 should be updated to:
- Primary path: Queue relay (`this.env.SYNTHESIS_RESULTS.send(...)`)
- Secondary path: `/synthesis-callback` route for external callers
- Retired design: direct fetch from DO to Worker (blocked by CF self-fetch restriction)

**A3: Define missing types: `AtomResult`, `ResolvedAtomSpec`, `SharedContext`.**
These are referenced but undefined. An Engineer cannot implement without them.

**A4: Specify AtomExecutor idempotency mechanism.**
VS-1 mitigation states "re-dispatching a completed atom returns cached result." The AtomExecutor must check DO storage for a cached result before executing. This is not shown in the code samples.

### Important (should fix before implementation)

**A5: Specify v5 commit ordering with infrastructure first.**
Reorder: Commit 5 (wrangler.jsonc) should be Commit 1 or merged with the AtomExecutor DO commit. Cannot test DOs without bindings.

**A6: Add per-commit verification criteria for v5.**
Each of the 5 v5 commits should have its own binary acceptance test, not just aggregate V7-V12.

**A7: Add v5 pre-flight checklist and rollback triggers.**
Modeled after IMPLEMENTATION-PLAN.md Phase F checklist:
- PF: migration tag applied, ATOM_EXECUTOR binding resolves
- Rollback trigger: AtomExecutor DO instantiation fails or existing synthesis-results Queue broken

**A8: Specify GraphState-to-WorkGraphState migration path.**
Document whether WorkGraphState replaces GraphState (breaking change to all tests) or extends it (additive). Specify which existing GraphState fields move to AtomState.

### Minor (can fix during implementation)

**A9: Harden placeholder resolution against JSON injection.**
The string-level replaceAll on JSON is fragile. Either escape replacement values or resolve at object level.

**A10: Specify AtomExecutor alarm timeout value.**
Currently unspecified. Should be proportional to atom complexity: trivial 60s, standard 300s, high 600s (matching the SASE adaptive depth).

**A11: Document coordinator DO alarm behavior during Promise.all suspension.**
Clarify that the coordinator alarm can fire while the DO is suspended on I/O, preempting the Promise.all. The alarm handler should check the CompletionLedger and notify completion for any finished atoms.

**A12: Specify AtomExecutor env type.**
Clarify whether AtomExecutor uses `CoordinatorEnv` or a separate, narrower env type. AtomExecutor needs `OFOX_API_KEY` and `ARANGO_*` but may not need `SYNTHESIS_RESULTS` or `SANDBOX`.

---

## 7. FINAL RECOMMENDATION

### APPROVE WITH AMENDMENTS

The ADR-005 and SE Assessment are in full convergence on architecture, risk analysis, and implementation gradient. The FFBD decomposition in the SE Assessment is a faithful functional model of the ADR-005 design. The trade study winner (Option C) matches the ADR-005 recommendation. The live evidence from 8 deployment attempts is incorporated into the design rationale.

The amendments fall into two categories:

**Category 1: Stale documentation (A2, G13, G14).** The ADR was written while the Queue relay pattern was being discovered. Section 3 describes a superseded design. This is cosmetic -- the shipped code is correct, the ADR just needs to catch up.

**Category 2: Implementation specification gaps (A1, A3, A4, A5, A6, A7, A8).** These are missing details that an Engineer would need to ask about during implementation. None change the architecture; they fill in type definitions, ordering, and operational procedures.

**No architectural changes are required.** The design is sound, research-grounded, and correctly mapped to CF primitives. The implementation gradient (v4.1 -> v5 -> v5.1) is independently deployable with the corrections in A5. The risk analysis covers the known failure modes from live evidence.

**Gate condition:** Fix critical amendments A1-A4 in the ADR before dispatching v5 implementation tasks to an Engineer. Amendments A5-A12 can be resolved during implementation.

---

## Appendix: Cross-Reference Matrix

| SE Assessment Section | ADR-005 Section | Status |
|---|---|---|
| Trade study (Section 1) | Decision + Context (Sections 1-2) | Aligned |
| Option A (bug fix) | Section 3 (Bug Fix Design) | Aligned (needs A2 update) |
| Option B (retry isolation) | Section 5.1 v4.1 Commit 2 | Aligned |
| Option C (vertical slicing) | Section 4 (Vertical Slicing Design) | Aligned |
| TRM Risk 1 (coherence) | VS-4 | Aligned |
| TRM Risk 2 (orchestration) | VS-1, VS-5 | Aligned |
| TRM Risk 3 (platform limits) | VS-2, VS-6 | Aligned |
| TRM Risk 4 (self-fetch deadlock) | VS-8 + Section 3.7 | Aligned (needs A2 update) |
| TRM Risk 5 (regression) | Not in ADR-005 | GAP (A1) |
| FFBD F1 | Phase 1 (Section 4.2) | Matched |
| FFBD F2 | Phase 2 (Section 4.3) | Matched |
| FFBD F3 | Phase 3 (Section 4.4) | Matched |
| Atom lifecycle state machine | CompletionLedger (Section 4.6) | Matched |
| CF primitive allocation | Section 6 (CF Platform Mapping) | Matched |
