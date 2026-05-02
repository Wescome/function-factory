# DESIGN: Crystallizer — Semantic Fidelity for the Synthesis Pipeline

**Status:** APPROVED — Architect (7 conditions) + SE (5 additions), all resolved below
**Architecture Decision:** 2026-05-02 (corpus analysis complete)
**Architect Review:** 2026-05-02 — APPROVE WITH CONDITIONS (C1-C7 resolved)
**SE Review:** 2026-05-02 — CONDITIONAL APPROVE (SE-1 through SE-5 resolved)
**Reference:** Ontology Introspection corpus — IntrospectiveHarness TypeScript implementation
**Traces to:** specification-execution-ontology-draft-0.9.md (A7: Conservation of Gap),
introspective-harness-architecture.md (Crystallizer + Probe + Gate pattern)

## JTBD

When a signal enters the synthesis pipeline, I want its semantic intent crystallized
into binary checkpoints that persist across all compilation passes, so that every
stage can be verified against the original intent and "LifecycleState" never becomes
"AtomDefinition."

## Problem Statement

The Factory's synthesis pipeline loses semantic fidelity across 5+ compilation stages.
Signal "export LifecycleState" → atoms produce "AtomDefinition." Root causes:

1. **No intent crystallization.** The signal's conceptual intent is never formalized
   into verifiable checkpoints. Each compilation pass re-interprets the intent freely.

2. **No inter-pass verification.** Atoms flow from decompose → dependency → invariant
   → binding → validation → assembly without checking that the output preserves intent.

3. **Same-context semantic review.** The existing semantic-review.ts runs in the same
   pipeline context as compilation — it's "cued by the same circuit" and cannot
   detect drift the compilation model introduced.

4. **Wrong atom category.** The decompose pass produces "implementable work units"
   (procedural), not "verifiable claims" (truth-apt). This is where fidelity first
   breaks — per SEO Axiom A7, every formalization loses information.

## Architecture

Three components adapted from the IntrospectiveHarness reference implementation:

```
Signal arrives at pipeline
  │
  ├── CRYSTALLIZE (isolated LLM call)
  │   └── Produces 3-6 IntentAnchors: binary yes/no questions
  │       that verify "did this stage preserve the signal's intent?"
  │
  ├── Pass 1: decompose
  │   └── PROBE (isolated LLM call against anchors)
  │       └── GATE (deterministic: pass/remediate/escalate)
  │
  ├── Pass 2: dependency
  │   └── PROBE → GATE
  │
  ├── ... (each semantic pass)
  │
  ├── Assembly (deterministic — no probe needed)
  │
  ├── Gate 1 (existing structural check)
  │
  └── Atom Execution (code generation)
      └── PROBE → GATE (verify code preserves intent)
```

## 1. The Crystallizer

### Types

```typescript
interface IntentAnchor {
  id: string                  // e.g. "IA-SIG-MON9XJVI-01"
  signal_id: string           // parent signal key
  claim: string               // original conceptual claim from the signal
  probe_question: string      // binary yes/no question answerable from output text alone
  violation_signal: 'yes' | 'no'  // which answer indicates a violation
  severity: 'block' | 'warn' | 'log'
  times_probed: number        // updated by drift ledger
  times_violated: number      // updated by drift ledger
}

interface CrystallizationResult {
  signal_id: string
  anchors: IntentAnchor[]
  model_used: string
  latency_ms: number
  timestamp: string
}
```

### Input

The crystallizer receives the Signal's title, description, and specContent (if
available). It does NOT receive the PRD, compilation state, or any downstream
artifacts — it operates on the ORIGINAL intent only.

### Model

**MUST be a different model from the compilation model (kimi-k2.6).**
Use the Governor model (gpt-oss-120b) or llama-70b. The probe isolation principle
(from IntrospectiveHarness ARCHITECTURE.md, Section "Key Architectural Decisions #1")
requires that the crystallizer not share circuit activation with the compilation model.

Pragmatic choice: **llama-70b via env.AI.run()** — zero cost (Workers AI free tier),
already available in the pipeline, sufficient for binary question generation.

### System Prompt

Adapted from IntrospectiveHarness crystallizer.ts:

```
You are a specification fidelity analyst. Your job is to decompose a software
change request into a set of binary yes/no checkpoint questions.

Each checkpoint must:
1. Be answerable by reading a compilation stage's output alone
2. Have a clear yes/no answer (no ambiguity)
3. Detect whether the original signal's intent was preserved
4. Be phrased so that ONE answer (yes or no) indicates a violation

Your response is a JSON array:
[
  {
    "claim": "The original intent being checked",
    "probe_question": "Does this output [specific preservation/violation pattern]?",
    "violation_signal": "yes" or "no",
    "severity": "block" or "warn" or "log"
  }
]

Severity:
- "block": The output fundamentally misses the signal's core intent
- "warn": The output partially addresses the intent but with drift
- "log": Minor deviation worth tracking

Generate 3-6 anchors. Fewer is better — each must be genuinely discriminating.
```

### Cost

One LLM call per pipeline run. Using llama-70b via Workers AI binding = zero cost.
~500 input tokens (signal title + description + specContent summary) + ~500 output
tokens (3-6 anchors in JSON). Total: ~1K tokens per run.

### Storage

Anchors are:
1. Stored in `GraphState.intentAnchors: IntentAnchor[]` (threaded through pipeline)
2. Persisted to ArangoDB `intent_anchors` collection (for drift ledger analysis)

### Integration Point

In `pipeline.ts`, after the semantic-review step and BEFORE the compilation loop:

```typescript
// ── Crystallize signal intent into binary anchors ──
const anchors = await step.do('crystallize-intent', async () => {
  const crystallizer = new IntentCrystallizer(env)
  return crystallizer.crystallize({
    title: signal.title,
    description: signal.description,
    specContent: params.signal.specContent,
  })
})
```

## 2. The Inter-Pass Probe

### When

After each SEMANTIC compilation pass (passes that involve LLM calls):
- decompose ✓ (this is where fidelity first breaks)
- dependency ✓ (verifies atom scope wasn't expanded)
- invariant ✓ (verifies invariants match signal intent)
- binding — SKIP (now deterministic: language forced to typescript)
- validation — SKIP (schema generation, low fidelity risk)
- assembly — SKIP (deterministic)
- verification — SKIP (deterministic)

**3 probe calls per compilation run.** Using a cheap model (llama-70b or haiku-tier).

### How

Adapted from IntrospectiveHarness probe-engine.ts:

```typescript
class IntentProbe {
  async probe(passOutput: string, anchors: IntentAnchor[]): Promise<ProbeResult[]> {
    // ISOLATED: separate API call, different system prompt, no compilation context
    const questionLines = anchors.map((a, i) => `${i + 1}. ${a.probe_question}`)
    
    const result = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: PROBE_SYSTEM_PROMPT },
        { role: 'user', content: `TEXT TO EVALUATE:\n"""\n${passOutput}\n"""\n\nQUESTIONS:\n${questionLines.join('\n')}\n\nRespond as JSON: {"1": "yes"|"no", ...}` }
      ]
    })
    
    // Parse and return ProbeResult[]
  }
}
```

### Probe System Prompt

From IntrospectiveHarness types.ts AgentConfig.probe_system_prompt:

```
You are a specification fidelity evaluator. You will receive a text and a set of
yes/no questions about that text. For each question, answer ONLY "yes" or "no".
Respond as JSON: {"1": "yes"|"no", "2": "yes"|"no", ...}
```

### Input to Probe

The probe sees ONLY:
- The compilation pass's output (JSON stringified)
- The anchor probe questions

It does NOT see:
- The compilation prompt
- The signal description
- The PRD
- Previous pass outputs

This is the probe isolation principle from the corpus: "If the probe runs in the
same context as generation, it will be cued by the same circuit."

### Output

```typescript
interface ProbeResult {
  anchor_id: string
  answer: 'yes' | 'no'
  is_violation: boolean
  explanation?: string        // brief rationale from probe (Architect: add from reference)
  pass_name: string           // which compilation pass was probed
  timestamp: string
}
```

## 3. The Reconciliation Gate

### Decision Logic

Adapted from IntrospectiveHarness gate.ts — pure deterministic state machine:

```
No violations             → PASS (continue to next pass)
Log-only violations       → PASS (record in drift ledger)
Warn violations           → WARN (continue, append advisory to next pass)
Block violations, attempt < 2 → REMEDIATE (re-run pass with violation feedback)
Block violations, attempt >= 2 → ESCALATE (emit CRP, fail the compilation)
```

### Remediation Strategy

When a block-severity anchor is violated, the pass is re-run with the violation
injected into the prompt:

```
[PREVIOUS OUTPUT VIOLATED INTENT CHECKPOINTS]
Violation: "Does this output reference the specific types named in the signal?"
  → Answer: no (violation detected)
  
Original signal intent: "export LifecycleState and LifecycleTransition"

Re-generate this pass, ensuring the violated checkpoints are satisfied.
```

Maximum 2 remediation attempts per pass. After 2 failures, emit a CRP signal
and fail the compilation with a `synthesis:intent-violation` signal.

### Implementation

```typescript
function reconcile(
  probeResults: ProbeResult[],
  anchors: IntentAnchor[],
  remediationAttempt: number,
): { verdict: 'pass' | 'warn' | 'remediate' | 'escalate'; violatedAnchors: string[]; advisory?: string } {
  // Pure boolean logic — no LLM, no judgment
  const violations = probeResults.filter(r => r.is_violation)
  if (violations.length === 0) return { verdict: 'pass', violatedAnchors: [] }
  
  const anchorMap = new Map(anchors.map(a => [a.id, a]))
  const blocks = violations.filter(v => anchorMap.get(v.anchor_id)?.severity === 'block')
  const warns = violations.filter(v => anchorMap.get(v.anchor_id)?.severity === 'warn')
  
  if (blocks.length === 0 && warns.length === 0)
    return { verdict: 'pass', violatedAnchors: violations.map(v => v.anchor_id) }
  
  if (blocks.length === 0)
    return { verdict: 'warn', violatedAnchors: violations.map(v => v.anchor_id), advisory: '...' }
  
  if (remediationAttempt < 2)
    return { verdict: 'remediate', violatedAnchors: violations.map(v => v.anchor_id) }
  
  return { verdict: 'escalate', violatedAnchors: violations.map(v => v.anchor_id) }
}
```

## 4. The Drift Ledger

### What's Recorded

Per-pass probe results accumulated across all compilations:

```typescript
interface DriftEntry {
  pipeline_id: string         // workflow instance ID
  signal_id: string
  pass_name: string
  anchors_probed: string[]    // anchor IDs
  probe_results: ProbeResult[]
  gate_verdict: 'pass' | 'warn' | 'remediate' | 'escalate'
  remediation_count: number
  probe_model: string
  latency_ms: number
  timestamp: string
}
```

### Storage

ArangoDB collection: `compilation_drift_ledger`

### What It Enables

- **Erosion detection:** if pass X's violation rate increases across compilations
- **Anchor quality:** which anchors have high false-positive rates (recrystallize)
- **Pass targeting:** which passes need probing most (adaptive budget)
- **Governor visibility:** drift data feeds into operational health assessment

## 5. The Atom Category Fix

The decompose pass prompt (compile.ts line 30) currently says:

```
Decompose this PRD into requirement atoms — minimal, independently
implementable units of work.
```

Per SEO Section 3.3, atoms should be "truth-apt, verifiable claims." Change to:

```
Decompose this PRD into requirement atoms. Each atom is a verifiable claim about
what the system must do — it must be truth-apt (can be checked as true or false)
and independently implementable.

Each atom MUST carry:
- id (format "atom-001")
- type ("implementation" | "config" | "test")
- title: the verifiable claim in one sentence
- description: implementation details
- verifies: what specific aspect of the signal's intent this atom fulfills
```

The `verifies` field creates explicit lineage from each atom back to the signal's
intent. The probes can check: "does this atom's title match something in the
signal's intent?"

## 6. Integration Plan

### Phase 1: Minimum Viable Crystallizer (ship first)
- New file: `workers/ff-pipeline/src/stages/crystallize-intent.ts`
- Types: `IntentAnchor`, `CrystallizationResult`
- Crystallizer class with llama-70b via env.AI.run()
- Integration into pipeline.ts (after semantic-review, before compile loop)
- Anchors threaded through GraphState
- ArangoDB collection: `intent_anchors`

### Phase 2: Inter-Pass Probing
- New file: `workers/ff-pipeline/src/stages/intent-probe.ts`
- ProbeEngine class with llama-70b (isolated calls)
- ReconciliationGate (deterministic)
- Integration into compile loop (probe after decompose, dependency, invariant)
- Remediation: re-run pass with violation feedback

### Phase 3: Drift Ledger + Atom Category Fix
- New file: `workers/ff-pipeline/src/stages/drift-ledger.ts`
- ArangoDB collection: `compilation_drift_ledger`
- Decompose pass prompt revision (add `verifies` field)
- Governor integration: drift data in operational health assessment

### Phase 4: Code-Level Probing
- Extend probing to atom execution (after CoderAgent.produceCode())
- Verify that generated code preserves intent anchors
- Integration with existing validateCodeLanguage() gate

## Cost Model

| Component | LLM Calls | Model | Cost per Run |
|-----------|-----------|-------|-------------|
| Crystallizer | 1 | llama-70b (Workers AI) | $0 (free tier) |
| Probe (decompose) | 1 | llama-70b | $0 |
| Probe (dependency) | 1 | llama-70b | $0 |
| Probe (invariant) | 1 | llama-70b | $0 |
| Remediation (if needed) | 1 gen + 1 probe | kimi-k2.6 + llama-70b | ~$0.01 |

**Steady-state per-run cost:** 4 LLM calls (1 crystallize + 3 probes) at zero cost
via Workers AI free tier. Remediation adds 2 calls only when violations are detected.

## Non-Goals

- Real-time probing during atom execution (Phase 4, not Phase 1)
- Multi-model probe ensemble (future enhancement 2.4 from corpus analysis)
- Adaptive probe selection (requires accumulated drift data)
- Framework conflict resolution (single-signal pipelines don't conflict)
- Replacing the existing semantic-review (it becomes advisory alongside probing)

## Success Criteria

1. A signal's specific type/function names appear in the decomposed atoms
2. Inter-pass probing catches "AtomDefinition instead of LifecycleState" before assembly
3. Remediation re-runs the pass and produces correct atoms on second attempt
4. Drift ledger shows which passes are most prone to intent drift
5. Zero additional cost (Workers AI free tier for all probe calls)

## Dependencies

- Workers AI binding (already available: env.AI.run())
- ArangoDB (already available)
- No new npm packages required
- No WASM, no external services

---

## Review Resolutions (Architect C1-C7 + SE SE-1 through SE-5)

### C1 + SE-1: Workflow Step Idempotency + Remediation Counter (CRITICAL)

CF Workflow `step.do()` replays closures on retry. Remediation count in a closure
variable resets to 0 on replay → infinite remediation loop.

**Resolution:** Probe+gate runs INSIDE step.do. Each remediation attempt uses a
distinct step name: `compile-and-verify-decompose-r0`, `compile-and-verify-decompose-r1`.
CF Workflows deduplicates by step name, so replayed steps return cached results.
Maximum 2 remediation attempts = 3 step names per probed pass.

The compile loop becomes:
```typescript
for (const passName of PROBED_PASSES) {
  for (let r = 0; r < 3; r++) {
    compState = await step.do(`compile-verify-${passName}-r${r}`, async () => {
      const result = await compilePRD(passName, prevState, db, env, dryRun)
      if (r > 0) { /* inject violation feedback into prompt */ }
      const delta = computeDelta(prevState, result)
      const probeResults = await probeAnchors(delta, anchors, env)
      const gate = reconcile(probeResults, anchors, r)
      if (gate.verdict === 'pass' || gate.verdict === 'warn')
        return { ...result, _gateVerdict: 'pass' }
      if (gate.verdict === 'escalate')
        return { ...result, _gateVerdict: 'escalate', _violatedAnchors: gate.violatedAnchors }
      throw new Error(`REMEDIATE:${passName}:r${r}`) // triggers next iteration
    })
    if ((compState as any)._gateVerdict !== undefined) break
  }
  // Check for escalation
  if ((compState as any)._gateVerdict === 'escalate') {
    // SE-2: error propagation via sentinel field
    return { status: 'synthesis:intent-violation', ... }
  }
}
```

### C2: Probe Needs Pass Delta

**Resolution:** `computeDelta(prevState, newState)` extracts only the fields added
by the current pass (e.g., `atoms` from decompose, `dependencies` from dependency).
The probe receives JSON.stringify(delta), not the full accumulated state.

### C3 + SE-5: Use callProvider / extractJSON Fallback

**Resolution:** Crystallizer and Probe calls route through the task-routing system
with new TaskKinds (`'crystallizer'`, `'probe'`), both mapped to `CF_70B` (llama-70b
via Workers AI). This gets:
- `extractJSON()` 4-tier fallback (battle-tested)
- `response_format: { type: 'json_object' }` handling
- Hot-config model override
- ORL telemetry

### C4: Task-Routing Integration

**Resolution:** Add to `packages/task-routing/src/index.ts`:
```typescript
crystallizer: { provider: 'cloudflare', model: CF_70B },
probe: { provider: 'cloudflare', model: CF_70B },
```

### C5: Worst-Case Latency

**Resolution:** Documented. Worst case: 16 LLM calls = 30-80s wall-clock time.
All are async I/O (not CPU time). Acceptable for the compilation pipeline which
already takes 5-10 minutes.

### C6: GraphState Threading

**Resolution:** Anchors enter state at crystallization:
`compState.intentAnchors = anchors`

Probes read from state at each pass:
`const anchors = compState.intentAnchors as IntentAnchor[]`

Drift entries appended to state:
`compState.driftEntries = [...(compState.driftEntries ?? []), entry]`

All fields optional on the `Record<string, unknown>` state bag.

### C7: Per-Run vs Cross-Run Stats

**Resolution:** In-memory `IntentAnchor` objects carry per-run counts (reset per
pipeline). ArangoDB `intent_anchors` collection carries historical counts (accumulated
across pipelines). These are separate: per-run counts live on the state-bag anchors,
historical counts live in ArangoDB and are only read during recrystallization (Phase 3).

### SE-2: Error Propagation from Gate Escalation

**Resolution:** Sentinel field `_gateVerdict: 'escalate'` in compState. The compile
loop checks after each pass and breaks early with `synthesis:intent-violation` status.
See C1 resolution for code example.

### SE-3: Feature Flag (REQUIRED for Phase 1 deploy)

**Resolution:** Hot-config flag: `crystallizer.enabled` (default: `false`).
When false, `step.do('crystallize-intent')` returns empty anchors `[]`.
Compile loop skips probing when anchors are empty. Zero behavior change when disabled.

### SE-4: Probe Input Size Guard

**Resolution:** Before probe call, estimate token count of pass delta.
If > 4K tokens, truncate deterministically (first N items by array order).
Emit `pipeline:probe-input-truncated` signal. This prevents silent probe
failures from context overflow on llama-70b (8K context).

### Failure Mode Summary (from SE review)

| ID | Component | Failure | Mitigation |
|---|---|---|---|
| F1 | Crystallizer | Non-JSON response | extractJSON 4-tier fallback via callProvider (C3+SE-5) |
| F2 | Crystallizer | Workers AI unavailable | Feature flag (SE-3) — disable, pipeline runs without probing |
| F3 | Crystallizer | Degenerate anchors | Phase 3 drift ledger detects; monitor anchor discrimination ratio |
| F5 | Probe | False positive | 2 remediation attempts before escalation; drift ledger tracks rates |
| F7 | Gate | Counter reset on CF replay | Distinct step names per attempt (C1+SE-1) |
| F8 | Gate | Escalation with no error propagation | Sentinel field in compState (SE-2) |
| F10 | All | Workers AI rate limit | 2500 runs/day ceiling; emit `infra:workers-ai-rate-limit` signal |

### Operational Checklist (pre-deploy)

- [ ] ArangoDB: `ensureCollection('intent_anchors')`
- [ ] Hot-config: seed `crystallizer.enabled: false`
- [ ] Hot-config: seed `crystallizer.model` and `probe.model`
- [ ] Task-routing: add `crystallizer` and `probe` TaskKinds
- [ ] GraphState: `intentAnchors` as optional field
- [ ] Tier 1 signals: crystallizer-binding-unavailable, crystallizer-parse-failure,
      probe-parse-failure, intent-violation-escalation, workers-ai-rate-limit
- [ ] Probe input truncation: deterministic strategy + signal
- [ ] Test: dry-run with crystallizer enabled
- [ ] Test: crystallizer disabled via hot-config → no behavior change
- [ ] Test: Workers AI returns garbage → extractJSON fallback handles it
