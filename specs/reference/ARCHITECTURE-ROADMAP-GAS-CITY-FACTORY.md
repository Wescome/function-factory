# Function Factory + Gas City — Architecture Roadmap

**Status:** Architect proposal for Phase 1–N
**Authored by:** Architect Agent, 2026-05-20
**Revised by:** GUV, 2026-05-20 — boundary redrawn from SE Ontology Draft 1.1 first principles
**Authority:** ADR-010 (Gas City supersedes NLAH), DECISIONS.md (2026-05-19), Phase 0 RESULTS.md (PASS), SE-Onto-Draft-1.1 (§7 Conditional Structure)
**Audience:** Wes (decisions), SE Agent (requirements decomposition), Engineer Agent (implementation), Critic Agent (review)

---

## 0. First-Principles Grounding

This roadmap is grounded in the SE Ontology (Draft 1.1) rather than derived from implementation convenience.

The ontology's §7 Conditional Structure establishes the governance conditions for each relation:

> Specification S participates in **governs** only if a **coherence-verification-function** bears a favorable verdict on S.
> Execution-trace T participates in **evidence_for** only if a **fidelity-verification-function** continuously bears a favorable verdict on the corresponding execution.
> Amendment A participates in **if_adopted_produces** only if a verification-function bears a favorable verdict on A.

From these conditions, the ownership split follows directly:

| SE Ontology Category | Owner | Rationale |
|---|---|---|
| Specification (IS → ES → Formula) | **Factory** | Factory formalizes knowing-states into artifacts |
| Coherence Verification (of specs) | **Factory** | Pre-dispatch gate on specification internal consistency |
| Amendment (new IS → ES when fidelity fails) | **Factory** | Factory produces successor specifications |
| Execution (sessions, beads, convergence) | **Gas City** | Gas City runs work |
| Fidelity Validation (execution-trace → verdict) | **Gas City** | The VERIFY stage IS the fidelity-verification-function |
| Event emission (execution-trace to Factory) | **Gas City** | Gas City's Event Bus carries verdicts and traces |
| Persistence Monitoring (ongoing function health) | **Factory** | Factory receives events and tracks lifecycle |

**The one line:** Factory decides WHAT to build (Specification) and WHAT to build next (Amendment). Gas City decides HOW to build it (Execution) and WHETHER it was built correctly (Validation). Factory validates specifications; Gas City validates executions.

---

## 1. Architecture Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│  TESSERA — Knowing-State Prosthesis                                    │
│  Holds conceptual-tier content on behalf of executing agents.          │
│  Read-only from Factory and Gas City sessions during execution.        │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │ (read queries)
┌──────────────────────────────▼─────────────────────────────────────────┐
│  FACTORY — Specification + Amendment Layer                             │
│  Cloudflare Workers + ArangoDB                                         │
│                                                                        │
│  Owns:                                                                 │
│    Signal → Pressure → IS → ES (Specification cycle)                   │
│    Coherence VR: verifies specification is coherent BEFORE dispatch    │
│    Trellis Execution Packet → Gas City Formula TOML compilation         │
│      (deterministic, no LLM)                                            │
│    Lineage graph (ArangoDB)                                            │
│    Amendment generation: failed verdict → new IS → ES                  │
│    Lifecycle governance: verified → monitored → superseded             │
│    Persistence monitoring via Gas City event intake                    │
│                                                                        │
│  Exposes to Gas City:                                                   │
│    POST /webhooks/gascity  (Event Bus → Factory Signal Collector)       │
│                                                                        │
│  Calls Gas City:                                                        │
│    POST {GC}/dispatch  (Formula + lineage labels)                       │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │ HTTP only — no shared storage
                               │ Factory writes ArangoDB; Gas City writes Dolt — never crossed
┌──────────────────────────────▼─────────────────────────────────────────┐
│  GAS CITY — Execution + Validation Layer                               │
│  VPS (Phase 1–3) → k8s (Phase 4+)                                       │
│                                                                        │
│  Owns:                                                                 │
│    Session lifecycle (Claude Code / Codex / pi agents)                  │
│    Beads (Dolt-backed durable work units)                              │
│    Formula execution (pipeline stages: SEED → CONTRACT → MAP →          │
│      PATCH → VERIFY → RELEASE)                                          │
│    Fidelity Validation: VERIFY stage is the fidelity-verification-     │
│      function — it runs tests, checks patch, produces verdict          │
│    Convergence loop: iterates until VERIFY passes or depth exceeded     │
│    Event Bus: emits molecule.completed{verdict, artifacts}              │
│    Health Patrol: stall detection, crash recovery signals               │
│    GUPP: durable work — crash recovery                                  │
│                                                                        │
│  Sends to Factory:                                                      │
│    POST /webhooks/gascity (events: molecule.completed, health.stall,    │
│      session.crash, convergence.evaluate)                               │
└────────────────────────────────────────────────────────────────────────┘
```

### 1.1 What changed from the original Architect draft

The original draft proposed a Factory HTTP endpoint (`POST /verify/coherence/{es-id}`) that Gas City's convergence gate would call during execution. This was wrong.

From SE Ontology §7: fidelity-verification belongs to the execution layer. The VERIFY stage in the coding pipeline IS the fidelity-verification-function. Gas City runs it internally. The convergence gate checks Gas City-internal verdict artifacts — it does not call Factory.

**Removed:** IP-3 (Factory validation endpoint during convergence).
**Revised:** Factory's Coherence VR is a pre-dispatch check on the specification, not a runtime gate.
**Revised:** The convergence gate is entirely Gas City-internal.

### 1.2 What this is NOT

- **Not a microservices split.** A substrate split. Factory produces specs and receives verdicts; Gas City executes and validates.
- **Not bi-directional state replication.** Gas City never writes ArangoDB. Factory never writes Dolt. One-way event flow only.
- **Not "Gas City does the hard parts."** Gas City does the operational parts. If the spec is wrong, Gas City will execute wrong work very reliably and say so.

---

## 2. Five Integration Points

(The original six collapse to five. IP-3 — Factory validation endpoint — is removed. Factory Coherence VR is pre-dispatch, not a runtime gate.)

### IP-1 — ES → Formula Compiler (Factory → Gas City)

**What it is:** A new deterministic compiler transformation — **Trellis Execution Packet → Gas City Formula TOML** — converting the existing compiler's output into the TOML schema Gas City's `gc formula cook` expects. Pure: no LLM, no I/O, no judgment. Preceded by **Coherence Verification (CV)**: Factory verifies the Trellis Execution Packet is internally coherent before compiling to Formula. A specification that fails Coherence Verification is not dispatched.

**Mapping rules (canonical):**

| ES / TEP field | Formula TOML field |
|---|---|
| `ES.id` | `[vars] es_id = "ES-XXX"` |
| `ES.functionId` | `[vars] fn_id = "FN-XXX"` |
| `ES.specId` | `[vars] is_id = "IS-XXX"` |
| `ES.steps[]` | `[[steps]]` blocks |
| `ES.inputs[]` | `[vars]` entries |
| Domain adapter binding | `[vars] domain = "coding"` |

**The Formula compiler also emits** (not just the TOML):
- `prompts/convergence/evaluate.md` — required by Gas City converge subsystem; contains `bd meta set` and `convergence.agent_verdict` substrings (Phase 0 obs #2)
- Role prompt stubs referencing `agents/` directory (see IP-1 open question D10)

**Constraints from Phase 0:**
- MUST emit `version = 1` (obs #1 — `convergence = true` in Formula is rejected by Gas City)
- MUST NOT emit `[convergence]` table — convergence parameters are set at dispatch time via Gas City API, not in Formula
- MUST NOT emit `[[agent]]` blocks — Gas City v1.1+ V2 convention auto-discovers agents (obs #3)

**Pre-dispatch Coherence VR.** Before the compiled Formula is dispatched, Factory runs its existing Coherence Verification pipeline on the source ES. This is the `coherence-verification-function` that §7 requires before a specification can govern execution. If Coherence VR fails, dispatch is blocked and an UncertaintyEntry is emitted — not a failed Fidelity VR, because execution hasn't happened yet.

**Open questions:**
- **Q1-A.** Compiler input: TEP-only or ES directly? **Recommendation: TEP-only** (TEP is the canonical runtime boundary per TRELLIS-IMPLEMENTATION-PLAN.md).
- **Q1-B.** FORM-* artifact: persisted `specs/formulas/` or ephemeral? **Recommendation: persisted FORM-*, full lineage.**
- **Q1-C.** Gas City dispatch HTTP endpoint shape — confirm from Gas City source (Q-IP1-C).
- **Q1-D.** Role prompt location: `harnesses/prompts/` in Factory repo, synced to Gas City `agents/` at city-init. **Recommendation: Factory repo canonical.**

**Risk.** Gas City TOML schema drift between pinned versions. Mitigation: pin `GAS_CITY_VERSION`, validate emitted TOML against `gc formula show` before dispatch.

---

### IP-2 — Beads as Lineage Carriers

**What it is:** Every Bead created for Factory work carries Factory artifact IDs as labels. This is the operational ↔ governance bridge — Gas City is operationally authoritative (Dolt/Beads); Factory is governance-authoritative (ArangoDB). Labels are the read-only connection.

**Required labels:**
```
fn-id:FN-XXX
is-id:IS-XXX
es-id:ES-XXX
form-id:FORM-XXX      (the FormulaArtifact dispatched)
factory-attempt:N     (1 for first dispatch, N>1 for amendments)
```

Amendment Beads additionally carry:
```
amendment-of:ES-OLD-ID
```

**OperationalRecord (`OPR-*`).** When Factory receives `molecule.completed` (IP-4), it creates an `OPR-*` artifact in ArangoDB capturing: Bead labels, verdict, duration, token usage. `source_refs: [es-id, form-id, bead-id]`. This is Factory's immutable projection of Gas City's execution reality.

**No `BEAD-*` artifact.** Factory does not claim ownership of Beads. Bead ID lives inside OPR-* as a field.

**Open questions:**
- **Q2-A.** Add `OPR-*` prefix? **Recommendation: yes — operational records are neither verdicts nor lineage edges.**
- **Q2-B.** Amendment Bead: label `amendment-of` + Gas City Bead parent field? **Recommendation: both — label for queryability, parent for Gas City native dependency tracking.** Confirm Gas City supports Bead parent.

---

### IP-3 — Molecule Completion + Verdict (Gas City → Factory)

**What it is:** Gas City executes the Formula, runs the VERIFY stage (fidelity-verification-function), and emits `molecule.completed` with the verdict. Factory receives this event and acts.

**This replaces the original IP-3** (which incorrectly proposed a Factory HTTP endpoint for validation during execution). Per SE Ontology §7, fidelity-verification belongs to the execution layer. The VERIFY stage is the fidelity-verification-function. Factory does not participate during execution.

**Gas City's VERIFY stage (execution-layer):**
- Independently applies the patch to a clean environment
- Runs the test suite
- Produces `artifacts/verifier_report.md` with `Verdict: PASS` or `Verdict: FAIL`
- This is the fidelity verdict

**Convergence gate (Gas City-internal):**
- Gate script reads `verifier_report.md`
- `Verdict: PASS` → exit 0 (molecule complete)
- `Verdict: FAIL` → exit 1 (Gas City iterates, re-runs PATCH stage)
- Gate does NOT call Factory
- Gate operates at rig root, not city root (Phase 0 obs #7)

**Factory's role after molecule.completed:**
- Receives the event with verdict and artifacts (see IP-4)
- PASS: creates OPR-*, updates lineage, may promote function lifecycle
- FAIL (after Gas City exhausted convergence iterations): creates OPR-* (status=failed), triggers Amendment loop (IP-5)

**What Coherence Verification is NOT:** Coherence Verification is not a runtime gate. It is a pre-dispatch check that the specification is internally consistent. It runs before the Formula compiler produces output, not during Gas City execution. Factory does not expose a `/verify/coherence` endpoint for Gas City to call.

**Risk.** Working directory binding: agent writes to city root instead of rig. Mitigation: role prompt includes explicit `cd $RIG_ROOT` (Phase 0 obs #7).

---

### IP-4 — Gas City Event Bus → Factory Signal Collector

**What it is:** New CF Worker endpoint `POST /webhooks/gascity`. Gas City's Event Bus delivers typed events. Factory routes each event to its consequence.

**Event → action mapping:**

| Gas City Event | Payload | Factory Action |
|---|---|---|
| `molecule.completed` (PASS) | verdict, artifacts, bead labels | Create OPR-* (status=pass); update Function lifecycle toward verified |
| `molecule.completed` (FAIL, iterations exhausted) | verdict, failure trace | Create OPR-* (status=failed); trigger Amendment generation (IP-5) |
| `molecule.failed` (Gas City execution error) | error kind | Create OPR-* (status=error); create SIG-* Signal |
| `health.stall` | stall duration, bead labels | Create INC-* Incident |
| `session.crash` | session id, bead labels | Create OPR-* (status=crashed); observation only — GUPP handles restart |
| `convergence.evaluate` | iteration count, stage | Store in drift-memory for learning substrate |

**Critical:** Webhook handler is append-only and side-effect-free with respect to Gas City. Handler writes to ArangoDB only. Never calls back into Gas City.

**Open questions:**
- **Q4-A.** Does Gas City v1.1 publish webhooks natively, or does this require a Gas City contribution? **Gates Phase 3. Must confirm before Phase 3 design.**
- **Q4-B.** Webhook delivery guarantees and retry behavior — Gas City API question.
- **Q4-C.** Amendment trigger: synchronous in webhook handler or async via queue? **Recommendation: async via queue** (Worker time limits).

---

### IP-5 — Full Amendment Loop

**What it is:** When Gas City reports a failed verdict (all convergence iterations exhausted), Factory autonomously produces a new Specification (Amendment) and dispatches it back.

**Flow (per SE Ontology §6.2 Cyclic Structure):**
```
1. Gas City emits molecule.completed{verdict: FAIL, iterations_exhausted: true}
2. Factory creates OPR-* (status=failed); creates SIG-* Signal (divergence observation)
3. Factory's pipeline: SIG → PRS → IS-V2 → ES-V2  (Amendment as successor specification)
4. Coherence Verification on ES-V2 → Formula compiler → FORM-V2
5. Factory dispatches FORM-V2 to Gas City with:
   fn-id:FN-X, es-id:ES-V2, amendment-of:ES-V1, factory-attempt:2
6. Gas City executes ES-V2 → validates → emits molecule.completed
7. Loop until PASS or MaxAmendmentDepth
```

**Per SE Ontology §3.11 (Amendment):** An amendment is a candidate that produces a successor specification if adopted. Adoption is conditional on verification. Here, adoption = Gas City's VERIFY stage passing.

**Amendment as new Function (FN-X-V2):** Each amendment is a new FunctionProposal → new Function with `source_refs: [FN-X-V1, PRS-FAIL-FN-X]`. A Function with two contradictory governing ESs is undefined behavior (one ES, one Function is the invariant).

**Human-escape valves:**
- `MaxAmendmentDepth` (recommend: 3 configurable): halt + create INC-* Incident
- Any Coherence VR failure on the amendment ES: escalate to architect before dispatch

**Open questions:**
- **Q5-A.** Amendment-proposing capability: new compiler Stage, Crystallizer extension, or Gas-City-executed Factory Function? **Recommendation: Gas-City-executed Factory Function.** The Factory dispatches its own amendment-proposal work to Gas City. The system specifies how to amend itself. Recursive self-application — the architectural payoff.
- **Q5-B.** Where is amendment-proposing Function's IS authored? **Phase 4 work, not this roadmap.**

---

### IP-6 — Health Patrol → Factory Incidents → Pressures

**What it is:** Gas City Health Patrol signals translate into Factory INC-* Incidents. Recurring Incidents generate Pressures, entering the normal pipeline.

**New artifact family: `INC-*` Incident** (`specs/incidents/INC-*.yaml`).
Required fields: `id`, `source_refs`, `severity (info|warn|error|critical)`, `kind (stall|crash|recurring-fail|budget-exhausted|other)`, `signalRefs`, `affectedFunctionIds`, `firstObserved`, `lastObserved`, `status (open|investigating|resolved|wontfix)`, `resolution`.

**Pressure escalation rule:** N Incidents (default 3) with same `kind` and overlapping `affectedFunctionIds` within a rolling window (default 7 days) → auto-propose `PRS-OPS-*` Pressure.

**GUPP auto-resolve:** If `session.crash` is followed by successful `molecule.completed` from the same Bead within a window, any resulting INC-* is auto-resolved with `resolution: "GUPP self-healed"`.

---

## 3. Phased Roadmap

### Phase 0 — Gas City single-pass mechanics ✅ DONE (2026-05-19)
Phase 0 PASS is real but **narrow**: validated `gc formula cook` (linear single-pass) only. Convergence loop (`gc converge create`) is **unvalidated** — re-proven in Phase 2.

### Phase 1 — Specification Dispatch + Lineage (M)
**Goal:** Factory compiles ES → Formula (with pre-dispatch Coherence VR), dispatches to Gas City, Bead carries all labels. Round-trip confirmed.

**Implements:** IP-1, IP-2 (label emit; OPR-* not yet — that's Phase 3).

**Prerequisites:** Gas City reachable, GAS_CITY_VERSION pinned, FORM-* schema decision, TEP vs ES decision, Gas City hosting decision.

**Gate:** Compiler determinism test + `gc formula show` passes + Bead labels confirmed via `bd list` + `dispatch_log` row written + idempotency proven + working-directory binding confirmed (rig root, not city root).

**Forces:** D1 (TEP vs ES), D2 (FORM-* persistence), D7 (hosting), D8 (auth), D10 (prompt location).

### Phase 2 — Convergence Loop Validation (M)
**Goal:** Gas City's convergence loop (`gc converge create`) runs the pipeline end-to-end. VERIFY stage validates execution. Convergence gate checks Gas City-internal verdict artifacts. Factory receives molecule.completed event. OPR-* created.

**Implements:** IP-3, IP-4 (molecule.completed only), IP-2 (OPR-*).

**Key gate:** Bad-patch smoke: VERIFY stage produces `Verdict: FAIL` → Gas City iterates → PATCH runs again → VERIFY passes → molecule.completed{verdict:pass} arrives at Factory → OPR-* created. **No Factory endpoint called during execution.**

**Complexity: M.** The hard part is validating the convergence loop shape (which Phase 0 did not prove) and confirming the webhook bridge works.

**Forces:** Gas City webhook capability (Q4-A — must answer before Phase 2 begins), HMAC auth.

### Phase 3 — Full Event Bridge + Incident Lifecycle (M)
**Goal:** All Gas City events received by Factory. INC-* and OPR-* both populated. Full lineage chain queryable. Stalls and crashes handled.

**Implements:** IP-4 (all event types), IP-6 (Incident creation).

**Gate:** End-to-end run; every event type received; ArangoDB shows full `OPR-* → ES-* → IS-* → PRS-* → SIG-*` chain; stall → INC-*; crash + GUPP restart → INC-* auto-resolved; webhook idempotent under replay.

**Forces:** OPR-*/INC-* schema migration, webhook delivery guarantees confirmed.

### Phase 4 — Full Amendment Loop (XL)
**Goal:** Fidelity validation failure (via event) autonomously produces new ES → new Formula → new Bead → new Function. No human unless MaxAmendmentDepth or Coherence VR fails on amendment ES.

**Implements:** IP-5, IP-6 (auto-Pressure-escalation).

**Gate:** Known-detector failure → autonomous new IS-V2/ES-V2/FORM-V2/Bead → Gas City executes → VERIFY passes → molecule.completed{pass} → FN-V1 superseded, FN-V2 monitored. Full lineage from original Pressure queryable. MaxAmendmentDepth exhaustion → INC-*. Zero manual `bd meta set` in audit log.

**Forces:** Amendment-proposing Function spec (D5, D6), lifecycle versioning convention.

### Phase 5 — Operational Pressure Escalation + k8s
**Goal:** Recurring failures generate Pressures. Gas City on k8s.

**Gate:** ≥1 autonomous operational Pressure from Incidents. Factory has multiple verified/monitored/amended Functions. k8s validated against VPS on smoke corpus.

---

## 4. Architecture Decisions Required Before Phase 1

| # | Decision | Options | Recommendation |
|---|----------|---------|----------------|
| D1 | Compiler input | (A) TEP-only; (B) ES directly | **A** |
| D2 | FORM-* lifecycle | (A) Persisted `specs/formulas/`; (B) Inline TEP; (C) Ephemeral | **A** |
| D3 | OPR-* prefix | (A) Add new; (B) Fold into VR-*; (C) Fold into lineage edges | **A** |
| D4 | Coherence VR scope | Pre-dispatch spec check only (not runtime gate) | **Settled by SE Ontology — not a decision** |
| D5 | Amendment identity | (A) New FN-X-V2; (B) Same FN, new ES | **A** |
| D6 | Amendment-proposing capability | (A) New Stage; (B) Crystallizer extension; (C) Gas-City-executed Factory Function | **C** |
| D7 | Gas City hosting Phase 1 | (A) Shared VPS; (B) Per-dev VPS; (C) Per-dev Docker + shared CI VPS | **C** |
| D8 | Webhook auth | (A) HMAC; (B) mTLS; (C) CF Access | **A for P1–4** |
| D9 | MaxAmendmentDepth | (A) 3; (B) 5; (C) Configurable default 3 | **C** |
| D10 | Role prompt location | (A) `harnesses/prompts/` Factory repo; (B) Separate Gas City config repo; (C) Bundled in Formula | **A** |

D4 is no longer a decision — it is settled by the SE Ontology. Coherence VR is pre-dispatch; it is not a runtime gate; no Factory HTTP endpoint is called during Gas City execution.

---

## 5. Risks and Non-Negotiables

### Top Risks

| Risk | Score | Mitigation |
|---|---|---|
| Gas City TOML schema drift between versions | HH | Pin GAS_CITY_VERSION; validate TOML via `gc formula show` before dispatch |
| Webhook delivery not native to Gas City v1.1 | MH | Confirm before Phase 2 design; may require Gas City contribution |
| Lineage label corruption (silent, unrecoverable) | MH | Regex-validate every label at emit; reject dispatch on malformed label |
| Webhook replay → duplicate OPR-*, duplicate Incidents | MH | HMAC + idempotency key + ArangoDB dedupe with TTL |
| Agent at city root not rig root | HM | REQ-F-013; explicit `cd $RIG_ROOT` in prompt templates |
| Amendment loop divergence (never converges) | MM | MaxAmendmentDepth + INC-CONVERGENCE-STUCK; no silent pass |

### Non-Negotiables (from README)

1. **Lineage on every artifact.** Formula, OPR-*, INC-* all carry `source_refs`.
2. **Narrow-pass discipline.** The Formula compiler does one thing: deterministic transformation. No LLM.
3. **ArangoDB ↔ Dolt isolation.** No cross-writes. Factory → ArangoDB. Gas City → Dolt. Hard invariant. CI detector enforces.
4. **Fail-closed.** Coherence VR failure blocks dispatch. MaxAmendmentDepth exhaustion halts loop and creates Incident. No silent pass.
5. **Every amendment Function gets birth Trajectory and birth VR.** FN-V2 is not a continuation of FN-V1.

---

## 6. Phase 0 Observations — Architectural Interpretation

| # | Observation | Class | Response |
|---|---|---|---|
| 1 | Formula TOML rejects `convergence = true`; `version = 1` required | Spec gap | ADR-010 §4.1 amendment; Formula compiler never emits `[convergence]`; convergence set at dispatch time via Gas City API |
| 2 | `prompts/convergence/evaluate.md` required with literal substrings | Gas City convention | Formula compiler emits companion file bundle (TOML + evaluate.md) |
| 3 | V2 pack schema (no `[[agent]]` blocks) | Gas City convention | Factory provisions `agents/` at city-init; no agent blocks in Formula compiler output |
| 4 | Named tmux socket | Operational quirk | Documentation only |
| 5 | `~/.claude/settings.json` validity required | Environment coupling | Disappears at k8s; Phase 1 city runs as service user |
| 6 | `gc session nudge` is system-reminder, not auto-respond | Gas City API quirk | Factory never nudges; all Factory→Gas City signal is via dispatch only |
| 7 | Named session at city root, not rig root | **Correctness issue** | Role prompts include `cd $RIG_ROOT`; gate reads artifacts from rig |
| 8 | Phase 0 used `gc formula cook`, not `gc converge create` | Phase 0 simplification | Phase 2 validates convergence loop; Phase 0 evidence does NOT prove it |

---

## 7. What This Document Does NOT Decide

- Gas City source code modifications (whether Factory contributes back for webhook support)
- Tessera integration timing (Phase 5+ work)
- Cost model and token budgets
- The amendment-proposing Function's IS (Phase 4 work)
- Loom's role when Gas City handles execution (separate architecture question)
