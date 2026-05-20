# ADR-010: Gas City Replaces NLAH as the Factory Execution Substrate

## Status

Active — 2026-05-19

## Date

2026-05-19

## Lineage

ADR-009 (NLAH Runtime Replaces StateGraph — superseded by this ADR),
ADR-004 (custom graph runner over LangGraph),
ADR-003a (pi RPC Container supersedes pi SDK),
DECISIONS.md (2026-05-16: NLAH is the Trellis harness runtime substrate — superseded),
github.com/gastownhall/gascity v1.0.0 (reviewed 2026-05-19),
Steve Yegge — "Welcome to Gas Town" (2026), "Introducing Beads" (2026), "Welcome to Gas City" (2026)

---

## 1. Decision

**Gas City** (`github.com/gastownhall/gascity` v1.0.0) replaces NLAH as the
Factory's execution substrate. ADR-009 is superseded. The 9 pending NLAH
upstream contributions (scoping, ArtifactManager interface, injectable
fileReader, initHarness/advanceHarness, loadHarness string overload, failure
semantics, trace provenance, lineage field, gate registry export) are
abandoned. No NLAH code lands in the Factory.

The two-layer architecture is:

- **Factory** (CF Workers + ArangoDB) — governance layer. Owns:
  Signal → Pressure → IS → ES → VR → FN lifecycle, Crystallizer probes,
  Coherence Verification, Fidelity Verification, Persistence Verification,
  ArangoDB lineage graph. Produces: ExecutableSpecification artifacts,
  coherence verdicts, Incidents.

- **Gas City** (external: VPS Phase 0 → k8s production) — execution layer.
  Owns: Session lifecycle (Claude Code / Codex / pi agents), Beads (durable
  work units), Event Bus, Formulas, Convergence loops, Health Patrol.
  Consumes: Formula TOML compiled from Factory ES. Produces: Events,
  execution artifacts, convergence verdicts.

ADR-004's core principle (Cloudflare platform primitives over LangGraph) is
preserved: Gas City does not run inside CF Workers. It runs externally and
communicates with Factory via HTTP API (ES → Formula dispatch) and webhooks
(Gas City Event Bus → Factory Signal Collector).

---

## 2. Context: Why NLAH Was Adopted and Why It Is Superseded

ADR-009 adopted NLAH (v0.1.0) because it already implemented the HarnessSpec
schema, compiler, gate registry, and LoomCliWorkerAdapter that IS-HARNESS-DSL-v1
was authoring from scratch. The principle: don't build what already exists.

That principle is now applied again, at a higher level.

Gas City is NLAH's functionality at production scale, with years of battle
testing behind it:

| Capability | NLAH v0.1.0 | Gas City v1.0.0 |
|---|---|---|
| Workflow schema | HarnessSpec (Zod YAML) | Formula (TOML) |
| Compiler | `compileHarness()`, 9 checks | `gc formula show` + ValidateForConvergence |
| Step execution | `runHarness()` blocking loop | Molecule steps with `needs` DAG |
| Gate evaluation | 8-gate registry (typed) | Gate conditions (shell script, typed outcomes) |
| Retry / iterate | Planned (contribution #1c, not landed) | `gate_timeout_action`: iterate / retry / manual / terminate |
| Agent crash recovery | Not implemented | GUPP: work on hook always runs; Beads survive crashes |
| Multi-agent routing | Not implemented | Sessions + sling + convoys |
| Health monitoring | Not implemented | Health Patrol, stall detection, backoff |
| Event observation | Not implemented | Event Bus (typed, append-only, two tiers) |
| Work persistence | Not implemented | Beads in Dolt (git-backed JSONL) |
| Production status | v0.1.0, 9 upstream contributions pending | v1.0.0, running 20–30 agents in production |

The decisive factor is **GUPP** (Gas Town Universal Propulsion Principle):
"If you find work on your hook, you run it." Work survives agent crashes
because Beads are durable in Dolt/git. NLAH has no equivalent. The Factory
has no recovery mechanism for pi Container crashes today. GUPP closes that gap
without any new code in the Factory.

The decisive timing factor is that ADR-009 was never Architect-approved.
Gas City was reviewed the same session ADR-009 was due for approval,
providing a clean supersession window before any NLAH code landed.

---

## 3. Key Design Principles Inherited from Gas City

These principles govern all Factory-to-Gas-City integration work:

**ZFC — Zero Framework Cognition.** No Go code in Gas City contains a
judgment call. All intelligence lives in prompt templates. Test: if a line
of Go makes a decision, it is a design violation. The Factory equivalent is
the Crystallizer and Verification layer — intelligence lives in probes and
invariants, not in pipeline wiring.

**Bitter Lesson.** Every Gas City primitive becomes MORE useful as models
improve, not less. The same applies to Factory primitives: IS/ES/VR schemas,
Crystallizer probes, and convergence gates must all improve in value as LLMs
improve, not decay.

**GUPP.** Work on the hook always runs. The Factory enforces this by writing
work into Gas City Beads, not by managing agent sessions directly. Once a
Bead exists with a molecule on its hook, Gas City's GUPP guarantee makes
execution the system's responsibility, not the operator's.

**NDI — Nondeterministic Idempotence.** Gas City converges to correct
outcomes because Beads, hooks, and molecules are persistent. The Factory's
equivalent is the amendment loop: Fidelity VR fail → new ES → new Formula →
new Bead → GUPP runs it. Redundancy is the reliability mechanism.

**ZERO hardcoded roles.** Gas City has no Mayor, Deacon, or Polecat in Go.
Roles are pure configuration (prompt templates + `city.toml`). The Factory's
coding pipeline stages (Cartographer, PatchWorker, Verifier, ReleaseAgent)
become Gas City role configurations, not hardcoded agent identities.

---

## 4. Integration Architecture

Six integration points connect Factory governance to Gas City execution.
All are new; none touch existing Factory governance code except the addition
of a compiler pass and two new HTTP endpoints.

### 4.1 ES → Formula Compiler (Factory → Gas City)

A new deterministic compiler pass (no LLM) transforms an ExecutableSpecification
YAML into a Gas City Formula TOML. Mapping:

```
ES.steps[]          → Formula [[steps]] with id, title, description, needs
ES.gates[]          → convergence.gate_condition (shell script path)
ES.inputs[]         → Formula required_vars
ES.id               → Formula name + var.es_id
ES.functionId       → var.fn_id
ES.specId           → var.is_id
```

The compiled Formula is POST'd to Gas City's HTTP API. Gas City creates a
root Bead with lineage labels (§4.2) and slings the Formula to the
appropriate agent session.

### 4.2 Beads as Lineage Carriers

Every Bead created for Factory work carries three labels:

```
fn-id:FN-XXX      Factory Function ID
is-id:IS-XXX      Factory Intent Specification ID
es-id:ES-XXX      Factory Executable Specification ID
```

Labels are the operational bridge. Factory queries Gas City's Bead API
(`GET /v0/beads?label=fn-id:FN-XXX`) for work status. ArangoDB is
governance truth. Dolt/Beads is operational truth. No writes to ArangoDB
from Gas City; Factory is the only writer to lineage.

### 4.3 Convergence Gate → Factory Verification API

Gas City's convergence `gate_condition` is a shell script in the city's
`scripts/` directory. For Factory work, the script calls:

```
POST $FACTORY_URL/verify/coherence/{es-id}
```

Factory runs Crystallizer probes against molecule artifacts. Returns
`{ verdict: "pass" | "warn" | "fail" | "escalate" }`. Gate maps:

```
pass / warn  → exit 0 (molecule complete)
fail         → exit 1 (Gas City iterates, up to MaxConvergenceIterations)
escalate     → bd meta set convergence.agent_verdict manual; exit 0 (human gate)
```

This is where Factory governance enforces quality inside Gas City's execution
loop — not by reviewing finished work, but as an automated gate condition on
every convergence cycle.

### 4.4 Gas City Event Bus → Factory Signal Collector

Gas City's typed Event Bus publishes all system events. A new CF Worker
endpoint (`POST /webhooks/gascity`) receives them and maps to Factory actions:

```
molecule.completed  → trigger Fidelity Verification (es-id from label)
health.stall        → create INC-* Incident (fn-id from label)
session.crash       → record resilience observation (GUPP handles restart)
convergence.evaluate → store Crystallizer probe verdict for drift-memory
```

`session.crash` requires no Factory action. GUPP resumes the Bead
automatically. Factory observes that the system self-healed.

### 4.5 Full Amendment Loop

```
Fidelity VR pass  → Factory promotes FN to monitored state
Fidelity VR fail  → Factory compiler re-runs → new ES
                  → Factory POST new Formula to Gas City
                  → Factory bd create (amendment Bead, label: amendment-of:ES-OLD-ID)
                  → Gas City GUPP: work on hook → runs it
                  → loop back to §4.3
```

No human in the loop unless `escalate` fires. The amendment loop IS the
Factory building itself.

### 4.6 Health Patrol → Factory Incidents → Pressures

Gas City's health patrol emits `health.stall` events for stalled sessions.
Factory creates INC-* Incidents. The SE layer diagnoses. Systemic stall
patterns become new Pressures → new IS → new capability. The Factory heals
itself through its own pipeline.

---

## 5. What Changes

### Removed

- NLAH workspace package (`packages/nlah`) — never built; nothing to remove
- IS-HARNESS-DSL-v1 — superseded; archive in `specs/reference/_archive/`
- `harness-bridge.ts` NLAH integration path — replace with Gas City webhook
  bridge (§4.4)
- `harness-dispatcher.ts` NLAH dispatch path — replace with ES → Formula
  compiler dispatch (§4.1)
- RunCoordinator DO NLAH event-driven path — work tracking moves to Gas City
  Beads; RunCoordinator DO retains only Factory-side coordination

### Unchanged

- All Factory governance: IS → ES → VR → FN lifecycle
- Crystallizer DSL and probes
- Coherence Verification, Fidelity Verification, Persistence Verification
- ArangoDB lineage graph
- pi Container (remains available as a Gas City session provider)
- StateGraph retirement gates (§8 of ADR-009): the five conditions for
  retiring `graph-runner.ts` and `coordinator/graph.ts` still apply;
  Gas City convergence replaces NLAH as the migration target, not the gates

### Added

- Compiler pass: ES → Formula TOML (deterministic, no LLM)
- Factory HTTP endpoint: `POST /verify/coherence/{es-id}` (Crystallizer gate)
- Factory HTTP endpoint: `POST /webhooks/gascity` (Event Bus bridge)
- Gas City city configuration (VPS Phase 0, k8s production)
- `scripts/factory-coherence-gate.sh` (convergence gate script in Gas City city)

---

## 6. Runtime Placement

**Phase 0 (validation):** Gas City on a dedicated VPS. Factory reaches it
via HTTP. Agents run as subprocess or ACP sessions. Goal: prove Gas City
runs SEED → CONTRACT → MAP → PATCH → VERIFY → RELEASE as a Formula before
any Factory integration.

**Production:** Gas City on k8s. Agent sessions in CF Containers via ACP
runtime provider (Gas City supports ACP natively). This keeps CF Containers
as the agent execution environment while Gas City manages orchestration
externally.

The runtime placement decision is an architecture gate. Phase 0 VPS
validation is the first step; k8s migration decision follows after Phase 0
produces evidence.

---

## 7. Sequencing

| Phase | Duration | What | Gate |
|---|---|---|---|
| 0 | 2 days | Gas City local rig: run coding pipeline stages as Formula. No Factory integration. | Phase 0 evidence |
| 1 | 3–5 days | ES → Formula compiler. Beads lineage labels. Factory dispatches coding task to Gas City. | Smoke: Factory task in Gas City with correct labels |
| 2 | 3–5 days | Convergence gate → Factory `/verify/coherence`. Gate script + coherence endpoint. | Smoke: bad patch caught by Crystallizer; Gas City iterates |
| 3 | 3–5 days | Event Bus → Factory Signal Collector. Webhook bridge. All execution events received. | Smoke: end-to-end run with full Factory observability |
| 4 | 5–7 days | Full amendment loop. VR fail → new Bead → GUPP. Autonomous amendment. | Smoke: deliberate violation → autonomous repair → FN promoted |

---

## 8. Consequences

**StateGraph retirement.** `graph-runner.ts` and `coordinator/graph.ts`
retirement gates (originally §8 of ADR-009) are re-scoped: Gas City
convergence is now the migration target instead of NLAH event-driven path.
The five gate conditions remain the same:
1. Gas City convergence replaces NLAH event-driven path as the production path
2. `synthesis.harness.yaml` compiles as a Gas City Formula
3. Factory coherence gate passes on synthesis Formula
4. All synthesis DO integration tests pass with Gas City convergence path
5. Architect reviews migrated synthesis Formula

These gates are not satisfied by this ADR — they are preconditions for
`graph-runner.ts` retirement. No retirement until all five are satisfied.

**NLAH repo.** `/Users/wes/nlah` remains intact. The 9 upstream
contributions are abandoned from the Factory's perspective; they may be
contributed to upstream NLAH independently if useful. The Factory does not
depend on NLAH in any form after this ADR.

**IS-HARNESS-DSL-v1.** The v3 intent specification is archived to
`specs/reference/_archive/`. It specified the event-driven bridge and
RunCoordinator DO extension that would have wrapped NLAH. That specification
is now superseded by Gas City integration specs that will be authored as new
IS-* artifacts under the Factory's standard pipeline.

---

## 9. Alternatives Considered

**(a) Keep NLAH below Gas City.** NLAH runs inside individual Gas City
sessions; Gas City routes multi-agent work; NLAH handles per-task stages.
Rejected — two harness systems solving the same problem. Gas City's
Formula + convergence loop is strictly more capable than NLAH's HarnessSpec.
The seam introduces complexity with no benefit.

**(b) Port Gas City primitives to CF Workers.** Rebuild Beads as ArangoDB
collection + CF Queue, rebuild Event Bus as typed CF Queue, rebuild Sessions
as CF Container DO, rebuild Formula + convergence as Durable Object +
Workflow. Rejected — this is NLAH v2 (another in-house reimplementation of
something that already exists and works). Violates "don't build what already
exists." Gas City's primitives are more capable than any CF-native
reimplementation would be in the near term.

**(c) Keep NLAH, defer Gas City evaluation.** ADR-009 was pending Architect
approval; the window to supersede before code lands was available. Deferring
means NLAH code lands, creates migration debt, and the 9 upstream
contributions become real obligations rather than abandoned proposals.
Rejected — the timing was correct for a clean supersession.

---

## 10. Decision Authority

Decision made by Wes (architect) in session 2026-05-19 after reviewing:
- Gas City v1.0.0 source (`/Users/wes/Developer/gascity`)
- Steve Yegge's Gas Town / Beads / Gas City articles
- ADR-009 pending-approval status
- Integration architecture analysis (Factory governance + Gas City execution)

Status: **Active.** Supersedes ADR-009.
