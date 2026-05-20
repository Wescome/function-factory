# SE Decomposition: Gas City + Factory Integration Roadmap

**Author:** Systems Engineer Agent
**Date:** 2026-05-20
**Lineage:** ADR-010, PHASE0-GAS-CITY-VALIDATION.md, RESULTS.md (Phase 0 PASS), FF-CODING-ARCHITECTURE.md, DECISIONS.md
**Purpose:** Provide SE methodology output (requirements, decomposition, risks, gates) for Wes to review alongside the Architect's design before Phase 1 commit.

---

## 0. Scope, Boundaries, and Methodological Stance

This document treats the **Factory + Gas City integrated system** as a system-of-systems with two cooperating but separately-owned subsystems. ADR-010 is the governing architectural commitment; this decomposition operationalizes it without re-litigating it.

**System boundary definition:**
- **Inside the system:** the six integration points named in ADR-010 §4, the Factory governance pipeline (Signal → Pressure → IS → ES → VR → FN), the Gas City execution layer (Sessions, Beads, Formulas, Convergence, Event Bus, Health Patrol), and the network path connecting them.
- **Outside the system:** the LLM provider (ofox.ai / OpenRouter / Workers AI), GitHub, Cloudflare platform internals, Dolt internals, the VPS / k8s host provider.
- **Authority boundary:** Factory is the sole writer to ArangoDB (governance truth). Gas City is the sole writer to Dolt/Beads (operational truth). No bidirectional writes across the boundary.

**Phase 0 status acknowledged:** RESULTS.md documents PASS. The eight "behaviors observed" are treated as **empirical evidence** that modifies requirements — not as bugs to be argued away.

---

## 1. Functional Decomposition

### FA-1: Specification Compilation (ES → Formula)
| Field | Value |
|---|---|
| **Function** | Deterministically translate an ExecutableSpecification into a Gas City Formula TOML, embedding lineage variables and convergence gate reference |
| **Inputs** | ES artifact (YAML); ES-ID, IS-ID, FN-ID; gate script path |
| **Outputs** | Formula TOML; dispatch_envelope (required_vars + lineage labels) |
| **Owner** | Factory (boundary-owned producer) |
| **Status** | **Missing** — no ES→Formula compiler in `workers/ff-pipeline/src/` |

### FA-2: Formula Dispatch (Factory → Gas City API)
| Field | Value |
|---|---|
| **Function** | POST compiled Formula TOML and lineage envelope to Gas City HTTP endpoint; create root Bead with lineage labels; receive dispatch acknowledgement |
| **Inputs** | Formula TOML; lineage labels (fn-id, is-id, es-id, plus amendment-of when applicable); Gas City base URL + auth credential |
| **Outputs** | Gas City bead_id; HTTP 2xx confirmation; dispatch record in ArangoDB dispatch_log |
| **Owner** | Factory (boundary-owned producer) |
| **Status** | **Missing** — no Gas City HTTP client; network path Worker→VPS not configured |

### FA-3: Beads-as-Lineage (Operational Truth ↔ Governance Truth)
| Field | Value |
|---|---|
| **Function** | Maintain mapping between Gas City Beads (operational) and Factory artifacts (governance); allow Factory to query Bead state by ID |
| **Inputs** | bead_id (Gas City); fn-id / is-id / es-id (Factory) |
| **Outputs** | Bead status query response; Factory dispatch_log rows linking artifact IDs ↔ Bead IDs |
| **Owner** | Boundary (Factory queries, Gas City stores) |
| **Status** | **Missing** — no Bead query client in Factory; RESULTS.md item 7 shows label-to-working-directory binding not enforced |

### FA-4: Convergence Coherence Gate (Gas City script → Factory endpoint)
| Field | Value |
|---|---|
| **Function** | At each Gas City convergence iteration, gate script calls POST /verify/coherence/{es-id} with artifact bundle; Crystallizer probes evaluate; verdict returned |
| **Inputs** | es-id; current molecule artifact bundle; Factory base URL + auth |
| **Outputs** | { verdict: pass\|warn\|fail\|escalate }; gate script exit 0/1; bd meta set convergence.agent_verdict |
| **Owner** | Boundary (script in Gas City, endpoint in Factory) |
| **Status** | **Missing** — no /verify/coherence endpoint; Crystallizer probes not exposed via HTTP |

### FA-5: Event Bus Bridge (Gas City → Factory)
| Field | Value |
|---|---|
| **Function** | Receive typed events from Gas City Event Bus at POST /webhooks/gascity; route each event type to its Factory consequence |
| **Inputs** | Webhook POST body (typed Gas City event); HMAC signature header; replay-protection nonce |
| **Outputs** | Internal Factory triggers (Fidelity VR job; Incident artifact; observation row); HTTP 2xx ack with idempotency key |
| **Owner** | Factory (boundary-owned consumer) |
| **Status** | **Missing** — no /webhooks/gascity endpoint; event signature/auth not specified |

### FA-6: Amendment Loop Closure (VR fail → new ES → new Bead)
| Field | Value |
|---|---|
| **Function** | When Fidelity VR fails, Factory compiler emits new ES; ES compiled to Formula; new Bead created with label amendment-of:ES-OLD-ID; Gas City GUPP picks up work without human intervention |
| **Inputs** | Failed VerificationReport (Fidelity); original ES; failure diagnosis |
| **Outputs** | New ES artifact; new Formula; new Bead in Gas City with amendment lineage; lineage_edge amendment_of in ArangoDB |
| **Owner** | Factory (loop closure logic), Gas City (durable execution) |
| **Status** | **Missing** — compiler→re-dispatch chain unimplemented; amendment-of label is new vocabulary |

### FA-7: Health Patrol → Incident → Pressure
| Field | Value |
|---|---|
| **Function** | Translate Gas City Health Patrol signals into Factory INC-* Incidents; aggregate systemic patterns into new Pressures via SE diagnosis layer |
| **Inputs** | health.stall events; convergence iteration counts; session restart counts |
| **Outputs** | INC-* artifacts; PRS-* artifacts when patterns recur |
| **Owner** | Factory (Incident model, SE diagnosis), Gas City (signal source) |
| **Status** | **Partial** — Incident artifact family planned but no schema exists; SE diagnosis automation not built |

### FA-8: Cross-Boundary Observability & Trust
| Field | Value |
|---|---|
| **Function** | Provide unified read view across both subsystems: Bead ↔ ES mapping, convergence iteration history, gate verdicts, latency |
| **Inputs** | ArangoDB dispatch_log, verification_status, lineage_edges; Gas City bd list, Event Bus history |
| **Outputs** | Composite query API GET /trace/fn/{fn-id} returning full Bead+VR+event timeline |
| **Owner** | Factory (read aggregator) |
| **Status** | **Missing** — no cross-boundary trace endpoint |

---

## 2. Requirements Register

Requirements are written in shall-language. Each is independently testable. Priority: **C** = critical (gate-blocking), **H** = high (required for phase completion), **M** = medium (required before production).

### Functional Requirements

| REQ-ID | Type | Statement | Source | Pri | Phase |
|---|---|---|---|---|---|
| REQ-F-001 | Functional | The ES→Formula compiler **shall** be deterministic: identical ES input produces byte-identical Formula output | ADR-010 §4.1 | C | 1 |
| REQ-F-002 | Functional | The ES→Formula compiler **shall** produce no LLM calls | ADR-010 §3 (ZFC) | C | 1 |
| REQ-F-003 | Functional | Every Formula emitted **shall** include var.es_id, var.is_id, and var.fn_id populated from the source ES | ADR-010 §4.1 | C | 1 |
| REQ-F-004 | Functional | Every Bead created from a Factory Formula **shall** carry labels fn-id:FN-XXX, is-id:IS-XXX, es-id:ES-XXX | ADR-010 §4.2 | C | 1 |
| REQ-F-005 | Functional | Amendment Beads **shall** additionally carry the label amendment-of:ES-OLD-ID | ADR-010 §4.5 | H | 4 |
| REQ-F-006 | Functional | The Factory **shall** expose POST /verify/coherence/{es-id} returning { verdict: pass\|warn\|fail\|escalate } | ADR-010 §4.3 | C | 2 |
| REQ-F-007 | Functional | The coherence gate script in Gas City **shall** map verdicts to gate exit codes: pass/warn → 0; fail → 1; escalate → bd meta set convergence.agent_verdict manual + exit 0 | ADR-010 §4.3 | C | 2 |
| REQ-F-008 | Functional | The Factory **shall** expose POST /webhooks/gascity accepting: molecule.completed, health.stall, session.crash, convergence.evaluate | ADR-010 §4.4 | C | 3 |
| REQ-F-009 | Functional | The webhook receiver **shall** trigger Fidelity Verification on every molecule.completed event whose Bead carries an es-id label | ADR-010 §4.4 | C | 3 |
| REQ-F-010 | Functional | The webhook receiver **shall** create an INC-* Incident artifact on every health.stall event whose Bead carries an fn-id label | ADR-010 §4.4, §4.6 | H | 3 |
| REQ-F-011 | Functional | The webhook receiver **shall** record session.crash events as resilience observations and **shall not** itself trigger recovery action | ADR-010 §4.4 (GUPP) | H | 3 |
| REQ-F-012 | Functional | On Fidelity VR fail, the Factory **shall** recompile the ES, POST a new Formula, and create an amendment Bead — without human intervention | ADR-010 §4.5 | C | 4 |
| REQ-F-013 | Functional | The convergence gate script **shall** execute against the rig directory (the working repository), not the city root | RESULTS.md obs #7 | C | 1 |
| REQ-F-014 | Functional | Every Formula **shall** include a prompts/convergence/evaluate.md containing the literal substrings `bd meta set` and `convergence.agent_verdict` | RESULTS.md obs #2 | C | 2 |
| REQ-F-015 | Functional | Pack/agent configuration files emitted to Gas City **shall** use Gas City v1.1.0 V2 schema conventions (no [[agent]] blocks in pack.toml) | RESULTS.md obs #3 | H | 1 |

### Non-Functional Requirements

| REQ-ID | Type | Statement | Source | Pri | Phase |
|---|---|---|---|---|---|
| REQ-NF-001 | Performance | The ES→Formula compile pass **shall** complete in ≤ 500 ms for any ES ≤ 1 MB | Worker step budget | H | 1 |
| REQ-NF-002 | Performance | POST /verify/coherence/{es-id} **shall** return a verdict within ≤ 60 s P99 | ADR-010 §4.3 | H | 2 |
| REQ-NF-003 | Reliability | The Factory webhook receiver **shall** be idempotent: a replayed event with the same idempotency key **shall** produce zero duplicate Fidelity VR triggers and zero duplicate Incidents | ADR-010 §4.4 | C | 3 |
| REQ-NF-004 | Security | Gas City → Factory webhooks **shall** be authenticated via HMAC signature using a shared secret distinct from the Factory→Gas City API key | New (gap from ADR-010) | C | 3 |
| REQ-NF-005 | Security | Factory → Gas City API calls **shall** carry an authentication token bound to a single environment | New (gap from ADR-010) | C | 1 |
| REQ-NF-006 | Auditability | Every dispatch **shall** persist a row to dispatch_log with: timestamp, ES-ID, Formula hash, Bead ID returned, HTTP response code | Factory lineage principle | H | 1 |
| REQ-NF-007 | Auditability | Every coherence verdict issued **shall** be persisted to verification_status with full Crystallizer probe trace | ADR-010 §4.3 | C | 2 |
| REQ-NF-008 | Resilience | The Factory **shall** continue to operate (read-only on dispatched work) if Gas City is unreachable; queued dispatches **shall** retry with exponential backoff | New | H | 1 |
| REQ-NF-009 | Resilience | The Factory **shall not** create a duplicate Bead when retrying a dispatch; dispatch is keyed on ES-ID + ES-version-hash | NDI principle | C | 1 |
| REQ-NF-010 | Observability | GET /trace/fn/{fn-id} **shall** return the full timeline of: ES versions, Formula dispatches, Bead lifecycle events, gate verdicts, and Fidelity VR outcomes | New | M | 3 |
| REQ-NF-011 | Constraint | No Factory write **shall** be issued to Dolt/Beads from outside Gas City's HTTP API | ADR-010 §4.2 | C | 1 |
| REQ-NF-012 | Constraint | No Gas City write **shall** be issued to ArangoDB from outside the Factory's CF Worker endpoints | ADR-010 §4.2 | C | 1 |
| REQ-NF-013 | Interface | The Factory→Gas City dispatch contract **shall** be versioned (X-FF-Dispatch-Version: v1); receiver **shall** reject unknown versions with HTTP 426 | New | M | 1 |
| REQ-NF-014 | Interface | The Gas City→Factory webhook contract **shall** be versioned (X-GC-Event-Version: v1) with the same rejection semantics | New | M | 3 |
| REQ-NF-015 | Interface | All lineage labels **shall** match regex `^(fn-id\|is-id\|es-id\|amendment-of):[A-Z]{2,3}-[A-Za-z0-9_-]+$`; non-conforming labels **shall** cause dispatch failure | Factory artifact ID format | H | 1 |
| REQ-NF-016 | Schema | The Factory **shall not** depend on the structural form of any Gas City TOML field; it **shall** only emit the published Formula schema for the pinned Gas City version | RESULTS.md obs #1 | C | 1 |
| REQ-NF-017 | Operability | The pinned Gas City version **shall** be recorded as a Factory build artifact (GAS_CITY_VERSION env var) and any version mismatch detected at dispatch time **shall** abort dispatch | RESULTS.md obs #1 + #3 | H | 1 |
| REQ-NF-018 | Operability | The Factory **shall** detect Gas City convergence loop divergence: more than MaxConvergenceIterations (default 5) without a verdict change **shall** generate an INC-CONVERGENCE-STUCK Incident | ADR-010 §4.6 | M | 4 |
| REQ-NF-019 | Constraint | The convergence gate script **shall** treat Factory endpoint unavailability (network failure, 5xx) as a failure; it **shall not** silently exit 0 | New (avoid silent pass) | C | 2 |
| REQ-NF-020 | Privacy | Webhook payloads **shall not** include raw user prompts or model completions in cleartext; references (R2 keys, Bead IDs) only | Operational hygiene | M | 3 |

**Total: 35 requirements** (15 functional, 20 non-functional). Each is independently testable.

---

## 3. Risk Register

| RISK-ID | Description | L | I | Score | Mitigation | Owner |
|---|---|---|---|---|---|---|
| RISK-001 | Gas City TOML schema evolves between pinned versions; Formula structure breaks (Evidence: RESULTS.md obs #1) | H | H | **HH** | Pin Gas City version in env; schema-validate emitted TOML against pinned schema before dispatch (REQ-NF-016, -017); contract tests re-run when pin moves | Integration |
| RISK-002 | CF Worker→VPS latency exceeds Worker step budget on verify-coherence path, causing Gas City gate timeout | M | H | **MH** | Set Worker subrequest timeout < Gas City gate_timeout; instrument both ends; co-locate VPS region with primary CF colo | Integration |
| RISK-003 | Lineage label corruption: es-id label loses prefix, malforms, or drops silently | M | H | **MH** | Regex validation on every label emit (REQ-NF-015); reject Bead create on malformed label; webhook receiver rejects events lacking required labels | Factory |
| RISK-004 | Convergence loop fails to converge: same Crystallizer probe rejects every patch, Gas City iterates until gate_timeout | M | M | **MM** | Bounded iteration via MaxConvergenceIterations; emit INC-CONVERGENCE-STUCK (REQ-NF-018); SE diagnosis on recurrence | Integration |
| RISK-005 | Amendment loop misroutes: Fidelity VR fail produces new ES targeting wrong Function | L | H | **LH** | amendment_of edge asserts target FN-ID matches source FN-ID; reject on mismatch; integration test for misroute | Factory |
| RISK-006 | Health Patrol false positives: health.stall fires during legitimate long-running step, polluting INC-* family | M | M | **MM** | Incident creation requires stall_duration > 2×p99_step_duration; auto-resolve if molecule.completed arrives within window | Integration |
| RISK-007 | Webhook replay attack or accidental duplicate delivery causes duplicate Fidelity VR runs and duplicate Incidents | M | H | **MH** | HMAC signature (REQ-NF-004); idempotency key (REQ-NF-003); dedupe table in ArangoDB with TTL | Factory |
| RISK-008 | ArangoDB schema evolution for new collections lands without migration; existing queries break | M | M | **MM** | Versioned migration in schemas/ with up/down; pre-deploy schema check in CF Worker startup | Factory |
| RISK-009 | Working directory binding loss: agent writes artifacts to city root instead of rig, gate reads wrong path (Evidence: RESULTS.md obs #7) | H | M | **HM** | REQ-F-013 explicit; agent prompt includes `cd $RIG_ROOT`; gate script asserts $ARTIFACTS under rig | Integration |
| RISK-010 | Coherence gate silent-pass on Factory outage (Phase 0 gate had `|| true` masking 5xx) | M | H | **MH** | REQ-NF-019 explicit; gate must distinguish "Factory said warn" from "Factory unreachable"; chaos test drops Factory, asserts gate does NOT exit 0 | Integration |
| RISK-011 | Cross-boundary auth secret rotation breaks integration silently | M | M | **MM** | Single source of truth (CF secret); Gas City reads from env; rotation runbook; both ends emit auth_version in headers | Integration |
| RISK-012 | Bitter Lesson regression: integration optimization baked in becomes barrier when smarter model would do better | L | M | **LM** | Architect review on every optimization PR; prefer caching at outermost layer; ZFC audit each release | Factory |
| RISK-013 | Phase 0 behaviors not all categorized; one becomes load-bearing assumption without being lifted into requirement | M | H | **MH** | §6 below classifies every observation; SE re-reviews before Phase 1 sign-off | SE |

**Top risks (HH or MH):** RISK-001, -002, -003, -007, -009, -010, -013. These seven dominate Phase 1–3 mitigation effort.

---

## 4. Dependency Graph

| Phase | Depends On |
|---|---|
| P0 — Gas City rig works | — (DONE) |
| P1 — ES→Formula + Beads lineage | P0 |
| P2 — Coherence gate live | P0, P1 |
| P3 — Event Bus webhook live | P0, P1, P2 |
| P4 — Amendment loop | P0, P1, P2, P3 |
| P5 — Production k8s | P4 + 30 days monitored |

### Load-bearing intra-phase dependencies

- **P1:** REQ-F-001..004 + REQ-NF-016..017 + REQ-NF-005. Without compiler determinism and version pinning, every downstream phase is quicksand.
- **P2:** depends on FA-1 (compiler producing gate-script reference) and FA-3 (Bead query for es-id context).
- **P3:** depends on P1's label discipline — webhook routing keys off `es-id`/`fn-id` labels.
- **P4:** the closure of P1+P2+P3. It is also the test of all three.

### External dependencies (load-bearing)

| External | Required by | Phase | Status |
|---|---|---|---|
| VPS with Gas City v1.1.0+ | FA-2, FA-3 | P1 | Not provisioned |
| Network path Worker→VPS | FA-2, FA-5 | P1 | Not configured |
| HMAC secret distributed | REQ-NF-004 | P3 | Not configured |
| GAS_CITY_VERSION in wrangler.toml | REQ-NF-017 | P1 | Not recorded |
| ArangoDB dispatch_log collection | REQ-NF-006 | P1 | Not provisioned |
| amendment_of lineage edge type | REQ-F-005 | P4 | Not defined |
| INC-CONVERGENCE-STUCK Incident kind | REQ-NF-018 | P4 | Not defined |

---

## 5. Gate Conditions Per Phase

### Phase 0 — PASSED (re-verified against SE rubric)

| Gate | Statement | Status |
|---|---|---|
| G-P0.1 | All 7 pipeline artifacts exist in rig | PASS |
| G-P0.2 | verifier_report.md first line = `Verdict: PASS` | PASS |
| G-P0.3 | Gate script exits 0 | PASS |
| G-P0.4 | All 8 RESULTS.md observations classified (req gap / spec gap / runtime deviation) | PASS (this SE pass) |
| G-P0.5 | Architect sign-off on RESULTS.md | **PENDING** |

### Phase 1 — ES→Formula + Beads

| Gate | Statement | Evidence |
|---|---|---|
| G-P1.1 | Compiler is deterministic | Test run twice on same input → byte-identical output; CI `es-to-formula.determinism.test.ts` passes |
| G-P1.2 | Compiler emits no LLM call | Static check: no callProvider/ofox/anthropic import in compiler module |
| G-P1.3 | Every emitted Formula has var.es_id, var.is_id, var.fn_id | Contract test parses TOML on 10 representative ES samples |
| G-P1.4 | Gas City version pinned | GAS_CITY_VERSION env var in wrangler.toml; startup refuses if missing |
| G-P1.5 | Emitted Formula validates against pinned schema | `gc formula show` exits 0 on emitted TOML |
| G-P1.6 | Dispatch creates Bead with all labels | `bd list --label es-id:ES-SMOKE-1` returns ≥1 Bead with all three labels |
| G-P1.7 | Dispatch is idempotent on retry | Same ES dispatched twice → exactly one Bead with matching es-id+version-hash |
| G-P1.8 | dispatch_log row written | ArangoDB query returns row with ES-ID, Formula SHA, Bead ID, HTTP code |
| G-P1.9 | Gas City unreachable → retry, no duplicate | Chaos test: kill GC 30s → exactly one Bead on recovery |
| G-P1.10 | Working-directory binding correct | Agent operates from rig dir; gate reads artifacts from rig dir (closes obs #7) |

### Phase 2 — Convergence Gate

| Gate | Statement | Evidence |
|---|---|---|
| G-P2.1 | POST /verify/coherence/{es-id} returns all four verdicts | Endpoint smoke test; HTTP schema validated |
| G-P2.2 | Gate script maps verdicts correctly | Unit test: pass→0, warn→0, fail→1, escalate→manual+0 |
| G-P2.3 | Bad patch caught; Gas City iterates | Smoke: broken patch → fail → iteration → good patch → pass |
| G-P2.4 | Verdict P99 ≤ 60 s | Load test 100 verdicts |
| G-P2.5 | Factory outage does NOT silent-pass | Chaos test: take down endpoint → gate exits non-zero (closes RISK-010) |
| G-P2.6 | prompts/convergence/evaluate.md exists with required substrings | Static check on emitted file (closes obs #2) |
| G-P2.7 | Every verdict persisted to verification_status | Post-run query returns row per gate eval with full probe trace |

### Phase 3 — Event Bus Webhook

| Gate | Statement | Evidence |
|---|---|---|
| G-P3.1 | POST /webhooks/gascity accepts 4 event types | Contract test with sample payloads |
| G-P3.2 | HMAC required | Negative: unsigned → 401; wrong key → 401; correct → 200 |
| G-P3.3 | Idempotent under replay | Replay same event 5× → exactly one VR job, one Incident |
| G-P3.4 | molecule.completed triggers Fidelity VR | Emit event → verification_jobs queued within 5 s |
| G-P3.5 | health.stall creates INC-* | Emit event → ArangoDB incidents row with correct FN-ID |
| G-P3.6 | session.crash does NOT trigger recovery | Emit → no new VR jobs, no Incidents; only observation row |
| G-P3.7 | End-to-end emit-to-DB ≤ 2 s | Tracing test |
| G-P3.8 | Payloads contain no raw user content | Sample-set inspection; redaction filter test |

### Phase 4 — Full Amendment Loop

| Gate | Statement | Evidence |
|---|---|---|
| G-P4.1 | Fidelity VR fail → new ES emitted automatically | Smoke: inject failure → new ES with derived_from:ES-OLD-ID within 60 s |
| G-P4.2 | New ES → new Formula → new Bead with amendment-of label | Trace the new Bead; label set complete |
| G-P4.3 | Amendment Bead inherits FN-ID and IS-ID | Lineage cross-check assert |
| G-P4.4 | Amendment loop terminates on success or MaxConvergenceIterations | Smoke success path + deliberate never-converges path → INC-CONVERGENCE-STUCK |
| G-P4.5 | No human in loop unless escalate fires | Audit log: zero manual `bd meta set` calls in amendment cycle |
| G-P4.6 | FN lifecycle transitions guarded | Promotion verified→monitored requires Fidelity VR pass; integration test |
| G-P4.7 | Amendment Bead misroute prevented | Negative test: corrupted FN-ID → Bead create rejected (closes RISK-005) |

### Phase 5 — Production

| Gate | Statement | Evidence |
|---|---|---|
| G-P5.1 | k8s Gas City matches VPS behavior | Differential test: 10 ES inputs, both backends, identical artifacts |
| G-P5.2 | ACP session provider routes to CF Containers | Trace: agent session runs in CF Container |
| G-P5.3 | Cost per cycle within budget | Production telemetry 24h P95 |
| G-P5.4 | StateGraph retirement gates satisfied | Five conditions with Architect sign-off |
| G-P5.5 | Rollback rehearsed | Timed rehearsal log; revert to VPS in ≤ 15 min |

---

## 6. SE Findings from Phase 0

| # | Observation | Category | New REQ-ID | Phase 1 Gate Impact |
|---|---|---|---|---|
| 1 | Formula TOML rejected `convergence = true`; format moved to CLI flags; `version = 1` required | **R-gap + S-gap** | REQ-NF-016, REQ-NF-017 | Adds G-P1.4 and G-P1.5; PHASE0 spec needs addendum |
| 2 | `gc converge` requires evaluate.md with literal substrings | **R-gap** | REQ-F-014 | Adds G-P2.6; Phase 1 must scaffold evaluate.md (compiler scope extension) |
| 3 | Gas City v1.1.0 V2 pack schema; [[agent]] blocks conflict | **R-gap** | REQ-F-015 | Phase 1 emitter must target V2 schema explicitly |
| 4 | Gas City uses named tmux socket `tmux -L phase0-city` | **R-dev** | None | Documentation only; no gate change |
| 5 | ~/.claude/settings.json invalid JSON blocks sessions | **R-dev (host)** | None new | Precondition check in pre-dispatch script; not a Factory requirement |
| 6 | `gc session nudge` delivers as system-reminder; no auto-respond | **R-dev** | None | Documentation; Factory does not nudge sessions |
| 7 | Named session ran at city root, not rig root | **R-gap** | REQ-F-013 | Adds G-P1.10 CRITICAL gate; correctness issue |
| 8 | Phase 0 used `gc formula cook` not `gc converge create` | **S-gap** | None new | Phase 2 gate G-P2.3 must test against converge create; Phase 0 evidence does NOT validate convergence path |

**Net effect:** 5 new CRITICAL REQ-IDs (REQ-F-013, REQ-F-014, REQ-F-015, REQ-NF-016, REQ-NF-017). Two new Phase 1 gates (G-P1.4, G-P1.10). One new Phase 2 gate (G-P2.6).

**Phase 0 PASS caveat:** Phase 0 validated single-pass `gc formula cook` shape only. **Convergence loop shape is unvalidated.** Must be re-proven in Phase 2.

---

## 7. Open Questions for Architect

1. **Versioning + pinning strategy.** Policy: (a) pin forever + audit-before-upgrade; (b) compatibility shims; (c) compiler against published JSON Schema. REQ-NF-016/017 assume option (a).

2. **Auth model.** REQ-NF-004/005 assume HMAC + bearer. Is mTLS required for Phase 5 k8s?

3. **`warn` vs `pass` semantics.** Both map to gate exit 0. Does `warn` produce any side effect on Factory side (lower-priority VR scheduling, observation row)?

4. **`escalate` is a human gate. Who is notified?** Is there a Factory-side `escalations` collection? Phase 2 gate vs Phase 3+ feature?

5. **Rig binding mechanism.** Options: (a) agent prompt template `cd $RIG_ROOT`; (b) Gas City named-session config binds working directory; (c) Formula emitter writes per-rig session config. REQ-F-013 is agnostic; Architect must pick.

6. **MaxConvergenceIterations placement.** Gas City config, Factory ES field, or both with lower value winning?

7. **amendment_of edge type.** New edge type in lineage_edges (graph homogeneity) or property on existing edges?

8. **`session.crash` resilience observation storage.** `health_observations` collection, audit-only log, or explicit artifact family?

9. **Drift-memory probe store.** New collection or part of `verification_status`?

10. **CF Containers ACP capability.** Are CF Containers today capable of exposing ACP for Phase 5 session routing? If not, what is the bridge component?

11. **Crystallizer probe coupling to ES.** How does /verify/coherence/{es-id} know which probes apply — probe list in ES, looked up by FN-ID, or both?

12. **Crystallizer failure isolation.** If a probe panics or returns malformed verdict → 5xx. REQ-NF-019 says don't silent-pass. Fail closed (hold molecule), retry, or escalate?

---

## 8. Summary for the Principal

**Bottom line:** 8 functional areas, 35 testable requirements, 13 risks (7 high-impact), 4 phases with 37 explicit gate conditions.

**Phase 0 PASS is real but narrow.** It validated single-pass shape only. Convergence loop is unvalidated — re-proven in Phase 2.

**Five new critical requirements** from Phase 0 must be in scope before Phase 1: REQ-F-013 (rig binding), REQ-F-014 (convergence evaluate prompt), REQ-F-015 (V2 pack schema), REQ-NF-016 (TOML schema validation), REQ-NF-017 (Gas City version pin).

**Twelve open questions** require Architect decisions before requirements are frozen. Top three gate Phase 1 directly: versioning policy, auth model, rig-binding mechanism.

**Recommended go/no-go for Phase 1:** all 12 open questions answered; 5 new critical REQ-IDs accepted; Phase 0 signed off as PASS-with-caveats (convergence shape unverified).
