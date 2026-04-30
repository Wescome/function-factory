# Closed-World Signal Taxonomy for Function Factory

> `pp.governor.signal-taxonomy.v1.0`
>
> This is the contract between the Factory and its Governor.
> Every signal type, every source, every action.
>
> If a signal type is not in this taxonomy, the Governor cannot react to it.
> If the Governor receives an unrecognized signal, it follows the
> closed-world fallback policy (Section 7).

---

## 1. Design Principle

The GovernorAgent is event-driven, not polling. It runs on a cron
schedule (every 15 minutes) and optionally on queue triggers. In either
mode, it reads all available signals from ArangoDB and decides what to do.

The taxonomy below enumerates every signal the Factory currently produces
or should produce. Each entry maps to:

1. An **ontology class** from `ORIENTATION-ONTOLOGY.md` Section C
2. A **Governor action** from `DESIGN-GOVERNOR-AGENT.md` Section 7.1
3. A **trigger mode**: event (reacts immediately via queue), cron
   (handled at next scheduled cycle), or both

This creates a closed-world assumption: the Governor's decision space is
bounded by this taxonomy. Any signal not in the taxonomy triggers the
fallback policy.

---

## 2. Signal Categories

### A. Synthesis Signals

Produced by the feedback loop (`generate-feedback.ts`). These are
the primary self-improvement signals -- synthesis outcomes that re-enter
the pipeline as new inputs.

| Signal Type | Ontology Class | Source | Trigger | Governor Action | Mode | Auto-Approve |
|---|---|---|---|---|---|---|
| `synthesis:atom-failed` | WorkGraphInstabilitySignal | `generate-feedback.ts` | Atom verdict = fail | `trigger_pipeline` | event | true |
| `synthesis:gate1-failed` | ContractFragilitySignal | `pipeline.ts` (gate-1 step) | Gate 1 structural check fails | `diagnose_failure` | event | false |
| `synthesis:verdict-fail` | WorkGraphInstabilitySignal | `generate-feedback.ts` | Monolithic synthesis fails (no atoms) | `escalate_to_human` | event | false |
| `synthesis:low-confidence` | EvidenceGapSignal | `generate-feedback.ts` | Synthesis passes but confidence < 0.8 | `diagnose_failure` | cron | false |
| `synthesis:orl-degradation` | ModelMismatchSignal | `generate-feedback.ts` | ORL repairCount >= 2 | `trigger_pipeline` | event | true |
| `synthesis:pr-candidate` | LearningOpportunitySignal | `generate-feedback.ts` | Synthesis passes with confidence >= 0.8 | `no_action` (PR auto-generated) | event | false |

**Loop Prevention (3 layers):**
- Layer 1: `feedbackDepth` counter in `raw` field, max 3
- Layer 2: Idempotency via `ingest-signal.ts` content hash
- Layer 3: 30-minute cooldown per `workGraphId + subtype` via AQL query

---

### B. Pipeline Lifecycle Signals

Produced by the Workflows API pipeline (`pipeline.ts`) as it progresses
through stages. These are structural events, not feedback signals.

| Signal Type | Ontology Class | Source | Trigger | Governor Action | Mode | Auto-Approve |
|---|---|---|---|---|---|---|
| `pipeline:created` | TraceEvent | `env.FACTORY_PIPELINE.create()` | New pipeline instantiated | `no_action` (monitoring) | cron | n/a |
| `pipeline:approved` | PolicyDecision | `pipeline.ts` (architect-approval step) | Human or auto-approval event received | `no_action` (monitoring) | cron | n/a |
| `pipeline:rejected` | PolicyDecision | `pipeline.ts` (architect-approval step) | Architect declines pipeline | `archive_signal` | cron | n/a |
| `pipeline:stage-complete` | TraceEvent | `pipeline.ts` (each `step.do`) | A named step finishes | `no_action` (monitoring) | cron | n/a |
| `pipeline:synthesis-enqueued` | TraceEvent | `pipeline.ts` (enqueue-synthesis step) | WorkGraph sent to SYNTHESIS_QUEUE | `no_action` (monitoring) | cron | n/a |
| `pipeline:synthesis-timeout` | LatencyObservation | `pipeline.ts` (atoms-complete timeout) | 30-minute waitForEvent expires | `escalate_to_human` | event | n/a |
| `pipeline:complete` | TraceEvent | `pipeline.ts` (return) | Pipeline returns final result | `no_action` (monitoring) | cron | n/a |

**Note:** Pipeline lifecycle signals are currently implicit (logged but
not written as typed signals to ArangoDB). Section 6 recommends
instrumenting them as explicit signals.

---

### C. Coordinator / Synthesis Signals

Produced by the SynthesisCoordinator DO (`coordinator.ts`) and
AtomExecutor DOs (`atom-executor-do.ts`) during Stage 6 execution.

| Signal Type | Ontology Class | Source | Trigger | Governor Action | Mode | Auto-Approve |
|---|---|---|---|---|---|---|
| `coordinator:phase1-complete` | TraceEvent | `coordinator.ts` via SYNTHESIS_RESULTS queue | Phase 1 (planning graph) finishes, atoms dispatched | `no_action` (monitoring) | cron | n/a |
| `coordinator:synthesis-complete` | TraceEvent | `coordinator.ts` via SYNTHESIS_RESULTS queue | DO completes synthesis (monolithic path) | `no_action` (relay to Workflow) | event | n/a |
| `coordinator:alarm-fired` | LatencyObservation | `coordinator.ts` alarm() | DO wall-clock deadline exceeded | `diagnose_failure` | event | n/a |
| `coordinator:fiber-recovered` | RegressionRiskSignal | `coordinator.ts` onFiberRecovered() | DO restarted after eviction | `diagnose_failure` | event | n/a |
| `atom:complete-pass` | TraceEvent | `atom-executor-do.ts` via ATOM_RESULTS queue | Individual atom finishes with verdict=pass | `no_action` (ledger update) | event | n/a |
| `atom:complete-fail` | WorkGraphInstabilitySignal | `atom-executor-do.ts` via ATOM_RESULTS queue | Individual atom finishes with verdict=fail | Handled by feedback loop | event | n/a |
| `atom:alarm-fired` | LatencyObservation | `atom-executor-do.ts` alarm() | Atom exceeds 900s wall-clock deadline | Handled by feedback loop | event | n/a |
| `atom:preflight-auth-fail` | GovernanceViolationSignal | `atom-executor-do.ts` | No API key for resolved model provider | `escalate_to_human` | event | n/a |
| `atoms:all-complete` | TraceEvent | `index.ts` atom-results consumer | All atoms in ledger complete, Phase 3 runs | `no_action` (relay to Workflow) | event | n/a |

---

### D. Operational / Infrastructure Signals

Produced by platform infrastructure. These are NOT currently emitted as
typed signals -- they manifest as errors in Worker logs or queue retries.

| Signal Type | Ontology Class | Source | Trigger | Governor Action | Mode | Auto-Approve |
|---|---|---|---|---|---|---|
| `infra:queue-processing-error` | ValidationFailure | `index.ts` queue() catch blocks | Queue message processing throws | `diagnose_failure` | cron | n/a |
| `infra:queue-retry-exhausted` | RegressionRiskSignal | `index.ts` queue() `msg.attempts >= N` | Max retries reached, message acked without processing | `escalate_to_human` | cron | n/a |
| `infra:do-alarm-timeout` | LatencyObservation | `coordinator.ts` / `atom-executor-do.ts` | DO alarm fires before completion | `diagnose_failure` | event | n/a |
| `infra:arango-connection-failure` | ValidationFailure | Any `createClientFromEnv` call | ArangoDB unreachable or auth fails | `escalate_to_human` | cron | n/a |
| `infra:llm-api-401` | GovernanceViolationSignal | `model-bridge.ts` / agent `agentLoop()` | LLM provider returns 401 Unauthorized | `escalate_to_human` | event | n/a |
| `infra:llm-api-429` | PolicyFrictionSignal | `model-bridge.ts` / agent `agentLoop()` | LLM provider returns 429 Rate Limited | `adjust_config` | cron | n/a |
| `infra:llm-api-500` | RegressionRiskSignal | `model-bridge.ts` / agent `agentLoop()` | LLM provider returns 5xx Server Error | `no_action` (transient) | cron | n/a |
| `infra:token-budget-exceeded` | CostObservation | `coordinator.ts` (tokenUsage check) | Synthesis token usage exceeds budget | `adjust_config` | cron | n/a |
| `infra:workflow-event-send-failed` | RegressionRiskSignal | `index.ts` queue consumers | `workflow.sendEvent()` throws | `diagnose_failure` | event | n/a |
| `infra:github-api-failure` | ValidationFailure | `generate-pr.ts` | GitHub API call fails during PR creation | `diagnose_failure` | cron | n/a |

---

### E. Orientation / Memory Signals

Produced by Orientation Agents -- currently only the MemoryCuratorAgent,
with the GovernorAgent as the second.

| Signal Type | Ontology Class | Source | Trigger | Governor Action | Mode | Auto-Approve |
|---|---|---|---|---|---|---|
| `orientation:memory-curation-complete` | LearningOpportunitySignal | `memory-curator-agent.ts` | Curation cycle finishes | `no_action` (monitoring) | cron | n/a |
| `orientation:memory-curation-failed` | ValidationFailure | `index.ts` memory-curation consumer | Curation LLM call fails or parsing fails | `diagnose_failure` | cron | n/a |
| `orientation:pattern-detected` | LearningOpportunitySignal | `memory-curator-agent.ts` | New pattern added to `pattern_library` | `no_action` (monitoring) | cron | n/a |
| `orientation:governance-recommendation` | PolicyFrictionSignal | `memory-curator-agent.ts` | Curation produces governance recommendation | `escalate_to_human` | cron | n/a |
| `orientation:lesson-promoted` | LearningOpportunitySignal | Future: Mentor Rule promotion pipeline | Curated lesson graduates to `mentorscript_rules` | `no_action` (monitoring) | cron | n/a |
| `orientation:crp-created` | EvidenceGapSignal | `crp.ts` | Confidence Review Packet auto-generated (C7) | `diagnose_failure` | cron | n/a |
| `governance:cycle-complete` | TraceEvent | `governor-agent.ts` | Governor finishes a governance cycle | `no_action` (self-telemetry) | cron | n/a |
| `governance:cycle-failed` | ValidationFailure | `governor-agent.ts` | Governor cycle errors out | `no_action` (logged, next cron retries) | cron | n/a |
| `governance:escalation-created` | GovernanceViolationSignal | `governor-agent.ts` execute() | Governor files a GitHub issue or high-priority signal | `no_action` (self-telemetry) | cron | n/a |

---

### F. External Signals

Produced by sources outside the Factory. These enter via HTTP endpoints
or future webhook integrations.

| Signal Type | Ontology Class | Source | Trigger | Governor Action | Mode | Auto-Approve |
|---|---|---|---|---|---|---|
| `external:human-signal` | HumanCorrection | `POST /pipeline` (ff-gateway) | Human submits a signal via API | `trigger_pipeline` | event | false |
| `external:ci-cd-event` | TestResult | Future: GitHub Actions webhook | CI pipeline completes (pass/fail) | `diagnose_failure` (on fail) | event | n/a |
| `external:github-webhook` | HumanCorrection | Future: GitHub webhook handler | PR merged, issue opened, etc. | Varies by event type | event | n/a |
| `external:scheduled-maintenance` | PolicyDecision | Future: cron or manual | Planned downtime or config rotation | `adjust_config` | cron | n/a |

---

### G. Drift Signals (Cron-Only)

Derived from telemetry trends, not individual events. The Governor
computes these during its cron cycle by comparing current metrics against
historical baselines. These are analytical products, not raw telemetry.

| Signal Type | Ontology Class | Source | Trigger | Governor Action | Mode | Auto-Approve |
|---|---|---|---|---|---|---|
| `drift:orl-success-rate-declining` | ModelMismatchSignal | Governor cron (AQL trend query) | ORL success rate drops >10% vs 7-day average | `escalate_to_human` | cron | n/a |
| `drift:atom-pass-rate-declining` | WorkGraphInstabilitySignal | Governor cron (AQL trend query) | Atom pass rate drops >15% over 48 hours | `escalate_to_human` | cron | n/a |
| `drift:latency-increasing` | LatencyObservation | Governor cron (AQL trend query) | Mean synthesis time increases >50% | `adjust_config` | cron | n/a |
| `drift:cost-trending-up` | CostObservation | Governor cron (AQL trend query) | Token cost per synthesis exceeds threshold | `escalate_to_human` | cron | n/a |
| `drift:model-reliability-changing` | ModelMismatchSignal | Governor cron (AQL trend query) | Specific model's error rate crosses threshold | `adjust_config` | cron | n/a |
| `drift:prompt-effectiveness-declining` | PromptDriftSignal | Governor cron (AQL trend query) | Specific PromptPact schema's success rate drops | `escalate_to_human` | cron | n/a |
| `drift:feedback-loop-deepening` | RegressionRiskSignal | Governor cron (AQL trend query) | Avg feedback depth increasing (loops not resolving) | `escalate_to_human` | cron | n/a |

---

## 3. Ontology Mapping

Complete mapping from implementation signal types to Orientation Ontology
Signal classes (Section C of `ORIENTATION-ONTOLOGY.md`).

```
# Synthesis signals
synthesis:atom-failed        -> WorkGraphInstabilitySignal
synthesis:gate1-failed       -> ContractFragilitySignal
synthesis:verdict-fail       -> WorkGraphInstabilitySignal
synthesis:low-confidence     -> EvidenceGapSignal
synthesis:orl-degradation    -> ModelMismatchSignal
synthesis:pr-candidate       -> LearningOpportunitySignal

# Pipeline lifecycle
pipeline:rejected            -> PolicyDecision (TelemetryObservation)
pipeline:synthesis-timeout   -> LatencyObservation (TelemetryObservation)

# Coordinator / atom execution
coordinator:alarm-fired      -> LatencyObservation (TelemetryObservation)
coordinator:fiber-recovered  -> RegressionRiskSignal
atom:complete-fail           -> WorkGraphInstabilitySignal
atom:alarm-fired             -> LatencyObservation (TelemetryObservation)
atom:preflight-auth-fail     -> GovernanceViolationSignal

# Infrastructure
infra:queue-retry-exhausted  -> RegressionRiskSignal
infra:arango-connection-failure -> ValidationFailure (TelemetryObservation)
infra:llm-api-401            -> GovernanceViolationSignal
infra:llm-api-429            -> PolicyFrictionSignal
infra:token-budget-exceeded  -> CostObservation (TelemetryObservation)

# Orientation / memory
orientation:governance-recommendation -> PolicyFrictionSignal
orientation:crp-created      -> EvidenceGapSignal
orientation:memory-curation-failed   -> ValidationFailure (TelemetryObservation)

# External
external:human-signal        -> HumanCorrection (TelemetryObservation)
external:ci-cd-event         -> TestResult (TelemetryObservation)

# Drift (computed, not observed)
drift:orl-success-rate-declining     -> ModelMismatchSignal
drift:atom-pass-rate-declining       -> WorkGraphInstabilitySignal
drift:latency-increasing             -> LatencyObservation (TelemetryObservation)
drift:cost-trending-up               -> CostObservation (TelemetryObservation)
drift:model-reliability-changing     -> ModelMismatchSignal
drift:prompt-effectiveness-declining -> PromptDriftSignal
drift:feedback-loop-deepening        -> RegressionRiskSignal
```

**Coverage of all 11 ontology Signal classes:**

| Ontology Signal Class | Implementation Signals |
|---|---|
| PromptDriftSignal | `drift:prompt-effectiveness-declining` |
| ContractFragilitySignal | `synthesis:gate1-failed` |
| PassInefficiencySignal | (no current source -- see Section 6) |
| ModelMismatchSignal | `synthesis:orl-degradation`, `drift:orl-success-rate-declining`, `drift:model-reliability-changing` |
| EvidenceGapSignal | `synthesis:low-confidence`, `orientation:crp-created` |
| WorkGraphInstabilitySignal | `synthesis:atom-failed`, `synthesis:verdict-fail`, `drift:atom-pass-rate-declining` |
| CapabilityGapSignal | (no current source -- see Section 6) |
| PolicyFrictionSignal | `infra:llm-api-429`, `orientation:governance-recommendation` |
| RegressionRiskSignal | `coordinator:fiber-recovered`, `infra:queue-retry-exhausted`, `drift:feedback-loop-deepening` |
| LearningOpportunitySignal | `synthesis:pr-candidate`, `orientation:pattern-detected`, `orientation:lesson-promoted` |
| GovernanceViolationSignal | `atom:preflight-auth-fail`, `infra:llm-api-401`, `governance:escalation-created` |

---

## 4. Governor Event Router

The lookup table the Governor uses to route signals to actions. This
is the deterministic core -- the LLM proposes, this table constrains.

```typescript
export const SIGNAL_ROUTER: Record<string, {
  governorAction: GovernanceAction
  trigger: 'event' | 'cron' | 'both'
  autoApprove: boolean
  maxDepth: number
  description: string
}> = {
  // ── A. Synthesis Signals ──────────────────────────────────────
  'synthesis:atom-failed': {
    governorAction: 'trigger_pipeline',
    trigger: 'event',
    autoApprove: true,
    maxDepth: 3,
    description: 'Retry failed atom via new pipeline run',
  },
  'synthesis:gate1-failed': {
    governorAction: 'diagnose_failure',
    trigger: 'event',
    autoApprove: false,
    maxDepth: 3,
    description: 'Structural compilation failure -- diagnose root cause',
  },
  'synthesis:verdict-fail': {
    governorAction: 'escalate_to_human',
    trigger: 'event',
    autoApprove: false,
    maxDepth: 3,
    description: 'Monolithic synthesis failure -- requires investigation',
  },
  'synthesis:low-confidence': {
    governorAction: 'diagnose_failure',
    trigger: 'cron',
    autoApprove: false,
    maxDepth: 2,
    description: 'Low-confidence pass -- investigate quality concerns',
  },
  'synthesis:orl-degradation': {
    governorAction: 'trigger_pipeline',
    trigger: 'event',
    autoApprove: true,
    maxDepth: 3,
    description: 'High repair count indicates systemic issue -- retry',
  },
  'synthesis:pr-candidate': {
    governorAction: 'no_action',
    trigger: 'event',
    autoApprove: false,
    maxDepth: 1,
    description: 'PR auto-generated by feedback handler -- Governor monitors',
  },

  // ── B. Pipeline Lifecycle Signals ─────────────────────────────
  'pipeline:created': {
    governorAction: 'no_action',
    trigger: 'cron',
    autoApprove: false,
    maxDepth: 0,
    description: 'Informational -- new pipeline instantiated',
  },
  'pipeline:approved': {
    governorAction: 'no_action',
    trigger: 'cron',
    autoApprove: false,
    maxDepth: 0,
    description: 'Informational -- pipeline approved through gate',
  },
  'pipeline:rejected': {
    governorAction: 'archive_signal',
    trigger: 'cron',
    autoApprove: false,
    maxDepth: 0,
    description: 'Architect rejected -- archive the originating signal',
  },
  'pipeline:synthesis-timeout': {
    governorAction: 'escalate_to_human',
    trigger: 'event',
    autoApprove: false,
    maxDepth: 0,
    description: 'Synthesis took >30 minutes -- infrastructure issue',
  },

  // ── C. Coordinator / Atom Signals ─────────────────────────────
  'coordinator:phase1-complete': {
    governorAction: 'no_action',
    trigger: 'cron',
    autoApprove: false,
    maxDepth: 0,
    description: 'Informational -- Phase 1 planning complete, atoms dispatched',
  },
  'coordinator:alarm-fired': {
    governorAction: 'diagnose_failure',
    trigger: 'event',
    autoApprove: false,
    maxDepth: 0,
    description: 'DO wall-clock timeout -- atom execution too slow',
  },
  'coordinator:fiber-recovered': {
    governorAction: 'diagnose_failure',
    trigger: 'event',
    autoApprove: false,
    maxDepth: 0,
    description: 'DO evicted and recovered -- check infrastructure health',
  },
  'atom:preflight-auth-fail': {
    governorAction: 'escalate_to_human',
    trigger: 'event',
    autoApprove: false,
    maxDepth: 0,
    description: 'Missing API key -- deployment config issue',
  },

  // ── D. Infrastructure Signals ─────────────────────────────────
  'infra:queue-processing-error': {
    governorAction: 'diagnose_failure',
    trigger: 'cron',
    autoApprove: false,
    maxDepth: 0,
    description: 'Queue message processing threw an error',
  },
  'infra:queue-retry-exhausted': {
    governorAction: 'escalate_to_human',
    trigger: 'cron',
    autoApprove: false,
    maxDepth: 0,
    description: 'Queue message failed all retries -- data may be lost',
  },
  'infra:arango-connection-failure': {
    governorAction: 'escalate_to_human',
    trigger: 'cron',
    autoApprove: false,
    maxDepth: 0,
    description: 'ArangoDB unreachable -- Factory is blind',
  },
  'infra:llm-api-401': {
    governorAction: 'escalate_to_human',
    trigger: 'event',
    autoApprove: false,
    maxDepth: 0,
    description: 'API key invalid or expired -- all synthesis blocked',
  },
  'infra:llm-api-429': {
    governorAction: 'adjust_config',
    trigger: 'cron',
    autoApprove: false,
    maxDepth: 0,
    description: 'Rate limited -- consider reducing pipeline concurrency',
  },
  'infra:llm-api-500': {
    governorAction: 'no_action',
    trigger: 'cron',
    autoApprove: false,
    maxDepth: 0,
    description: 'Transient provider error -- monitor for persistence',
  },
  'infra:token-budget-exceeded': {
    governorAction: 'adjust_config',
    trigger: 'cron',
    autoApprove: false,
    maxDepth: 0,
    description: 'Token usage above budget -- adjust limits or escalate',
  },
  'infra:github-api-failure': {
    governorAction: 'diagnose_failure',
    trigger: 'cron',
    autoApprove: false,
    maxDepth: 0,
    description: 'GitHub PR creation failed -- check token and permissions',
  },

  // ── E. Orientation / Memory Signals ───────────────────────────
  'orientation:memory-curation-complete': {
    governorAction: 'no_action',
    trigger: 'cron',
    autoApprove: false,
    maxDepth: 0,
    description: 'Informational -- memory curation cycle finished',
  },
  'orientation:memory-curation-failed': {
    governorAction: 'diagnose_failure',
    trigger: 'cron',
    autoApprove: false,
    maxDepth: 0,
    description: 'Memory curation failed -- check LLM or data quality',
  },
  'orientation:governance-recommendation': {
    governorAction: 'escalate_to_human',
    trigger: 'cron',
    autoApprove: false,
    maxDepth: 0,
    description: 'Curation produced systemic recommendation -- human review',
  },
  'orientation:crp-created': {
    governorAction: 'diagnose_failure',
    trigger: 'cron',
    autoApprove: false,
    maxDepth: 0,
    description: 'Low-confidence artifact flagged for review',
  },

  // ── F. External Signals ───────────────────────────────────────
  'external:human-signal': {
    governorAction: 'trigger_pipeline',
    trigger: 'event',
    autoApprove: false,
    maxDepth: 0,
    description: 'Human-submitted signal -- always requires approval',
  },
  'external:ci-cd-event': {
    governorAction: 'diagnose_failure',
    trigger: 'event',
    autoApprove: false,
    maxDepth: 0,
    description: 'CI pipeline event -- diagnose on failure',
  },

  // ── G. Drift Signals (cron-only) ──────────────────────────────
  'drift:orl-success-rate-declining': {
    governorAction: 'escalate_to_human',
    trigger: 'cron',
    autoApprove: false,
    maxDepth: 0,
    description: 'ORL success rate trend is negative -- systemic issue',
  },
  'drift:atom-pass-rate-declining': {
    governorAction: 'escalate_to_human',
    trigger: 'cron',
    autoApprove: false,
    maxDepth: 0,
    description: 'Atom pass rate dropping -- quality regression',
  },
  'drift:latency-increasing': {
    governorAction: 'adjust_config',
    trigger: 'cron',
    autoApprove: false,
    maxDepth: 0,
    description: 'Synthesis latency growing -- check model/infrastructure',
  },
  'drift:cost-trending-up': {
    governorAction: 'escalate_to_human',
    trigger: 'cron',
    autoApprove: false,
    maxDepth: 0,
    description: 'Token costs exceeding trend -- budget review needed',
  },
  'drift:model-reliability-changing': {
    governorAction: 'adjust_config',
    trigger: 'cron',
    autoApprove: false,
    maxDepth: 0,
    description: 'Specific model error rate changing -- consider re-routing',
  },
  'drift:prompt-effectiveness-declining': {
    governorAction: 'escalate_to_human',
    trigger: 'cron',
    autoApprove: false,
    maxDepth: 0,
    description: 'PromptPact output quality declining -- prompt review needed',
  },
  'drift:feedback-loop-deepening': {
    governorAction: 'escalate_to_human',
    trigger: 'cron',
    autoApprove: false,
    maxDepth: 0,
    description: 'Feedback loops not resolving -- structural issue',
  },
}
```

---

## 5. Lifecycle Transitions as Signals

The lifecycle state machine (`lifecycle.ts`) produces transitions that
should be observable as signals. These map to the existing lifecycle
states:

```
proposed -> designed -> in_progress -> implemented -> verified -> monitored -> retired
```

| Transition | Signal Type | Ontology Class | Governor Action |
|---|---|---|---|
| `proposed -> designed` | `lifecycle:designed` | TraceEvent | `no_action` |
| `designed -> in_progress` | `lifecycle:in-progress` | TraceEvent | `no_action` |
| `in_progress -> implemented` | `lifecycle:implemented` | TraceEvent | `no_action` |
| `implemented -> verified` | `lifecycle:verified` | TraceEvent | `no_action` |
| `verified -> monitored` | `lifecycle:monitored` | TraceEvent | `no_action` |
| `monitored -> retired` | `lifecycle:retired` | PolicyDecision | `archive_signal` |
| Gate 2 fail (blocks `implemented -> verified`) | `lifecycle:gate2-blocked` | ContractFragilitySignal | `diagnose_failure` |
| Gate 3 fail (blocks `verified -> monitored`) | `lifecycle:gate3-blocked` | ContractFragilitySignal | `escalate_to_human` |

**Note:** Lifecycle transitions are currently fire-and-forget writes to
ArangoDB. They do not emit queue messages. The Governor detects stalled
lifecycles during its cron cycle via AQL trend queries.

---

## 6. Missing Signals -- What the Factory SHOULD Produce

Signals the Factory does not currently emit but needs for complete
Governor observability. Each entry identifies what code change would
produce the signal.

### 6.1 Critical (needed for Phase 1 Governor)

| Missing Signal | Why | Where to Instrument | Priority |
|---|---|---|---|
| `infra:token-budget-exceeded` | Governor cannot detect cost overruns | `coordinator.ts` after `finalState.tokenUsage` check | Critical |
| `infra:queue-depth-growing` | Silent backlog accumulation | `index.ts` queue consumer, check `batch.messages.length` on each call | Critical |
| `infra:llm-api-401` | Auth failures are invisible | `model-bridge.ts` and `model-bridge-do.ts` response handling | Critical |
| `infra:llm-api-429` | Rate limiting is invisible | `model-bridge.ts` and `model-bridge-do.ts` response handling | Critical |

### 6.2 High (needed for Phase 2 Governor)

| Missing Signal | Why | Where to Instrument | Priority |
|---|---|---|---|
| `orientation:pattern-detected` | Governor cannot see new patterns | `memory-curator-agent.ts` persist() after pattern_library UPSERT | High |
| `infra:pr-generation-succeeded` | No positive confirmation of PR creation | `index.ts` feedback-signals consumer, after `generatePR` returns | High |
| `infra:pr-generation-failed` | Silent PR failures | `index.ts` feedback-signals consumer, catch block | High |
| `drift:stale-signal-aging` | Signals older than N days without action | Governor cron cycle AQL query against `specs_signals` | High |

### 6.3 Medium (needed for Phase 3+ Governor)

| Missing Signal | Why | Where to Instrument | Priority |
|---|---|---|---|
| `orientation:lesson-promoted` | Lesson-to-mentor-rule pipeline not built yet | Future: mentor rule promotion logic | Medium |
| `drift:pass-inefficiency` | No signal for "pass is too slow/expensive" | Governor cron: compare pass duration against baseline | Medium |
| `drift:capability-gap` | No signal for "the Factory tried to do X but cannot" | `propose-function.ts` when it hits a capability not in ontology | Medium |
| `external:github-webhook` | No inbound integration from GitHub events | Future: webhook handler in `index.ts` | Medium |

### 6.4 Ontology Gaps

Two ontology Signal classes have no implementation coverage:

| Ontology Class | Status | Recommendation |
|---|---|---|
| `PassInefficiencySignal` | No source | Instrument when the Governor can compute "this pass took too long relative to its complexity" |
| `CapabilityGapSignal` | No source | Instrument when `propose-function.ts` encounters a capability not in the Factory's known capability set |

---

## 7. Closed-World Guarantee

The Governor may encounter a signal whose `subtype` field does not match
any key in `SIGNAL_ROUTER`. This can happen when:

1. A new feedback signal type is added without updating this taxonomy
2. A human submits a signal with a custom subtype
3. A bug produces a malformed subtype string

### 7.1 Fallback Policy

```typescript
const CLOSED_WORLD_FALLBACK: {
  governorAction: GovernanceAction
  trigger: 'cron'
  autoApprove: false
  maxDepth: 0
  description: string
} = {
  governorAction: 'escalate_to_human',
  trigger: 'cron',
  autoApprove: false,
  maxDepth: 0,
  description: 'Unknown signal type -- escalating for human classification',
}
```

### 7.2 Handling Logic

```typescript
function routeSignal(subtype: string): SignalRoute {
  const route = SIGNAL_ROUTER[subtype]
  if (route) return route

  // Closed-world violation: log telemetry + escalate
  console.warn(`[Governor] Unknown signal subtype: ${subtype} -- applying closed-world fallback`)

  // Write telemetry so the pattern is observable
  // db.save('orl_telemetry', {
  //   schemaName: '_closed_world_violation',
  //   success: false,
  //   failureMode: 'unknown_signal_type',
  //   timestamp: new Date().toISOString(),
  //   unknownSubtype: subtype,
  // })

  return CLOSED_WORLD_FALLBACK
}
```

### 7.3 Why Escalate (not Reject or Ignore)

- **Rejecting** would silently drop potentially important signals.
  A novel signal type might indicate a Factory evolution that the
  taxonomy has not caught up with.
- **Ignoring** (no_action) would mask a taxonomy gap. The Governor
  would appear healthy while blind spots accumulate.
- **Escalating** ensures a human reviews the new signal type and
  either adds it to the taxonomy or identifies the bug that produced it.

Every closed-world violation is itself a signal: the taxonomy needs
updating. This is a self-healing property -- the Factory's governance
layer detects its own incompleteness.

---

## 8. Queue-to-Signal Mapping

The Factory uses four Cloudflare Queues. This maps each queue and
message type to the signal taxonomy:

| Queue | Message Type | Taxonomy Signal | Handler |
|---|---|---|---|
| `SYNTHESIS_QUEUE` | (default: coordinator dispatch) | `coordinator:synthesis-complete` | `index.ts` queue consumer dispatches to DO |
| `SYNTHESIS_QUEUE` | `type: 'atom-execute'` | `atom:complete-pass` or `atom:complete-fail` | `index.ts` queue consumer dispatches to AtomExecutor DO |
| `SYNTHESIS_RESULTS` | (default: verdict relay) | `coordinator:synthesis-complete` | `index.ts` queue consumer relays to Workflow via sendEvent |
| `SYNTHESIS_RESULTS` | `type: 'phase1-complete'` | `coordinator:phase1-complete` | `index.ts` queue consumer logs and acks |
| `ATOM_RESULTS` | (default: atom completion) | `atom:complete-pass` or `atom:complete-fail` | `index.ts` atom-results consumer updates ledger |
| `FEEDBACK_QUEUE` | (default: synthesis result) | Produces 0-N synthesis signals | `index.ts` feedback-signals consumer runs `generateFeedbackSignals` |
| `FEEDBACK_QUEUE` | `type: 'memory-curation'` | `orientation:memory-curation-complete` or `orientation:memory-curation-failed` | `index.ts` feedback-signals consumer runs `MemoryCuratorAgent.curate()` |
| `FEEDBACK_QUEUE` | `type: 'governor-cycle'` | `governance:cycle-complete` or `governance:cycle-failed` | Future: `index.ts` feedback-signals consumer runs `GovernorAgent.assess()` |

---

## 9. Signal Flow Diagram

```
                    EXTERNAL SOURCES
                         |
                    [POST /pipeline]
                         |
                         v
                  +------+------+
                  | SignalInput  |   <-- external:human-signal
                  +------+------+
                         |
              ingest-signal.ts (idempotency)
                         |
                         v
               +---------+---------+
               | FactoryPipeline   |
               | (Workflow)        |
               |                   |
               | Stage 1: ingest   |  <-- pipeline:created
               | Stage 2: pressure |
               | Stage 3: map cap  |
               | Stage 4: propose  |
               | [approval gate]   |  <-- pipeline:approved / pipeline:rejected
               | semantic-review   |
               | Stage 5: compile  |
               | Gate 1            |  <-- synthesis:gate1-failed
               | Stage 6: synth    |  <-- pipeline:synthesis-enqueued
               +---------+---------+
                         |
                    SYNTHESIS_QUEUE
                         |
            +------------+------------+
            |                         |
  +---------v---------+     +---------v---------+
  | SynthesisCoordinator    | AtomExecutor DOs  |
  | (Phase 1: plan)   |    | (Phase 2: execute)|
  |                    |    |                   |
  | alarm -> timeout   |    | alarm -> timeout  |  <-- coordinator:alarm-fired / atom:alarm-fired
  | fiber -> recovered |    | preflight -> fail |  <-- coordinator:fiber-recovered / atom:preflight-auth-fail
  +--------+-----------+    +--------+----------+
           |                         |
      SYNTHESIS_RESULTS         ATOM_RESULTS
           |                         |
           +--------> Workflow <-----+
                         |
                   Pipeline Result
                         |
                    FEEDBACK_QUEUE
                         |
              +----------+----------+
              |                     |
    +---------v---------+  +--------v---------+
    | generateFeedback  |  | MemoryCurator    |
    | Signals           |  | Agent            |
    | (6 signal types)  |  |                  |
    +---------+---------+  +--------+---------+
              |                     |
         specs_signals         memory_curated
         (ArangoDB)            pattern_library
              |                orientation_assessments
              |                     |
              +----------+----------+
                         |
                    GovernorAgent
                    (cron + queue)
                         |
              +----------+----------+
              |          |          |
         trigger    approve    escalate
         pipeline   pipeline   to human
```

---

## 10. Signal Count Summary

| Category | Currently Emitted | Currently Implicit | Not Yet Instrumented | Total |
|---|---|---|---|---|
| A. Synthesis | 6 | 0 | 0 | 6 |
| B. Pipeline Lifecycle | 0 | 7 | 0 | 7 |
| C. Coordinator / Atom | 2 (queue messages) | 7 | 0 | 9 |
| D. Infrastructure | 0 | 0 | 10 | 10 |
| E. Orientation / Memory | 1 (queue message) | 2 | 6 | 9 |
| F. External | 1 (HTTP) | 0 | 3 | 4 |
| G. Drift | 0 | 0 | 7 | 7 |
| **Total** | **10** | **16** | **26** | **52** |

The Governor's initial implementation (Phase 1) needs the 10 currently
emitted signals plus the 4 critical missing signals from Section 6.1.
The remaining 38 signals are needed for Phase 2+ maturity.

---

## 11. Versioning

This taxonomy is versioned alongside the Governor PromptPact. When a new
signal type is added to the Factory:

1. Add it to this taxonomy (section 2)
2. Map it to an ontology class (section 3)
3. Add it to the SIGNAL_ROUTER (section 4)
4. Update the Governor system prompt if the signal requires new
   decision logic
5. Increment the taxonomy version

Current version: `v1.0.0`

Changes to this file MUST be reviewed by the Architect agent before
deployment. This is the Governor's decision space -- getting it wrong
means the Governor is either blind (missing signal) or hallucinating
(acting on non-existent signal).
