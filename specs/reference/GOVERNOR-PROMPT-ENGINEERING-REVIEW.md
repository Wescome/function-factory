# GovernorAgent Prompt Engineering Review

> Grounded in: _Prompt Engineering for Generative AI_ (Phoenix & Taylor, O'Reilly 2024)
>
> Target: `DESIGN-GOVERNOR-AGENT.md` sections 9 (System Prompt), 3 (PromptPact), 10 (Implementation)
>
> Reviewer: Architect Agent, 2026-04-29

---

## Executive Summary

The current GovernorAgent system prompt is functional but underengineered
relative to the techniques documented in Phoenix & Taylor. It commits three
of the five "naive prompt" sins from Chapter 1: **missing examples** (zero-shot
for a classification problem), **limited evaluation** (no self-eval step),
and **no task division** (a single monolithic prompt handles triage, diagnosis,
classification, assessment, and formatting simultaneously).

This review maps every applicable book technique to a concrete design
improvement, with before/after prompt fragments.

---

## 1. Five Principles of Prompting -- Applied to GovernorAgent

### 1.1 Give Direction (Ch 1, pp. 28-33)

**Book principle:** "Describe the desired style in detail, or reference a
relevant persona." Role-playing with a specific identity changes output
probability distributions dramatically. The book also recommends
"prewarming" -- asking the model for best practices then following its own
advice.

**Current state:** The prompt opens with `You are the Governor` but gives no
persona depth. It describes *what* the Governor does but not *how* it thinks.
There is no cognitive framing for the decision-making style.

**Improvement: Add cognitive framing and decision-making persona.**

```
BEFORE:
You are the Governor -- the Factory's autonomous operational decision-maker.

AFTER:
You are the Governor -- the Factory's autonomous operational decision-maker.

You think like a seasoned operations manager at a 24/7 manufacturing plant.
Your default disposition is CONSERVATIVE: when uncertain, you do not act --
you escalate. You never confuse "I can classify this" with "I should act on
this." You treat every governance cycle as an audit: read the data, match it
against criteria, produce typed decisions. You do not speculate. You do not
infer intent. You cite evidence or you escalate.
```

**Rationale:** The book demonstrates (p. 29) that even small persona details
("in the style of Steve Jobs") dramatically shift output. The Governor needs
a *conservative operations* persona to counteract LLM tendencies toward
helpfulness and action bias. "Seasoned operations manager at a 24/7
manufacturing plant" is concrete enough to anchor behavior without being
fictional.

---

### 1.2 Specify Format (Ch 1, pp. 34-36; Ch 3, pp. 128-129)

**Book principle:** "Define what rules to follow, and the required structure
of the response." JSON is recommended for production use because broken JSON
triggers a parsing error, which acts as a retry signal.

**Current state:** The prompt ends with a JSON schema template. This is good.
However, the schema is embedded as inline example text with placeholder
values, not as a formal schema definition with field-level constraints. The
model sees `"pending_signal_count": 0` and may treat 0 as the expected
value rather than as a type indicator.

**Improvement: Separate schema definition from example, add explicit field constraints.**

```
BEFORE:
Respond with ONLY a JSON object matching the GovernanceCycleResult schema:
{
  "cycle_id": "gov-{timestamp}",
  ...
  "metrics_snapshot": {
    "pending_signal_count": 0,
    ...
  }
}

AFTER:
OUTPUT FORMAT:
Respond with ONLY a valid JSON object. No markdown fencing. No commentary.

SCHEMA (all fields required):
- cycle_id: string, format "gov-{ISO8601}"
- timestamp: string, ISO 8601
- decisions: array of GovernanceDecision objects (may be empty, never null)
- assessment: GovernanceAssessment object (always exactly one)
- escalations: array of EscalationEntry objects (may be empty, never null)
- metrics_snapshot: MetricsSnapshot object (all fields are numbers derived
  from the context data above -- do not guess, compute from what you see)

GovernanceDecision fields:
  action: one of "trigger_pipeline" | "approve_pipeline" |
    "escalate_to_human" | "diagnose_failure" | "adjust_config" |
    "archive_signal" | "deduplicate_signal" | "no_action"
  target: string -- the _key of the signal, pipeline, or config entry
  reason: string -- must reference specific evidence from the context
  evidence: array of strings -- _keys of data points supporting this decision
  risk_level: one of "safe" | "moderate" | "high"
  executed: boolean -- always false (execution happens after validation)

GovernanceAssessment fields:
  situation_frame: string, one paragraph, grounded in metrics
  operational_health: one of "healthy" | "degraded" | "critical"
  top_risks: array of strings, max 5, ordered by severity
  top_opportunities: array of strings, max 3
  trend: one of "improving" | "stable" | "degrading"
  evidence_summary: string -- cite specific numbers from the context
```

**Rationale:** The book notes (p. 35) that leaving JSON "uncompleted" can
help, but for production, explicit field-by-field constraints with types and
enums produce more reliable output than example-based templates where the
model might interpolate placeholder values.

---

### 1.3 Provide Examples (Ch 1, pp. 37-39; Ch 3, pp. 134-136)

**Book principle:** "Insert a diverse set of test cases where the task was
done correctly." Zero-shot accuracy can be 10%; one-shot can reach 50% (GPT-3
paper cited on p. 37). For classification tasks, few-shot examples are
especially impactful (p. 134).

**Current state:** The Governor prompt is entirely zero-shot. It describes
criteria textually but provides no examples of correct governance decisions.
This is the single largest gap.

**Improvement: Add 3 few-shot examples covering the three primary decision paths.**

These examples should be appended to the system prompt after the criteria
sections and before the output schema:

```
GOVERNANCE DECISION EXAMPLES:

Example 1 -- Auto-trigger (safe action):
Context excerpt:
  Pending signal SIG-2847: subtype "synthesis:atom-failed",
  source "factory:feedback-loop", feedbackDepth 1, autoApprove true,
  age 22 minutes. No cooldown violation.
Correct decision:
{
  "action": "trigger_pipeline",
  "target": "SIG-2847",
  "reason": "Signal meets all four auto-trigger criteria: source is
    factory:feedback-loop, feedbackDepth (1) < 3, autoApprove is true,
    no cooldown violation for this workGraphId+subtype.",
  "evidence": ["SIG-2847"],
  "risk_level": "safe",
  "executed": false
}

Example 2 -- Escalation (unsafe, requires human):
Context excerpt:
  ORL telemetry shows GovernanceCycleResult schema at 42% success rate
  over 24h (was 89% yesterday). 5 failures in last 6 cycles.
Correct decision:
{
  "action": "escalate_to_human",
  "target": "GovernanceCycleResult",
  "reason": "ORL success rate for GovernanceCycleResult dropped to 42%
    over 24h, below the 50% escalation threshold. 5 of last 6 cycles
    failed. This indicates a structural issue requiring human diagnosis.",
  "evidence": ["orl_GovernanceCycleResult_7day", "cycle_failure_trend"],
  "risk_level": "high",
  "executed": false
}

Example 3 -- No action (criteria not met):
Context excerpt:
  Pending signal SIG-3021: subtype "architecture:drift-detected",
  source "factory:orientation-agent", feedbackDepth 0, autoApprove false,
  age 4 hours.
Correct decision:
{
  "action": "no_action",
  "target": "SIG-3021",
  "reason": "Signal source is not factory:feedback-loop and autoApprove
    is false. Does not meet auto-trigger criteria. Signal is architectural
    in nature but severity does not meet escalation threshold yet
    (pending < 48h). Will be re-evaluated next cycle.",
  "evidence": ["SIG-3021"],
  "risk_level": "moderate",
  "executed": false
}
```

**Rationale:** The book emphasizes (p. 38) that 1-3 examples "almost always
has a positive effect" while beyond 3-5 you sacrifice creativity for
reliability. For the Governor, reliability is paramount -- we want the model
constrained to the decision algebra, not creative. Three examples covering
the three primary paths (act/escalate/no-action) establish the decision
pattern without excessive token cost.

**Token budget impact:** Approximately 600 tokens. Current prompt is ~1,200
tokens. With examples, ~1,800 tokens. Well within the 16,000-token context
budget.

---

### 1.4 Evaluate Quality (Ch 1, pp. 40-50; Ch 3, pp. 137-139)

**Book principle:** "Identify errors and rate responses, testing what drives
performance." The book recommends: (a) A/B testing prompts, (b) using a more
sophisticated model to evaluate a smaller model, (c) programmatic evaluation
(classification accuracy, hallucination detection, cost tracking).

**Current state:** The design has an `evaluation_contract` with success
metrics (decision validity >= 0.95, missed escalation <= 0.01) but no
mechanism to evaluate individual cycle outputs. The ORL pipeline validates
JSON structure but not decision quality.

**Improvement A: Add a post-hoc decision validator (deterministic).**

```typescript
// After ORL parsing, before execution:
function validateDecisionQuality(
  result: GovernanceCycleResult,
  ctx: GovernorContext,
): ValidationResult {
  const issues: string[] = []

  for (const d of result.decisions) {
    // 1. Evidence must reference real keys from context
    for (const key of d.evidence) {
      const exists =
        ctx.pending_signals.some(s => s._key === key) ||
        ctx.active_pipelines.some(p => p._key === key) ||
        ctx.orl_telemetry.some(t => t.schemaName === key)
      if (!exists) {
        issues.push(`Decision ${d.target}: evidence key "${key}" not found in context`)
      }
    }

    // 2. trigger_pipeline decisions must target a real pending signal
    if (d.action === 'trigger_pipeline') {
      const signal = ctx.pending_signals.find(s => s._key === d.target)
      if (!signal) {
        issues.push(`trigger_pipeline targets "${d.target}" which is not a pending signal`)
      }
    }

    // 3. No decision should have empty reason
    if (!d.reason || d.reason.length < 20) {
      issues.push(`Decision ${d.target}: reason is missing or too short`)
    }
  }

  // 4. metrics_snapshot sanity check
  const ms = result.metrics_snapshot
  if (ms.pending_signal_count !== ctx.pending_signals.length) {
    issues.push(
      `metrics_snapshot.pending_signal_count (${ms.pending_signal_count}) ` +
      `does not match actual pending signals (${ctx.pending_signals.length})`
    )
  }

  return { valid: issues.length === 0, issues }
}
```

**Improvement B: Track decision quality metrics over time.**

Add to the cycle telemetry:

```typescript
// In persist():
await db.save('orl_telemetry', {
  schemaName: '_governance_decision_quality',
  // ...existing fields...
  evidenceHitRate: validResult.evidenceHits / validResult.evidenceTotal,
  hallucatedTargets: validResult.issues.filter(i => i.includes('not found')).length,
  reasonAvgLength: avgReasonLength(result.decisions),
})
```

**Rationale:** The book's evaluation chapter (pp. 40-50) emphasizes that
production prompts need programmatic evaluation beyond manual review.
Classification accuracy, hallucination detection (invented keys), and
consistency metrics are all applicable. The Governor's decisions are
verifiable against the context it received -- this is a rare luxury that
should be exploited.

---

### 1.5 Divide Labor (Ch 1, pp. 52-58; Ch 3, p. 130)

**Book principle:** "Split tasks into multiple steps, chained together for
complex goals." The book emphasizes that single prompts doing too much
produce less deterministic results. Even "Let's think step by step" improves
reasoning. The chapter specifically calls out meta prompting and self-
evaluation chains.

**Current state:** The Governor prompt asks the LLM to simultaneously:
1. Parse and prioritize signals
2. Match signals against auto-trigger/approve criteria
3. Detect ORL anomalies
4. Diagnose silent failures
5. Deduplicate signals
6. Produce an operational assessment
7. Format everything as a single JSON object

This is a 7-task monolith in a single prompt. The book explicitly warns
(p. 52) that this leads to less deterministic results and more
hallucinations.

**Improvement: Add explicit chain-of-thought scaffolding within the prompt.**

The Governor runs as a single LLM call per cycle (intentional design
constraint for cost and latency). We cannot add multi-step chaining without
breaking the 120-second cycle budget. However, we CAN add internal
chain-of-thought structure within the single prompt.

```
BEFORE:
GOVERNANCE RULES:
1. TRIAGE -- review all pending signals...
2. ACT ON SAFE...
...
Respond with ONLY a JSON object...

AFTER:
REASONING PROCESS (follow these steps in order):

Step 1 -- METRICS: Compute the metrics_snapshot from the raw data above.
  Count pending signals, active pipelines, completions, failures. These
  are facts, not judgments.

Step 2 -- TRIAGE: For each pending signal, evaluate it against the
  auto-trigger criteria. List which criteria are met and which are not.
  This is a boolean checklist, not a judgment call.

Step 3 -- PIPELINES: For each active pipeline waiting at architect-approval,
  evaluate it against auto-approve criteria. Same boolean checklist.

Step 4 -- ANOMALIES: Scan ORL telemetry for any schema with success rate
  below 50% over 24h, or any trend that has degraded by more than 20
  percentage points in 7 days. Check for escalation triggers.

Step 5 -- DIAGNOSIS: Look for silent failures -- signals older than 48h
  with no pipeline, pipelines older than 24h with no completion,
  feedback loops at max depth (3).

Step 6 -- DECISIONS: Based on steps 2-5, produce your decisions array.
  Each decision must cite evidence from the steps above.

Step 7 -- ASSESSMENT: Based on all of the above, write the situation_frame
  and determine operational_health, trend, risks, and opportunities.

OUTPUT: Produce the final JSON object containing all fields from steps 1-7.
  Do not include your reasoning steps in the output -- only the JSON.
```

**Rationale:** The book's "Give GPTs Thinking Time" section (p. 130) shows
that explicit step-by-step instructions improve accuracy even within a single
prompt. The Governor's task decomposes naturally into a pipeline: metrics
first (pure computation), then classification (criteria matching), then
synthesis (assessment). This ordering ensures the model has its own computed
facts available before making judgments.

**Important:** The "Do not include your reasoning steps in the output"
instruction uses the "inner monologue" technique from p. 131. The model
reasons through the steps but outputs only the final JSON. This gives us
chain-of-thought benefits without parsing overhead.

---

## 2. Self-Eval and Meta Prompting -- Applied to GovernorAgent

### 2.1 Self-Evaluation (Ch 3, pp. 132-133)

**Book principle:** "Critique a generated LLM output and ask whether the LLM
missed any information or important facts." The book shows iterative
refinement where the model evaluates its own output.

**Current state:** No self-evaluation. The Governor produces output in one
pass, and it is accepted or rejected by ORL parsing.

**Improvement: Add a self-validation step within the prompt.**

Insert after the reasoning process steps, before the output instruction:

```
Step 8 -- SELF-CHECK: Before producing your final output, verify:
  a. Every decision with action "trigger_pipeline" has a target that
     appears in the Pending Signals list above.
  b. Every decision with action "approve_pipeline" has a target that
     appears in the Active Pipelines list above.
  c. Every evidence array contains only _keys that appear in the context
     data above. Do not invent keys.
  d. The metrics_snapshot numbers match the counts you can verify from
     the context data.
  e. If any escalation triggers are met (listed above), there is at least
     one escalation entry OR a decision explaining why escalation is not
     needed.
  f. You have not proposed more than 5 trigger_pipeline decisions.
  g. You have not proposed any action that is listed under "YOU CANNOT."

If any check fails, fix the issue before producing output.
```

**Rationale:** The book's self-eval pattern (pp. 132-133) is directly
applicable. The Governor's decisions are checkable against its own input --
the model can verify that evidence keys exist in the context, that targets
are real signals, and that escalation triggers are not missed. This is
cheaper and faster than a second LLM call and catches the most common
failure mode: hallucinated keys and targets.

---

### 2.2 Meta Prompting (Ch 3, pp. 140-144)

**Book principle:** "Meta prompting involves the creation of prompts that
generate other prompts." The technique is useful for adapting prompts to
changing contexts.

**Application to GovernorAgent:** Meta prompting is relevant for the
Governor's Phase 4 (Self-Tuning Governor). In the current Phase 1 design,
the prompt is static. However, a lightweight form of meta prompting is
already implied: the context-formatting function (`formatGovernorContext`)
dynamically constructs the user-message portion of the prompt.

**Recommendation for Phase 2+:** When the Governor begins adjusting its
own thresholds (auto-approve criteria, escalation thresholds), a meta-prompt
could generate the criteria section of the prompt based on the current
hot_config values. This keeps the criteria machine-readable and auditable:

```typescript
// Phase 2+: Dynamic criteria generation
function generateCriteriaSection(config: HotConfigEntry[]): string {
  const autoTriggerDepth = config.find(c => c._key === 'auto_trigger_max_depth')?.value ?? 3
  const cooldownMinutes = config.find(c => c._key === 'cooldown_minutes')?.value ?? 30
  const orlThreshold = config.find(c => c._key === 'orl_escalation_threshold')?.value ?? 0.5

  return `
AUTO-TRIGGER CRITERIA (all must be true):
- signal.source === 'factory:feedback-loop'
- signal.raw.feedbackDepth < ${autoTriggerDepth}
- signal.raw.autoApprove === true
- No cooldown violation (same workGraphId+subtype within ${cooldownMinutes} min)

ESCALATION TRIGGERS:
- ORL success rate < ${(orlThreshold * 100).toFixed(0)}% for any schema over 24h
...`
}
```

**Current phase impact:** None. Note for Phase 2+ evolution path.

---

### 2.3 Classification Techniques (Ch 3, pp. 134-137)

**Book principle:** Governance decisions are fundamentally a classification
problem. The book covers zero-shot vs few-shot classification and majority
voting.

**Current state:** The Governor performs zero-shot classification across 8
action types. This is the hardest form of classification for an LLM.

**Improvement A: Reframe governance as explicit classification.**

Add to the prompt after the reasoning steps:

```
DECISION CLASSIFICATION RULES:
For each pending signal, classify it into exactly one category:

1. AUTO-TRIGGER: All four auto-trigger criteria are met.
   -> action: "trigger_pipeline"

2. AUTO-APPROVE: Signal is waiting at architect-approval AND all three
   auto-approve criteria are met.
   -> action: "approve_pipeline"

3. STALE: Signal has been pending > 7 days with no auto-trigger match.
   -> action: "archive_signal"

4. DUPLICATE: Signal has same workGraphId+subtype as another pending
   signal created within 30 minutes.
   -> action: "deduplicate_signal"

5. ESCALATION-REQUIRED: Any escalation trigger is met.
   -> action: "escalate_to_human"

6. DIAGNOSABLE: A failure pattern is detectable from telemetry but does
   not meet escalation threshold.
   -> action: "diagnose_failure"

7. CONFIG-RESPONSIVE: Telemetry shows a measurable drift that can be
   addressed by adjusting a hot_config value within its safe range.
   -> action: "adjust_config"

8. NO-ACTION: Signal does not meet any of the above criteria.
   -> action: "no_action"

Evaluate criteria in this order. The first match wins. Do not skip ahead.
```

**Improvement B: Consider majority voting for high-risk decisions.**

The book's majority vote technique (pp. 136-137) could apply to escalation
decisions. In the current single-call design, this is not feasible. However,
for Phase 3 (Multi-Agent Governor), escalation decisions could be confirmed
by a second LLM call:

```typescript
// Phase 3: Majority vote for escalations
if (result.escalations.length > 0) {
  const confirmResult = await confirmEscalations(result.escalations, ctx, model)
  result.escalations = result.escalations.filter(e =>
    confirmResult.confirmed.includes(e.issue)
  )
}
```

**Current phase impact:** Improvement A is immediate. Improvement B is
Phase 3.

---

## 3. Autonomous Agents with Memory and Tools -- Applied to GovernorAgent

### 3.1 ReAct vs OpenAI Functions (Ch 6, pp. 227-242)

**Book principle:** ReAct is for multi-step reasoning with tool observation
loops. OpenAI Functions (tool calling) is for single-step tool invocation
with structured output.

**Current design:** The Governor uses neither pattern. It is a single LLM
call with structured JSON output. Tools (AQL queries, pipeline triggers) are
called deterministically outside the LLM, not by the LLM.

**Assessment: The current design is correct and should NOT adopt ReAct.**

Rationale:
- The Governor's tool calls (AQL queries) are **pre-fetched** before the LLM
  runs. This is intentional -- the LLM never has to decide what to query.
- The Governor's actions (trigger pipeline, approve gate) are **post-validated**
  deterministically. The LLM proposes, code validates.
- ReAct would give the LLM control over tool invocation, which violates the
  Governor's core safety property: deterministic action gates.
- The book's comparison table (p. 242) confirms: OpenAI Functions is
  preferred for "single tool execution" and "ease of implementation."

However, the Governor's pattern is actually **superior** to both ReAct and
Functions for this use case because it separates assessment from action
completely. The LLM's output is a recommendation, not an execution. This
is the correct architectural choice.

**Recommendation:** Document this as an explicit design decision in
DESIGN-GOVERNOR-AGENT.md section 10.4:

```
The Governor intentionally does NOT use ReAct or tool-calling patterns.
The LLM is an assessment engine, not an action engine. All tools are
invoked deterministically: context queries before the LLM call, action
execution after deterministic validation. This prevents prompt injection
or hallucination from triggering real-world side effects.
```

---

### 3.2 Memory Types (Ch 6, pp. 249-257)

**Book principle:** Five memory types are documented:
- ConversationBufferMemory (unlimited history)
- ConversationBufferWindowMemory (last K interactions)
- ConversationSummaryMemory (summarized history)
- ConversationSummaryBufferMemory (hybrid: summary + recent)
- ConversationTokenBufferMemory (token-limited buffer)

**Current design:** The Governor is stateless per cycle. Its "memory" is
ArangoDB -- specifically the `memory_curated` collection and the
`orientation_assessments` collection.

**Assessment: This maps to ConversationSummaryMemory.**

The `memory_curated` collection contains summarized patterns with confidence
scores and evidence counts. This is exactly the "summarized conversation"
pattern -- not raw history, but distilled lessons. The
`orientation_assessments` collection contains recent assessment summaries,
which is the "summary buffer" pattern.

**Improvement: Add a last-cycle summary to the Governor's context.**

The Governor currently has no memory of what it decided in the previous
cycle. This means it can re-propose the same decisions every 15 minutes
without knowing it already acted.

```
NEW AQL QUERY (Q9):

// Q9: Last governance cycle result -- what the Governor decided last time
db.query(`
  FOR a IN orientation_assessments
    FILTER a.type == 'governance_cycle'
    SORT a.createdAt DESC
    LIMIT 1
    RETURN {
      cycle_id: a.cycle_id,
      decisions_summary: a.decisions_summary,
      operational_health: a.assessment.operational_health,
      createdAt: a.createdAt
    }
`).catch(() => []),
```

Add to the formatted context:

```
### Previous Governance Cycle
- Cycle: {cycle_id} at {createdAt}
- Health: {operational_health}
- Decisions: {decisions_summary as bullet list}

Do not re-propose actions that were already executed in the previous cycle
unless new evidence has appeared since then.
```

**Rationale:** The book's memory chapter (pp. 249-257) emphasizes that even
simple memory dramatically improves agent behavior. The Governor's lack of
cycle-to-cycle memory is a gap that could cause redundant pipeline triggers
or repeated escalations. Adding the last cycle's decisions as context costs
approximately 200 tokens and prevents the most common redundancy failure.

---

### 3.3 Plan-and-Execute (Ch 6, pp. 259-260)

**Book principle:** Separate planning from execution into two modules, each
handled by a different LLM or process.

**Current design:** The Governor already implements this pattern, though it
is not labeled as such:
- **Plan:** LLM produces GovernanceCycleResult (the plan)
- **Execute:** Deterministic code validates and executes each decision

This is a correct application of Plan-and-Execute where the executor is
not an LLM but a deterministic validation engine.

**Recommendation:** Explicitly label this in the design document:

```
The Governor follows a Plan-and-Execute architecture (BabyAGI variant)
where:
- Planner = LLM (produces GovernanceCycleResult)
- Executor = deterministic code (validates against criteria, executes safe actions)
- The executor can REJECT planner decisions (this is the governance safety property)
```

---

### 3.4 Tree of Thoughts (Ch 6, pp. 260-261)

**Book principle:** ToT enables exploration of multiple reasoning paths with
self-assessment at each step. The book reports 4% to 74% accuracy improvement
on complex reasoning tasks.

**Application to GovernorAgent:** ToT is overkill for the Governor's current
decision space. The Governor's decisions are criteria-matching, not open-ended
reasoning. ToT would add latency and cost without proportional benefit.

**Phase 3+ consideration:** When the Governor evolves to diagnose complex
failure cascades (Phase 3: Multi-Agent Governor), ToT could be valuable for
the DriftDiagnosisAgent sub-agent, where multiple causal hypotheses should
be explored before committing to a diagnosis.

**Current phase impact:** None.

---

### 3.5 Callbacks (Ch 6, pp. 261-265)

**Book principle:** Use callbacks to monitor agent execution, track tokens,
and diagnose issues.

**Current design:** The Governor writes cycle telemetry to ArangoDB, which
serves the same purpose as callbacks.

**Improvement: Add token tracking to cycle telemetry.**

```typescript
// Track LLM token usage per cycle
await db.save('orl_telemetry', {
  schemaName: '_governance_cycle',
  // ...existing fields...
  inputTokens: llmResult.usage?.prompt_tokens ?? 0,
  outputTokens: llmResult.usage?.completion_tokens ?? 0,
  totalTokens: llmResult.usage?.total_tokens ?? 0,
  modelId: llmResult.model ?? 'unknown',
})
```

**Rationale:** The book emphasizes (pp. 264-266) that token tracking is
essential for cost management. The Governor runs 96 times/day. Tracking
tokens per cycle enables: (a) detecting context bloat, (b) validating the
16K context budget is not exceeded, (c) computing daily LLM cost.

---

## 4. Concrete Changes to DESIGN-GOVERNOR-AGENT.md

### Change 1: Rewrite System Prompt (Section 9)

Replace the current `GOVERNOR_SYSTEM_PROMPT` with the following improved
version that incorporates all applicable techniques:

```typescript
const GOVERNOR_SYSTEM_PROMPT = `You are the Governor -- the Factory's autonomous operational decision-maker.

You think like a seasoned operations manager at a 24/7 manufacturing plant. Your default disposition is CONSERVATIVE: when uncertain, do not act -- escalate. You never confuse "I can classify this" with "I should act on this." You treat every governance cycle as an audit: read the data, match against criteria, produce typed decisions. You do not speculate. You do not infer intent. You cite evidence or you escalate.

You run every 15 minutes inside Cloudflare. Your job: keep the Factory running without human intervention for routine operations. Escalate anything requiring human judgment.

---

DECISION CLASSIFICATION (evaluate in this order, first match wins):

1. AUTO-TRIGGER: signal.source === 'factory:feedback-loop' AND feedbackDepth < 3 AND autoApprove === true AND no cooldown violation (same workGraphId+subtype within 30 min)
   -> action: "trigger_pipeline"

2. AUTO-APPROVE: pipeline waiting at architect-approval AND signal.autoApprove === true AND signal.source === 'factory:feedback-loop' AND subtype in ['synthesis:atom-failed', 'synthesis:orl-degradation']
   -> action: "approve_pipeline"

3. STALE: signal pending > 7 days, no auto-trigger match
   -> action: "archive_signal"

4. DUPLICATE: same workGraphId+subtype as another pending signal within 30 min
   -> action: "deduplicate_signal"

5. ESCALATION-REQUIRED: any escalation trigger met (see below)
   -> action: "escalate_to_human"

6. DIAGNOSABLE: failure pattern detectable from telemetry, below escalation threshold
   -> action: "diagnose_failure"

7. CONFIG-RESPONSIVE: measurable drift addressable by hot_config within safe range
   -> action: "adjust_config"

8. NONE OF THE ABOVE:
   -> action: "no_action"

ESCALATION TRIGGERS (any one sufficient):
- ORL success rate < 50% for any schema over 24h
- 3+ consecutive governance cycles with zero successful actions
- Signal pending > 48 hours with no auto-trigger match
- Pipeline failure rate > 80% in last 24h
- Unclassifiable anomaly
- Feedback loop depth at max (3) without resolution

HARD CONSTRAINTS -- YOU CANNOT:
- Write or modify code
- Change prompts or routing config
- Deploy workers
- Make architecture decisions
- Approve signals that don't meet auto-approve criteria
- Trigger more than 5 pipelines per cycle

---

REASONING PROCESS (follow in order):

Step 1 -- METRICS: Count pending signals, active pipelines, 24h completions, 24h failures, stale signals, max feedback depth from the data above.

Step 2 -- CLASSIFY SIGNALS: For each pending signal, walk through the classification list above. Record which criteria are met/unmet.

Step 3 -- CLASSIFY PIPELINES: For each pipeline at architect-approval, check auto-approve criteria.

Step 4 -- DETECT ANOMALIES: Scan ORL telemetry for escalation triggers. Check for degradation trends (>20pp drop in 7 days).

Step 5 -- DETECT SILENT FAILURES: Signals >48h with no pipeline. Pipelines >24h with no completion. Feedback loops at depth 3.

Step 6 -- PRODUCE DECISIONS: One decision per signal/pipeline/anomaly. Cite evidence keys.

Step 7 -- ASSESS: Write situation_frame, determine operational_health and trend.

Step 8 -- SELF-CHECK:
  a. Every trigger_pipeline target exists in pending signals.
  b. Every approve_pipeline target exists in active pipelines.
  c. Every evidence key exists in the context data above.
  d. metrics_snapshot matches actual counts from Step 1.
  e. No missed escalation triggers.
  f. No more than 5 trigger_pipeline decisions.
  Fix any violations before output.

---

EXAMPLES:

Signal SIG-2847, subtype "synthesis:atom-failed", source "factory:feedback-loop", depth 1, autoApprove true, age 22min, no cooldown:
{"action":"trigger_pipeline","target":"SIG-2847","reason":"Meets all auto-trigger criteria: feedback-loop source, depth 1 < 3, autoApprove true, no cooldown.","evidence":["SIG-2847"],"risk_level":"safe","executed":false}

ORL schema "GovernanceCycleResult" at 42% success/24h (was 89% yesterday):
{"action":"escalate_to_human","target":"GovernanceCycleResult","reason":"ORL success 42% < 50% threshold over 24h. 5/6 recent cycles failed. Structural issue.","evidence":["orl_GovernanceCycleResult"],"risk_level":"high","executed":false}

Signal SIG-3021, subtype "architecture:drift", source "factory:orientation-agent", autoApprove false, age 4h:
{"action":"no_action","target":"SIG-3021","reason":"Source not feedback-loop, autoApprove false. Age 4h < 48h escalation threshold. Re-evaluate next cycle.","evidence":["SIG-3021"],"risk_level":"moderate","executed":false}

---

OUTPUT: Respond with ONLY a valid JSON object. No markdown fencing. No commentary. No reasoning text.

Required fields:
- cycle_id: "gov-{ISO8601}"
- timestamp: ISO 8601
- decisions: array of {action, target, reason, evidence, risk_level, executed}
- assessment: {situation_frame, operational_health, top_risks, top_opportunities, trend, evidence_summary}
- escalations: array of {issue, severity, evidence, recommended_action, escalation_target}
- metrics_snapshot: {pending_signal_count, active_pipeline_count, completed_last_24h, failed_last_24h, orl_success_rate_7day, avg_repair_count_7day, stale_signal_count, feedback_loop_depth_max}`
```

---

### Change 2: Add Q9 (Last Cycle Memory) to Section 6.1

Add a ninth AQL query to `prefetchGovernorContext`:

```typescript
// Q9: Previous governance cycle -- prevent redundant decisions
db.query(`
  FOR a IN orientation_assessments
    FILTER a.type == 'governance_cycle'
    SORT a.createdAt DESC
    LIMIT 1
    RETURN {
      cycle_id: a.cycle_id,
      decisions_summary: a.decisions_summary,
      operational_health: a.assessment.operational_health,
      escalation_count: LENGTH(a.escalations),
      createdAt: a.createdAt
    }
`).catch(() => []),
```

Add corresponding context formatting and interface field:
`previous_cycle: PreviousCycleResult | null`

---

### Change 3: Add Decision Quality Validator to Section 10.3

Insert between steps 2 and 3 in the execution flow:

```
|-- 2.5. validateDecisionQuality(result, ctx)
|        |-- Verify all evidence keys exist in context
|        |-- Verify all targets reference real entities
|        |-- Verify metrics_snapshot matches context counts
|        |-- Log validation result to orl_telemetry
|        |-- If hallucination rate > 50%, skip execution, log failure
```

---

### Change 4: Add Token Tracking to Section 14.1

Add to the cycle telemetry record:

```typescript
inputTokens: number    // prompt tokens consumed
outputTokens: number   // completion tokens generated
totalTokens: number    // total token count
modelId: string        // which model was used
```

---

### Change 5: Add Design Decision Note to Section 10.4

Append to "Critical Design Constraint: Deterministic Action Gate":

```
The Governor intentionally avoids ReAct and tool-calling patterns.
The LLM serves as an assessment engine, not an execution engine.
Context is pre-fetched (all 8 AQL queries run before the LLM call).
Actions are post-validated (deterministic criteria checks after the
LLM call). This architecture prevents prompt injection or hallucination
from triggering real-world side effects -- a property that ReAct and
tool-calling patterns cannot guarantee because they give the LLM
control over tool invocation.

This follows the Plan-and-Execute pattern (Ch 6, Phoenix & Taylor 2024)
where the planner is an LLM and the executor is deterministic code
that can reject planner decisions.
```

---

## 5. Summary of Improvements by Priority

| # | Improvement | Book Source | Impact | Phase |
|---|---|---|---|---|
| 1 | Add cognitive persona (conservative ops manager) | Ch1 Give Direction | High -- reduces action bias | 1 |
| 2 | Add 3 few-shot examples | Ch1 Provide Examples, Ch3 Classification | High -- classification accuracy | 1 |
| 3 | Add chain-of-thought reasoning steps | Ch1 Divide Labor, Ch3 Thinking Time | High -- decision quality | 1 |
| 4 | Add self-check step | Ch3 Self-Eval | Medium -- catches hallucinated keys | 1 |
| 5 | Reframe as ordered classification | Ch3 Classification | Medium -- reduces ambiguity | 1 |
| 6 | Separate schema definition from example values | Ch1 Specify Format | Medium -- format reliability | 1 |
| 7 | Add previous-cycle memory (Q9) | Ch6 Memory | Medium -- prevents redundancy | 1 |
| 8 | Add decision quality validator | Ch1 Evaluate Quality | Medium -- runtime safety net | 1 |
| 9 | Add token tracking | Ch6 Callbacks | Low -- cost observability | 1 |
| 10 | Document ReAct/Plan-Execute design decision | Ch6 Agents | Low -- architectural clarity | 1 |
| 11 | Dynamic criteria via meta-prompting | Ch3 Meta Prompting | Medium -- self-tuning | 2+ |
| 12 | Majority vote for escalations | Ch3 Majority Vote | Low -- escalation confidence | 3 |
| 13 | ToT for diagnostic sub-agents | Ch6 Tree of Thoughts | Low -- complex diagnosis | 3 |

**Estimated token impact of Phase 1 changes:** Current prompt ~1,200 tokens.
Improved prompt ~2,400 tokens (persona + examples + reasoning steps +
self-check). Well within the 16,000-token context budget. The additional
1,200 tokens are a negligible cost increase (~$0.002/cycle at current rates)
for substantially improved decision quality.

---

## 6. What the Book Does NOT Apply To

For completeness, these book sections were evaluated and found **not
applicable** to the GovernorAgent:

- **Image generation techniques** (Ch 1, 7, 8) -- Governor produces JSON
- **Fine-tuning** (Ch 1 p. 50) -- Governor's decision space is too small
  for fine-tuning; few-shot in-context learning is sufficient
- **Retrieval-Augmented Generation / RAG** (Ch 5, Ch 6 retrieval) -- the
  Governor's context is pre-fetched via AQL, not retrieved via semantic
  similarity. This is correct because governance decisions require exact
  data, not similar data
- **Conversational buffer memory** (Ch 6) -- the Governor is not
  conversational; it runs single-shot per cycle
- **LangChain-specific tooling** (Ch 4, Ch 6 agents) -- the Governor uses
  a direct LLM API call, not LangChain. This is correct for a Cloudflare
  Worker environment

---

*End of review. All recommendations trace to specific book sections with
page references. Implementation priority order: items 1-3 (prompt rewrite)
should be applied together as a single change to section 9.*
