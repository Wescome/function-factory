# Function Factory + Gas City — Architecture Roadmap

**Status:** Architect proposal for Phase 1–N
**Authored by:** Architect Agent, 2026-05-20
**Authority:** ADR-010 (Gas City supersedes NLAH), DECISIONS.md (2026-05-19 entry), Phase 0 RESULTS.md (PASS, 2026-05-19)
**Audience:** Wes (decisions), SE Agent (requirements decomposition), Engineer Agent (implementation), Critic Agent (review)

---

## 0. Reading Frame

The Factory is being built by the Factory. Every architectural choice in this document is itself subject to Factory discipline: every integration point must trace to a Function ID, every invariant must have a detector, every signal must have a Source. Gas City is not "added to" the Factory — Gas City becomes the substrate the Factory's execution Functions run on. The Factory's governance Functions do not move.

The line that must hold: **ArangoDB is governance truth. Dolt/Beads is operational truth. The Factory writes lineage; Gas City writes work state. No bidirectional writes.**

---

## 1. Architecture Overview — The Three-System Picture

### 1.1 The systems

```
┌────────────────────────────────────────────────────────────────────────┐
│  TESSERA — Knowing-State Prosthesis (knowledge graph)                  │
│  (separate repo, not the subject of this ADR)                          │
│                                                                        │
│   What it knows: code structure, symbol resolution, cross-file refs,   │
│   call graphs, ownership, drift. Provides repo-shape semantics.        │
│   Read-only from Factory's perspective during execution.               │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │ (read queries from Factory + Gas City sessions)
                               │
┌──────────────────────────────▼─────────────────────────────────────────┐
│  FACTORY — Governance Layer                                            │
│  Cloudflare Workers + ArangoDB                                         │
│                                                                        │
│  Owns lifecycle:                                                       │
│    Signal → Pressure → Capability → FunctionProposal → Function        │
│         → IS → ES → VR → Lifecycle promotion                           │
│                                                                        │
│  Owns Verification: Coherence, Fidelity, Persistence (fail-closed)     │
│  Owns lineage graph (ArangoDB)                                         │
│  Owns Crystallizer probes (intelligence in probes, not pipeline wiring) │
│  Owns Signal collection (POST /webhooks/gascity)                       │
│  Owns ES → Formula compilation (new pass, deterministic, no LLM)       │
│                                                                        │
│  Surface for Gas City:                                                  │
│   - POST {GAS_CITY}/v0/formulas      (deploys Formula)                  │
│   - POST {GAS_CITY}/v0/converge      (slings work to Bead + agent)     │
│   - GET  {GAS_CITY}/v0/beads?label=… (status polling, optional)         │
│  Endpoints exposed to Gas City:                                         │
│   - POST /verify/coherence/{es-id}    (convergence gate)                │
│   - POST /webhooks/gascity            (Event Bus → Signal Collector)    │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │ HTTP only — no shared storage
┌──────────────────────────────▼─────────────────────────────────────────┐
│  GAS CITY — Execution Layer                                            │
│  VPS (Phase 1–3) → k8s (Phase 4+)                                       │
│                                                                        │
│  Owns Sessions (Claude Code / Codex / pi)                              │
│  Owns Beads (Dolt-backed durable work units)                           │
│  Owns Formulas (TOML execution graphs)                                  │
│  Owns Convergence loops (gate_condition shell-out)                     │
│  Owns Event Bus (typed, append-only)                                    │
│  Owns Health Patrol (stall detection, backoff)                          │
│  Owns GUPP (work on hook always runs — crash recovery)                  │
│                                                                        │
│  Reads from Factory: Formula TOML, gate verdict JSON                    │
│  Writes to Factory: Event Bus webhook deliveries only                   │
└────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Responsibility boundary — the one line

The seam is: **the Factory decides WHAT must happen and WHETHER it happened correctly. Gas City decides WHEN and HOW work runs, who runs it, and what to do when it stalls or crashes.**

If you can describe a concern with the words "what or whether," it belongs in the Factory. If you can describe it with the words "when, how, who, what next," it belongs in Gas City.

| Concern | Owner | Why |
|---|---|---|
| Lineage graph (source_refs chains) | Factory | Governance |
| Crystallizer probes | Factory | The "whether" of coherence |
| ES → Formula compilation | Factory | Deterministic spec compilation |
| Coherence Verification | Factory | The "whether" of structural completeness |
| Fidelity Verification | Factory | The "whether" of executed behavior |
| Persistence Verification | Factory | The "whether" of ongoing assurance |
| Bead creation, scheduling, retry | Gas City | The "how" of work execution |
| Session lifecycle, crash recovery | Gas City | GUPP guarantees this |
| Convergence iteration | Gas City | The "when" of redoing work |
| Health patrol, stall detection | Gas City | Operational telemetry |
| Multi-agent routing | Gas City | The "who" of execution |
| Workspace materialization | Gas City | Adapter-local, not kernel |

### 1.3 What this is NOT

- **Not a microservices split.** It is a substrate split. Factory dispatches work and consumes events.
- **Not bi-directional state replication.** Gas City never writes to ArangoDB. Factory never writes to Dolt. The only flow from Gas City to Factory is the Event Bus webhook.
- **Not "Gas City does the hard parts."** Gas City does the operational parts. If the ES is bad, Gas City will run bad work very reliably.

---

## 2. Six Integration Points — Detailed Design

### IP-1 — ES → Formula Compiler (Factory → Gas City)

**Current state.**
The Factory has a compiler pipeline through Stage 5 (Pass 0–8) producing ES YAML. `harness-dispatcher.ts` dispatches to `pi-container` via Queue + DO. No Formula TOML emitter exists. TEP work landed in TRELLIS-IMPLEMENTATION-PLAN.md phases 1–9.

**Design decision.**
A new deterministic compiler pass — **Pass 9: `compile_executable_specification_to_formula`** — transforms an ES (or TEP) into a Gas City Formula TOML. Pure: no LLM, no I/O, no judgment. Output: a `FormulaArtifact` (TOML string + canonical hash + lineage refs).

Mapping rules (canonical):

| ES / TEP field | Formula TOML field |
|---|---|
| `ES.id` or `TEP.id` | `formula = "fn-<id>-<short-hash>"` |
| `ES.functionId` | `[vars] fn_id = "FN-XXX"` |
| `ES.specId` | `[vars] is_id = "IS-XXX"` |
| `ES.id` | `[vars] es_id = "ES-XXX"` |
| `ES.steps[]` | `[[steps]]` blocks with `id`, `title`, `description`, `needs` |
| `ES.gates[]` (terminal) | `convergence.gate_condition` invocation |
| `ES.inputs[]` | `[vars]` (one entry per required input) |
| Domain Adapter binding | `[vars] domain = "coding"` |

**Key constraints from Phase 0:**
- MUST emit `version = 1` at top of TOML (obs #1).
- MUST NOT emit `convergence = true` or `[convergence]` table. Convergence parameters are CLI-level, not Formula-level (obs #1).
- MUST emit companion `prompts/convergence/evaluate.md` per Formula containing literal substrings `bd meta set` and `convergence.agent_verdict` (obs #2).
- MUST NOT emit `[[agent]]` blocks. V2 convention: agents auto-discovered from `agents/<name>/agent.toml` (obs #3).

**Open questions:**
- **Q-IP1-A.** Compiler input: TEP-only or ES directly? **Recommendation: TEP-only.**
- **Q-IP1-B.** Where does FORM-* artifact get persisted? **Recommendation: `specs/formulas/`, first-class artifact.**
- **Q-IP1-C.** Which Gas City HTTP endpoint for dispatch? (API gap — confirm from Gas City source.)
- **Q-IP1-D.** Where do role prompts live? **Recommendation: `harnesses/prompts/` in Factory repo, synced to Gas City `agents/` at city-init.**

---

### IP-2 — Beads as Lineage Carriers

**Current state.**
Gas City creates Beads on `gc sling`. No Factory labels in Phase 0. No `Bead-*` artifact type in Factory.

**Design decision.**
Every Bead for Factory work carries:
```
fn-id:FN-XXX
is-id:IS-XXX
es-id:ES-XXX
tep-id:TEP-XXX
form-id:FORM-XXX
factory-attempt:N
```

A new **`OPR-*` OperationalRecord** artifact is created in ArangoDB when `molecule.completed` arrives, capturing: Bead labels, outcome, duration, token usage. `source_refs: [Bead-id, ES-XXX, FORM-XXX]`. This is the Factory's projection of Gas City's reality — written at event time, never read back into Gas City.

**No `BEAD-*` artifact.** The Bead is Gas City-owned. Bead ID lives inside the OperationalRecord.

**Open questions:**
- **Q-IP2-A.** Introduce `OPR-*` prefix? **Recommendation: yes.**
- **Q-IP2-B.** Amendment Bead: label `amendment-of:ES-OLD-ID` + Gas City Bead parent field? **Recommendation: both.** Confirm Gas City supports Bead parent references.

---

### IP-3 — Convergence Gate → Factory Verification API

**Current state.**
Phase 0 gate was Factory-free — artifact existence checks only. No `/verify/coherence` endpoint exists.

**Design decision.**
New CF Worker route: `POST /verify/coherence/{es-id}`. Receives artifact bundle from Gas City's gate script. Runs Crystallizer probes. Persists VR. Returns verdict.

Gate script mapping:
```
pass / warn  → exit 0
fail         → exit 1
escalate     → bd meta set convergence.agent_verdict manual; exit 0
```

**Endpoint contract (proposed):**
```
POST /verify/coherence/{es-id}
Body: { beadId, attempt, artifacts: { filename: contents, … } }
Response: { verdict, verificationReportId, details, amendmentHint }
```

The `amendmentHint` is what the Coder reads on the next convergence iteration.

**Critical architectural insight from Phase 0:** The Factory has Coherence Verification of *specifications* but NOT verification of *in-flight molecule artifacts*. A new probe class — **Artifact Coherence Verification** — checks cross-artifact consistency (does the patch modify the files named in repo_map? Does verifier_report cite tests named in issue_contract?). This is a real Factory deliverable, not glue.

**Open questions:**
- **Q-IP3-A.** Coherence Verification scope: reuse existing (verifies ES structure) or new Artifact Coherence probes? **Recommendation: new probe class. Most important architectural decision in the roadmap.**
- **Q-IP3-B.** Auth model. **Recommendation: HMAC with per-city signing key.**
- **Q-IP3-C.** Idempotency keyed on `{es-id, beadId, attempt}`. **Recommendation: yes.**

---

### IP-4 — Gas City Event Bus → Factory Signal Collector

**Current state.**
No `/webhooks/gascity` endpoint. Factory Signal ingestion is file-based (`specs/signals/SIG-*.yaml`).

**Design decision.**
New CF Worker endpoint: `POST /webhooks/gascity`.

Event → action mapping:

| Gas City Event | Factory Action |
|---|---|
| `molecule.completed` | Create OPR-*; trigger Fidelity VR (async via queue) |
| `molecule.failed` | Create OPR-* (status=fail); create SIG-OPS-* Signal |
| `health.stall` | Create INC-* Incident |
| `session.crash` | Create OPR-* (status=crashed); resilience observation only; GUPP handles restart |
| `convergence.evaluate` | Store probe verdict for drift-memory |
| `bead.created` (amendment) | Round-trip confirmation; no action |

**Critical commitment:** Webhook handler is append-only and side-effect-free with respect to Gas City. Handler NEVER calls back into Gas City.

**Webhook contract (proposed):**
```
POST /webhooks/gascity
Headers: X-GasCity-Signature, X-GasCity-Event-Id, X-GasCity-City
Body: { event, timestamp, beadId, labels, payload }
Response: 204 (success) | 4xx (validation) | 5xx (Factory failure)
```

**Open questions:**
- **Q-IP4-A.** Does Gas City v1.1 publish webhooks, or does this require a Gas City code contribution? **This gates Phase 3. Must confirm before Phase 3 design begins.**
- **Q-IP4-B.** Webhook delivery guarantees and retry behavior — Gas City API question.
- **Q-IP4-C.** Fidelity Verification trigger: sync in handler vs async via queue? **Recommendation: async via existing `fidelity-verification-queue`.**
- **Q-IP4-D.** Operational signals: new `SIG-OPS-*` subtype vs normal `SIG-*` with `source: "gascity"`? **Recommendation: normal SIG-* with source field.**

---

### IP-5 — Full Amendment Loop

**Current state.**
No autonomous amendment loop. Operator decides next steps on pipeline failure.

**Design decision.**
Flow:
```
1. FN-X in state `monitored`
2. Persistence VR fails → new Pressure PRS-FAIL-FN-X
3. Pipeline Stages 1–5 → new IS-FN-X-V2, new ES-FN-X-V2
4. Pass 9 → FORM-FN-X-V2
5. Factory POSTs to Gas City with labels: fn-id:FN-X, es-id:ES-FN-X-V2,
   amendment-of:ES-FN-X-V1, factory-attempt:2
6. Gas City creates Bead; GUPP runs it
7. Convergence loop runs (IP-3)
8. On gate pass: Fidelity VR triggered (IP-4)
9. On Fidelity pass: FN-X-V1 → superseded; FN-X-V2 → monitored
```

Human-escape valves:
- `escalate` verdict: human resolves before loop proceeds
- `MaxAmendmentDepth` (recommend: 3): halt + create INC-* Incident

**Open questions:**
- **Q-IP5-A.** Budget exhaustion hand-off: **Recommendation: INC-* Incident + SIG-*, SE reviews next session.**
- **Q-IP5-B.** Amendment as new FN-X-V2 vs amended ES on same FN? **Recommendation: new FN-X-V2. Lineage requires it.**
- **Q-IP5-C.** Amendment-proposing capability: new Stage, Crystallizer extension, or Gas-City-executed Factory Function? **Recommendation: Gas-City-executed Factory Function. The Factory dispatches its own amendment work to Gas City. Recursive self-application.**

---

### IP-6 — Health Patrol → Factory Incidents → Pressures

**Current state.**
No `INC-*` artifact schema. No `specs/incidents/` directory.

**Design decision.**

**New artifact family: `INC-*` Incident.**
Location: `specs/incidents/INC-*.yaml`.
Required fields: `id`, `source_refs`, `severity (info|warn|error|critical)`, `kind (stall|crash|recurring-fail|budget-exhausted|other)`, `signalRefs`, `affectedFunctionIds`, `firstObserved`, `lastObserved`, `status (open|investigating|resolved|wontfix)`, `resolution`.

**Pressure escalation rule.**
When N Incidents (recommend N=3) share the same `kind` and `affectedFunctionIds` overlap within a rolling window (recommend 7 days), Factory auto-proposes Pressure PRS-OPS-* with `source_refs` to contributing Incidents. Enters normal pipeline.

**Open questions:**
- **Q-IP6-A.** Severity classification: **Recommendation: `health.stall` → warn, `session.crash` → info (GUPP heals), `molecule.failed` → error.**
- **Q-IP6-B.** Auto-resolve GUPP-healed Incidents? **Recommendation: yes — `status: resolved, resolution: "GUPP self-healed"`.**
- **Q-IP6-C.** Pressure escalation gated vs autonomous? **Recommendation: autonomous for stall/recurring-fail; gated for critical/budget-exhausted.**

---

## 3. Phased Roadmap

### Phase 1 — ES → Formula Dispatch (M)
**Goal:** Factory deterministically compiles ES/TEP → Formula, dispatches to Gas City, Bead carries all six labels.
**Implements:** IP-1, IP-2 (label emit only).
**Gate:** Compiler test (deterministic) + `gc formula show` passes + Bead labels verified via `bd list` + `dispatch_log` row written + idempotency proven.
**Forces:** Gas City hosting decision (D7), HMAC key management (D8 partial), FORM-* storage (D2).

### Phase 2 — Convergence Gate (L+design)
**Goal:** Gas City's convergence loop calls `/verify/coherence/{es-id}`; Factory verdict drives iteration.
**Implements:** IP-3, IP-1 amendment (gate script + evaluate.md emitted by Pass 9).
**Gate:** Bad-patch smoke: gate returns `fail` → Gas City iterates → second iteration passes → gate returns `pass`. New Crystallizer probe class reviewed.
**Forces:** New Artifact Coherence probe vocabulary, gate latency budget.

### Phase 3 — Event Bus Observability (M)
**Goal:** All Gas City events received by Factory. `OPR-*` and `INC-*` durable in ArangoDB.
**Implements:** IP-4, IP-2 (complete), IP-6 (Incident creation only).
**Gate:** End-to-end run; every event arrives as webhook; ArangoDB has full `OPR-* → ES-* → IS-* → PRS-* → SIG-*` chain; stall → INC-*; crash → OPR-* (crashed) + OPR-* (GUPP restart); webhook idempotent under replay.
**Forces:** Gas City webhook capability confirmation (Q-IP4-A), OPR-*/INC-* schema migration.

### Phase 4 — Full Amendment Loop (XL)
**Goal:** Fidelity VR failure autonomously produces new ES, Formula, Bead, amended Function. No human unless escalate or MaxAmendmentDepth.
**Implements:** IP-5, IP-6 (auto-Pressure-escalation).
**Gate:** Known-detector failure → autonomous new IS/ES/FORM/Bead → Fidelity VR pass → FN-X-V1 superseded, FN-X-V2 monitored. Full lineage chain queryable. MaxAmendmentDepth hit → INC-* created. No manual `bd meta set` in audit log.
**Forces:** Amendment-proposing Function spec, lifecycle versioning convention.

### Phase 5 — Operational Pressure Escalation + k8s (L+ops)
**Goal:** Recurring operational failures generate Pressures autonomously. Gas City on k8s.
**Gate:** ≥1 autonomous operational Pressure generated from Incidents. Factory has multiple verified, multiple monitored, ≥1 amended-V2 Functions. k8s deployment validated against VPS behavior on smoke corpus.

---

## 4. Architecture Decisions Required Before Phase 1

| # | Decision | Options | Recommendation |
|---|----------|---------|----------------|
| D1 | Compiler input | (A) TEP-only; (B) ES directly | **A — TEP-only** |
| D2 | FORM-* lifecycle | (A) Persisted `specs/formulas/`; (B) Inline TEP; (C) Ephemeral | **A — persisted** |
| D3 | OPR-* prefix | (A) Add; (B) Fold into VR-*; (C) Fold into lineage edges | **A — add** |
| D4 | Coherence gate scope | (A) Reuse existing CoherenceVR; (B) New Artifact Coherence probes | **B — new probe class** |
| D5 | Amendment identity | (A) New FN-X-V2; (B) Same FN, new ES | **A — new FN-X-V2** |
| D6 | Amendment-proposing capability | (A) New Stage; (B) Crystallizer extension; (C) Gas-City-executed Factory Function | **C — recursive self-application** |
| D7 | Gas City hosting Phase 1 | (A) Shared VPS; (B) Per-dev VPS; (C) Per-dev Docker + shared CI VPS | **C** |
| D8 | Webhook auth | (A) HMAC; (B) mTLS; (C) CF Access | **A for P1–4, B/C for P5** |
| D9 | MaxAmendmentDepth | (A) 3; (B) 5; (C) Configurable default 3 | **C — configurable 3** |
| D10 | Role prompt location | (A) `harnesses/prompts/` Factory repo; (B) Separate Gas City config repo; (C) Bundled in Formula | **A — Factory repo** |

---

## 5. Risks and Non-Negotiables

### Top Five Architectural Risks

| Risk | Description | Mitigation |
|---|---|---|
| R1 | Seam crystallizes wrong — Gas City writes ArangoDB or Factory manages Beads | "The one line" is a non-negotiable invariant; every PR review checks both directions |
| R2 | Gas City API surface gaps discovered mid-phase | Pre-flight smoke before each phase begins |
| R3 | Runaway amendment loops in Phase 4 | MaxAmendmentDepth + budget alarms + kill switch |
| R4 | Operational signal noise in Phase 3 drowns real signal | Default severity `info`; dedup by fingerprint; auto-resolve GUPP-healed |
| R5 | Convergence gate becomes Factory bottleneck | Hard timeout independent of `gate_timeout`; gate failures fall back to `escalate`, never silent retry |

### Non-Negotiables (from README §6)

1. **Lineage on every artifact.** Formula carries source_refs. Bead carries labels. OPR-* carries `source_refs`. No exceptions.
2. **Narrow-pass discipline.** Pass 9 does one thing: deterministic transformation. No LLM.
3. **Explicit invariants with detectors.** "Factory never writes to Dolt" = CI check for `dolt://` or `bd ` in ff-pipeline source.
4. **Assurance dependency typing.** "Gas City operational and producing events" is an explicit assurance dependency on every Gas-City-executed Function.
5. **Trajectory-driven closure with birth Verification.** Every amendment FN-X-V2 gets its own birth Trajectory and birth Verification.
6. **Fail-closed Verification.** Gate default on Factory unavailability: `exit 1`. Never silent-pass.

---

## 6. Phase 0 Observations — Architectural Interpretation

| # | Observation | Class | Required Response |
|---|---|---|---|
| 1 | Formula TOML rejects `convergence = true` | Spec gap | ADR-010 §4.1 amendment; Pass 9 never emits `[convergence]` |
| 2 | `prompts/convergence/evaluate.md` required with literal substrings | Mandatory convention | Pass 9 emits companion file bundle, not just TOML |
| 3 | V2 pack schema (no `[[agent]]` blocks) | Gas City convention | Factory provisions `agents/` at city-init; no agent blocks in Pass 9 output |
| 4 | Named tmux socket `tmux -L phase0-city` | Operational quirk | Documentation only; Factory never touches tmux |
| 5 | `~/.claude/settings.json` JSON validity blocks sessions | Environment coupling | Phase 1 city runs as service user with controlled settings; disappears at k8s |
| 6 | `gc session nudge` is system-reminder, not auto-respond | Gas City API quirk | Factory never issues nudges; gate exit codes are the only Factory→Gas City signal |
| 7 | Named session at city root, not rig root | Working-directory semantics | Role prompts include explicit `cd $RIG_ROOT`; prompt templates enforce |
| 8 | Phase 0 used `gc formula cook`, not `gc converge create` | Phase 0 simplification | Phase 1 validates convergence-creation API; Phase 0 evidence does NOT prove convergence loop |

---

## 7. What This Document Does NOT Decide

- Gas City source code modifications (whether Factory contributes back).
- Tessera integration timing (Phase 5+ work).
- Cost model and token budgets.
- The amendment-proposing Function's IS (Phase 4 work).
- Whether Coordinator ever consumes FORM-* directly (Phase 5 question).

---

## 8. Handoff Notes

**To the SE Agent.** This is a roadmap, not a spec. Decompose each phase into Capabilities and FunctionProposals. Each phase's gate condition is the Verification target. Open questions become UncertaintyEntries until decided.

**To Wes.** Section 4's ten decisions block Phase 1. Section 6 needs sign-off on which observations require spec changes vs codified-as-is.

**To the Engineer Agent.** Do not start coding from this. Wait for SE-decomposed Capabilities and a FunctionProposal from Wes.

**To the Critic Agent.** This document has been written by an Architect, not reviewed. Review pass needed before this becomes binding.
