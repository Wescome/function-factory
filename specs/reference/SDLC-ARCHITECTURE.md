# Function Factory — SDLC Architecture

**Author:** Architecture proposal for Wislet J. Celestin / Koales.ai
**Date:** 2026-04-24
**Status:** Draft — requires architect review before DECISIONS.md entry
**Lineage:** FULL-DEPLOYMENT-ARCHITECTURE.md (compute + storage layer),
SASE paper (Hassan et al., arXiv:2509.06216v1), ConOps v2026-04-18,
DEFINITIVE-ARCHITECTURE.md, ADR-001/002/003, DogFood session.
**Relationship:** This document sits above the deployment architecture.
The deployment doc specifies WHERE things run (CF Workers, Workflows, DOs,
Containers, ArangoDB). This document specifies WHAT the Factory produces
across the full software development lifecycle and how those artifacts
flow between humans and agents.

---

## 0. Scope

The deployment architecture ends at "the Factory produces a Function and
monitors it." This document extends coverage to the full SDLC:

- How external signals become governed Functions (Stages 1-7, existing)
- How the Factory produces merge-ready evidence (MRP, new)
- How agents consult humans when stuck (CRP/VCR, new)
- How mentorship becomes testable code (MentorScript, new)
- How Functions enter the codebase via PR (Stage 8, new)
- How CI validates Factory output (GitHub Actions integration, new)
- How the architect operates the system (ACE, new)
- How the lifecycle feeds back into itself (crystallization → new Signals)

---

## 1. SASE Mapping — What the Factory Already Has

The SASE paper (Hassan et al.) identifies four pillars: Actors, Processes,
Tools, Artifacts. The Factory predates SASE but implements most of its
structural claims. The mapping is not forced — the Factory arrived at
similar conclusions from a different starting point (whitepaper-driven
formal pipeline vs. academic framework).

| SASE Pillar | SASE Concept | Factory Equivalent | Gap? |
|---|---|---|---|
| **Actors** | Agent Coach | Architect (ConOps §4.1) | No |
| | Specialized agents | 5-role topology (Planner/Coder/Critic/Tester/Verifier) | No |
| **Processes** | BriefingEng | Stages 1-4 (Signal → PRD) | No — PRDs are richer than BriefingScript |
| | ALE (loop orchestration) | CF Workflows pipeline | No — executable, not declarative-only |
| | ATME (mentorship-as-code) | SKILL.md + LESSONS.md | **Partial** — not structured/testable |
| | AGE (guidance engineering) | `waitForEvent('architect-approval')` | **Partial** — boolean, not structured |
| | ATLE (agent lifecycle) | Dream DO + 7-tier memory | No |
| | ATIE (agent infrastructure) | pi SDK + extensions + DO coordination | No |
| **Tools** | ACE (human command center) | gateway-worker API | **Missing** — API exists, no UI |
| | AEE (agent execution env) | Coordinator DO + pi SDK + Containers | No |
| **Artifacts** | BriefingScript | PRD (typed, compiled, gated) | No — Factory's is stronger |
| | LoopScript | CF Workflow definition | No — Factory's is executable |
| | MentorScript | SKILL.md + LESSONS.md (narrative) | **Gap** — needs structure |
| | CRP (consultation request) | — | **Missing** |
| | MRP (merge-readiness pack) | — | **Missing** |
| | VCR (version-controlled resolution) | — | **Missing** |

Four gaps. All are artifact-level, not infrastructure-level. The compute,
storage, orchestration, and agent execution layers are built. What's missing
is the structured dialogue between agents and humans during and after
execution.

---

## 2. New Artifact Types

### 2.1 MentorScript — Structured, Testable, Version-Controlled Rules

**What it supplements:** Narrative SKILL.md files and free-form LESSONS.md
entries that agents read but cannot be linted, tested, or traced.
MentorScript does not replace these — SKILL.md files remain as narrative
context, LESSONS.md remains as the episodic-to-semantic promotion source.
MentorScript adds a structured, testable layer on top.

**What it is:** A collection of typed rules in ArangoDB, each atomic,
scoped, traceable, and optionally backed by a detector (invariant) that
checks compliance.

```typescript
type MentorRule = {
  _key: string                   // e.g., "MR-001"
  rule: string                   // human-readable: "Prefer composition over inheritance in services layer"
  scope: 'global' | 'package' | 'role'
  appliesTo: RoleName[]          // which Stage 6 roles observe this
  source: 'architect' | 'inferred' | 'crystallized'
  source_refs: SourceRef[]       // lineage: where this rule originated
  testable: boolean              // can a detector verify compliance?
  detectorId?: string            // INV-* reference if testable
  conflictsWith?: string[]       // MR-* IDs of rules this may conflict with
  status: 'active' | 'proposed' | 'superseded'
  supersededBy?: string          // MR-* ID if superseded
  createdAt: string
  createdBy: string              // architect identity or agent role
}
```

**ArangoDB collection:** `mentorscript_rules`

**Lifecycle:**

```
Architect authors rule manually
  → status: 'active', source: 'architect'

Critic infers rule from repeated feedback
  → status: 'proposed', source: 'inferred'
  → Architect reviews, approves → 'active'

Dream DO crystallizes rule from execution pattern
  → status: 'proposed', source: 'crystallized'
  → Architect reviews, approves → 'active'

Rule conflicts detected by linter
  → conflictsWith populated
  → CRP generated for architect resolution
```

**Consumers:**
- Pi SDK extensions load active rules at session creation (Coder, Tester)
- Critic role checks compliance against rules during review
- Gate 2 includes MentorScript compliance in simulation coverage
- MRP reports which rules were applied and compliance status

**Relationship to existing artifacts:**
- SKILL.md files remain as narrative context (loaded into agent system
  prompts). They describe HOW to do things.
- MentorScript rules define WHAT must be true about the output. They are
  checkable, not advisory.
- LESSONS.md entries are candidates for promotion to MentorScript rules
  via the Dream DO's consolidation cycle.

---

### 2.2 CRP — Consultation Request Pack

**What it replaces:** The binary `waitForEvent('architect-approval')` gate
that pauses the Workflow but provides no structured context about WHY it
paused or WHAT the agent needs.

**What it is:** A structured artifact generated by any agent role when it
encounters ambiguity, a trade-off it cannot resolve, or a decision that
exceeds its authority. The CRP provides the decision context so the human
can respond efficiently.

```typescript
type ConsultationRequestPack = {
  _key: string                    // CRP-001
  functionRunId: string
  workflowInstanceId: string
  role: RoleName                  // which role generated this
  stage: string                   // which pipeline stage

  question: string                // the specific thing the agent needs answered
  questionType: 'ambiguity' | 'tradeoff' | 'authority' | 'conflict'

  context: {
    currentState: string          // what the agent has done so far
    optionsConsidered: {
      option: string
      pros: string
      cons: string
    }[]
    tradeoffs: string             // why the agent can't decide alone
    relevantArtifacts: string[]   // PRD, WorkGraph, MentorRule IDs
    relevantCode?: string         // code snippet if applicable
  }

  routing: {
    targetRole: 'architect' | 'domain-expert' | 'tech-lead'
    urgency: 'blocking' | 'advisory'
    // blocking: Workflow pauses via waitForEvent
    // advisory: Workflow continues, agent uses best guess, CRP logged
  }

  status: 'pending' | 'resolved' | 'expired'
  resolution?: string             // VCR-* ID when resolved
  createdAt: string
  expiresAt?: string              // optional timeout
}
```

**ArangoDB collection:** `consultation_requests`

**Generation triggers:**
- Planner: objective is ambiguous, multiple valid decompositions
- Coder: architectural choice not covered by MentorScript rules
- Critic: borderline quality — passes some criteria, fails others
- Tester: can't determine correct behavior from PRD + WorkGraph alone
- Verifier: repair loop exhausted budget but code is almost correct
- Any role: MentorScript rule conflict detected

**Workflow integration:**

```typescript
// Inside a LangGraph role node
if (ambiguityDetected) {
  const crp = await writeCRP(this.env, {
    role, question, context, routing: { targetRole: 'architect', urgency: 'blocking' },
  })

  if (crp.routing.urgency === 'blocking') {
    // Pause the Workflow — this CRP becomes the waitForEvent payload
    throw new ConsultationRequired(crp._key)
  }
  // Advisory: log it, continue with best guess
}
```

In the Workflow:

```typescript
const synthesis = await step.do('stage-6', async () => {
  try {
    return await coordinator.synthesize(workGraph)
  } catch (err) {
    if (err instanceof ConsultationRequired) {
      // Pause and wait for architect resolution
      const resolution = await step.waitForEvent(`crp-${err.crpId}`, {
        timeout: '7 days',
      })
      // Resume with the architect's guidance injected
      return await coordinator.resumeWithGuidance(workGraph, resolution)
    }
    throw err
  }
})
```

---

### 2.3 VCR — Version Controlled Resolution

**What it is:** The architect's response to a CRP or MRP. A versioned,
traceable artifact that formally records the decision, its rationale, and
whether it should become a durable MentorScript rule.

```typescript
type VersionControlledResolution = {
  _key: string                    // VCR-001
  resolves: {
    type: 'crp' | 'mrp'
    id: string                    // CRP-* or MRP-* ID
  }

  decision: string                // the actual answer/decision
  rationale: string               // why this decision
  resolvedBy: string              // architect identity

  // Should this become a durable rule?
  mentorRuleProposal?: {
    rule: string
    scope: 'global' | 'package' | 'role'
    appliesTo: RoleName[]
  }

  // If rejecting an MRP, what needs to change?
  revisionGuidance?: string

  source_refs: SourceRef[]        // what the architect consulted
  createdAt: string
}
```

**ArangoDB collection:** `version_controlled_resolutions`

**Flow:**
```
CRP generated by agent role
  → surfaced in ACE inbox (via gateway API)
  → architect reviews context + options
  → architect issues VCR
  → VCR written to ArangoDB
  → Workflow receives event (`crp-{id}`)
  → agent role resumes with VCR.decision injected into context

If VCR.mentorRuleProposal exists:
  → new MentorRule created with status: 'proposed'
  → Dream DO picks up on next consolidation
  → or architect immediately activates via ACE
```

---

### 2.4 MRP — Merge-Readiness Pack

**What it replaces:** Separate, unstructured Coverage Reports and execution
artifacts that the architect must manually correlate to determine if a
Function is ready to ship.

**What it is:** A single evidence bundle proving the Function meets all
five criteria for merge-readiness (per SASE §4.2.4). Assembled
automatically by the Workflow after Gate 2 passes. The architect reviews
one artifact, not a scatter of reports.

```typescript
type MergeReadinessPack = {
  _key: string                    // MRP-001
  functionId: string
  workGraphId: string
  pipelineInstanceId: string

  // ── 1. Functional Completeness ──
  functionalCompleteness: {
    passed: boolean
    acceptanceCriteria: {
      criterion: string           // from PRD
      met: boolean
      evidence: string            // artifact ID (test result, etc.)
    }[]
  }

  // ── 2. Sound Verification ──
  soundVerification: {
    passed: boolean
    testPlan: string              // Tester role output summary
    newTestCases: {
      name: string
      type: 'unit' | 'integration' | 'property'
      result: 'pass' | 'fail'
    }[]
    gate2ReportId: string         // CR-* coverage report
    coveragePercentage?: number
  }

  // ── 3. SE Hygiene ──
  seHygiene: {
    passed: boolean
    mentorRuleCompliance: {
      ruleId: string              // MR-*
      rule: string
      compliant: boolean
      evidence?: string
    }[]
    lintReport?: {
      errors: number
      warnings: number
    }
    complexityDelta?: {
      before: number
      after: number
    }
  }

  // ── 4. Rationale ──
  rationale: {
    approach: string              // Planner output summary
    tradeoffsConsidered: string   // Critic output summary
    prDescription: string         // human-readable PR description
    crpsResolved: string[]        // CRP-* IDs that were resolved during execution
  }

  // ── 5. Auditability ──
  auditability: {
    prdId: string
    workGraphId: string
    semanticReviewId: string      // the pre-compile review artifact
    gate1ReportId: string
    gate2ReportId: string
    sessionTreeId?: string        // pi SDK session tree for debugging
    modelBindings: Record<RoleName, { provider: string, model: string }>
    mentorRulesApplied: string[]  // MR-* IDs
    totalTokenUsage: number
    totalCost: number
    executionDurationMs: number
  }

  verdict: 'merge-ready' | 'needs-revision' | 'rejected'
  verdictRationale: string
  resolution?: string             // VCR-* ID when architect reviews
  createdAt: string
}
```

**ArangoDB collection:** `merge_readiness_packs`

**Assembly — Workflow step after Gate 2:**

```typescript
const mrp = await step.do('assemble-mrp', async () => {
  return assembleMRP({
    functionId: synthesis.functionId,
    workGraph: compState.workGraph,
    prd: proposal.prd,
    semanticReview,
    gate1,
    gate2,
    synthesis,
    mentorRules: await getActiveMentorRules(this.env),
    tokenUsage: synthesis.tokenUsage,
  })
})

// Pause for architect review
const mrpResolution = await step.waitForEvent(`mrp-${mrp._key}`, {
  timeout: '14 days',
})

if (mrpResolution.decision !== 'approved') {
  return { status: 'mrp-rejected', revisionGuidance: mrpResolution.revisionGuidance }
}
```

---

## 3. Stage 8 — PR Creation + Deployment Handoff

The Factory's pipeline currently ends at Stage 7 (monitoring registration).
Stage 8 bridges the Factory to the codebase via the existing CI/CD system.

**Principle:** The Factory does not deploy. It creates merge-ready PRs with
evidence bundles. Existing CI validates. Humans merge. Existing CD deploys.

**Workflow step:**

```typescript
// After MRP approval
await step.do('create-pr', async () => {
  // The Coder's artifacts include a git branch with commits
  const branch = synthesis.artifacts.branch
  const prDescription = mrp.rationale.prDescription

  // Create PR via GitHub API
  const pr = await createGitHubPR({
    repo: compState.workGraph.repo,
    head: branch,
    base: compState.workGraph.repo.ref,
    title: `[FF-${synthesis.functionId}] ${proposal.prd.title}`,
    body: formatPRBody(prDescription, mrp),
  })

  // Attach MRP as PR comment (progressive disclosure)
  await addPRComment(pr.number, formatMRPSummary(mrp))

  // Link PR back to Factory artifacts in ArangoDB
  await writeToArango(this.env, 'function_runs', {
    _key: synthesis.functionRunId,
    prUrl: pr.url,
    prNumber: pr.number,
    status: 'pr-created',
  })

  return { prUrl: pr.url, prNumber: pr.number }
})
```

**PR body format (progressive disclosure):**

```markdown
## Function Factory: [FN-001] Add caching layer to payment service

### Summary
{mrp.rationale.prDescription}

### Evidence (Merge-Readiness Pack MRP-001)
- ✅ Functional completeness: 8/8 acceptance criteria met
- ✅ Sound verification: 12 new tests (4 unit, 6 integration, 2 property)
- ✅ SE hygiene: 0 lint errors, 14/14 MentorScript rules compliant
- ✅ Rationale: approach documented, 2 CRPs resolved
- ✅ Auditability: full lineage from SIG-001 → PRS-001 → PRD-001 → WG-001

<details>
<summary>Detailed MRP</summary>
{JSON.stringify(mrp, null, 2)}
</details>

### Lineage
Signal: SIG-001 | Pressure: PRS-001 | PRD: PRD-001 | WorkGraph: WG-001
Pipeline: {pipelineInstanceId} | Cost: $1.87 | Tokens: 42,300
```

---

## 4. CI Pipeline Integration

### 4.1 Signal Schema for CI Events

Every CI result that enters the Factory is a Signal. The `signalType` field
uses the existing core.ts enum (`market | customer | competitor |
regulatory | internal | meta`). CI and GitHub events are `signalType:
'internal'` with a `subtype` discriminant on the payload.

**ArtifactId registry note:** The new artifact prefixes (MR-*, CRP-*,
VCR-*, MRP-*) must be added to the `ArtifactId` regex in
`packages/schemas/src/lineage.ts` alongside existing prefixes (PRS-*,
BC-*, FP-*, FN-*, PRD-*, WG-*, INV-*, CR-*, SIG-*).

```typescript
// Base Signal (all signals share this shape)
// signalType aligns with core.ts SignalType enum
type Signal = {
  _key: string                     // SIG-{ulid}
  signalType: 'market' | 'customer' | 'competitor'
             | 'regulatory' | 'internal' | 'meta'
  source: string                   // originating system
  idempotencyKey: string           // prevents duplicate processing
  status: 'pending' | 'ingested' | 'rejected'
  createdAt: string
  payload: CIPassPayload | CIFailPayload | CIRepairPayload | GitHubEventPayload
}

// CI pass — signalType: 'internal', subtype: 'ci-pass'
type CIPassPayload = {
  subtype: 'ci-pass'
  prNumber: number
  branch: string                   // ff-{functionId}
  functionId: string               // extracted from branch name
  pipelineInstanceId: string       // the Workflow that created this PR
  mrpId: string                    // MRP attached to the PR
  commitSha: string
  ciWorkflowName: string           // e.g., "lint-test-build"
  ciWorkflowRunId: number
  durationMs: number
  checksPassed: string[]           // ["lint", "unit-test", "integration-test", "build"]
}

// CI fail — signalType: 'internal', subtype: 'ci-fail'
type CIFailPayload = {
  subtype: 'ci-fail'
  prNumber: number
  branch: string
  functionId: string
  pipelineInstanceId: string
  mrpId: string
  commitSha: string
  ciWorkflowName: string
  ciWorkflowRunId: number
  durationMs: number
  checksFailed: {
    name: string                   // e.g., "unit-test"
    conclusion: 'failure' | 'timed_out' | 'cancelled'
    logUrl: string                 // GitHub Actions log permalink
    annotation?: string            // first error annotation if available
  }[]
  checksPassed: string[]
}

// CI repair trigger — signalType: 'internal', subtype: 'ci-repair'
// (used in §4.6, triggerRepairPipeline)
type CIRepairPayload = {
  subtype: 'ci-repair'
  originalFunctionId: string
  originalMrpId: string
  originalPipelineInstanceId: string
  workGraphId: string
  classification: CIFailureClassification
  failureLogs: string
  prNumber: number
  branch: string
  commitSha: string
  repairAttempt: number
}

// External GitHub event — signalType: 'internal', subtype: 'github-event'
type GitHubEventPayload = {
  subtype: 'github-event'
  eventType: 'issue' | 'issue_comment' | 'pull_request'
  action: string                   // "opened", "labeled", "created", etc.
  raw: Record<string, unknown>     // github.event payload
}
```

**Idempotency key derivation:**

```typescript
// CI events: unique per workflow run
const idempotencyKey = `ci:${payload.ciWorkflowRunId}`

// GitHub events: unique per event delivery
const idempotencyKey = `gh:${headers['x-github-delivery']}`
```

Duplicate signals (same idempotency key already in `specs_signals`) are
rejected at the webhook-worker with `409 Conflict`. No downstream
processing occurs.

---

### 4.2 Webhook Worker — Full Spec

The webhook-worker is a stateless CF Worker with no public route (Service
Binding from gateway-worker only). It owns the entire ingest path: parse,
validate, classify, enrich, persist, enqueue.

**Endpoint:** `POST /webhook/ci-result` (called by GitHub Actions)

**Endpoint:** `POST /signal` (called by GitHub Actions or external systems)

**Processing pipeline (synchronous, <50ms):**

```typescript
export class WebhookWorker extends WorkerEntrypoint<Env> {

  async ingestCIResult(raw: unknown): Promise<Signal> {
    // 1. Parse + validate incoming payload
    const input = CIWebhookSchema.parse(raw)

    // 2. Classify: ci-pass or ci-fail (this is the payload subtype,
    //    NOT the Signal's signalType which is always 'internal')
    const subtype = input.conclusion === 'success' ? 'ci-pass' : 'ci-fail'

    // 3. Extract Factory context from branch name
    //    Branch convention: ff-{functionId} (see §4.12 for contract)
    const functionId = this.extractFunctionId(input.branch)
    if (!functionId) {
      // Not a Factory branch — discard silently
      return { status: 'rejected', reason: 'non-factory-branch' }
    }

    // 4. Look up the originating pipeline instance + MRP
    const functionRun = await queryArango(this.env, `
      FOR run IN function_runs
        FILTER run.functionId == @functionId
        SORT run.createdAt DESC
        LIMIT 1
        RETURN run
    `, { functionId })

    const mrp = await queryArango(this.env, `
      FOR m IN merge_readiness_packs
        FILTER m.functionId == @functionId
        SORT m.createdAt DESC
        LIMIT 1
        RETURN m
    `, { functionId })

    // 5. Build enriched payload (subtype discriminant, not signalType)
    const payload: CIPassPayload | CIFailPayload = subtype === 'ci-pass'
      ? {
          subtype: 'ci-pass',
          prNumber: input.prNumber,
          branch: input.branch,
          functionId,
          pipelineInstanceId: functionRun?._key ?? 'unknown',
          mrpId: mrp?._key ?? 'unknown',
          commitSha: input.commitSha,
          ciWorkflowName: input.workflowName,
          ciWorkflowRunId: input.workflowRunId,
          durationMs: input.durationMs,
          checksPassed: input.checks.filter(c => c.conclusion === 'success').map(c => c.name),
        }
      : {
          subtype: 'ci-fail',
          prNumber: input.prNumber,
          branch: input.branch,
          functionId,
          pipelineInstanceId: functionRun?._key ?? 'unknown',
          mrpId: mrp?._key ?? 'unknown',
          commitSha: input.commitSha,
          ciWorkflowName: input.workflowName,
          ciWorkflowRunId: input.workflowRunId,
          durationMs: input.durationMs,
          checksFailed: input.checks
            .filter(c => c.conclusion !== 'success')
            .map(c => ({
              name: c.name,
              conclusion: c.conclusion,
              logUrl: c.logUrl,
              annotation: c.annotation,
            })),
          checksPassed: input.checks.filter(c => c.conclusion === 'success').map(c => c.name),
        }

    // 6. Compute idempotency key
    const idempotencyKey = `ci:${input.workflowRunId}`

    // 7. Check for duplicate
    const existing = await queryArango(this.env, `
      FOR s IN specs_signals
        FILTER s.idempotencyKey == @key
        LIMIT 1
        RETURN s
    `, { key: idempotencyKey })

    if (existing) {
      return { status: 'rejected', reason: 'duplicate' }
    }

    // 8. Write Signal to ArangoDB
    //    signalType is the core.ts enum value; subtype is on the payload
    const signal: Signal = {
      _key: `SIG-${ulid()}`,
      signalType: 'internal',
      source: 'github-actions',
      idempotencyKey,
      status: 'pending',
      createdAt: new Date().toISOString(),
      payload,
    }
    await writeToArango(this.env, 'specs_signals', signal)

    // 9. Write to episodic memory (every CI event, pass or fail)
    await writeToArango(this.env, 'memory_episodic', {
      _key: `ep-${ulid()}`,
      action: subtype,
      functionId,
      pipelineInstanceId: payload.pipelineInstanceId,
      mrpId: payload.mrpId,
      detail: subtype === 'ci-fail'
        ? { checksFailed: (payload as CIFailPayload).checksFailed }
        : { checksPassed: (payload as CIPassPayload).checksPassed },
      timestamp: new Date().toISOString(),
      pain_score: subtype === 'ci-fail' ? 8 : 1,
      importance: subtype === 'ci-fail' ? 9 : 3,
    })

    // 10. Enqueue for downstream processing
    //     Queue message carries subtype for routing
    await this.env.SIGNAL_QUEUE.send({
      signalId: signal._key,
      subtype,
    })

    // 11. Update Signal status
    await updateArango(this.env, 'specs_signals', signal._key, {
      status: 'ingested',
    })

    return signal
  }

  private extractFunctionId(branch: string): string | null {
    // ff-FN-001 → FN-001
    // ff-FN-META-COMPILER-001 → FN-META-COMPILER-001
    const match = branch.match(/^ff-(.+)$/)
    return match ? match[1] : null
  }
}
```

---

### 4.3 Queue Consumer — Signal Routing

The Queue consumer receives every ingested Signal and routes it to the
correct downstream handler. CI signals take a different path than
external GitHub events.

```typescript
// Queue consumer (in the pipeline Worker)
export default {
  async queue(batch: MessageBatch<QueueMessage>, env: Env) {
    for (const msg of batch.messages) {
      const { signalId, subtype } = msg.body

      switch (subtype) {
        case 'ci-pass':
          await handleCIPass(signalId, env)
          break

        case 'ci-fail':
          await handleCIFail(signalId, env)
          break

        case 'github-event':
          await handleGitHubEvent(signalId, env)
          break
      }

      msg.ack()
    }
  }
}
```

---

### 4.4 CI Pass Path

A CI pass means the Factory's PR survived the codebase's existing CI suite.
This is positive evidence that feeds memory consolidation and
crystallization.

```typescript
async function handleCIPass(signalId: string, env: Env) {
  const signal = await readArango(env, 'specs_signals', signalId)
  const payload = signal.payload as CIPassPayload

  // 1. Update the function_run record
  await updateArango(env, 'function_runs', payload.functionId, {
    ciStatus: 'passed',
    ciCompletedAt: new Date().toISOString(),
    ciChecks: payload.checksPassed,
  })

  // 2. Update the MRP with CI evidence
  await updateArango(env, 'merge_readiness_packs', payload.mrpId, {
    ciEvidence: {
      status: 'passed',
      checksPassed: payload.checksPassed,
      workflowRunId: payload.ciWorkflowRunId,
      commitSha: payload.commitSha,
      durationMs: payload.durationMs,
      verifiedAt: new Date().toISOString(),
    },
  })

  // 3. Post PR comment confirming CI pass + MRP status
  await postPRComment(env, payload.prNumber, formatCIPassComment(payload))

  // 4. Add lineage edge: Signal → MRP (CI evidence extends MRP)
  await writeToArango(env, 'lineage_edges', {
    _from: `specs_signals/${signalId}`,
    _to: `merge_readiness_packs/${payload.mrpId}`,
    type: 'ci-evidence',
    createdAt: new Date().toISOString(),
  })

  // 5. No new pipeline triggered.
  //    The episodic memory entry (written at ingest) is sufficient.
  //    Dream DO will pick up the ci-pass pattern during consolidation.
  //    If the same function type consistently passes CI first-try,
  //    crystallization may produce a MentorRule or invariant template.
}
```

**PR comment format:**

```markdown
### ✅ CI Passed — Factory Function {functionId}

All checks passed for MRP-{mrpId}:
{checksPassed.map(c => `- ✅ ${c}`).join('\n')}

Duration: {durationMs}ms | Commit: {commitSha.slice(0,7)}

This PR is ready for merge.
```

---

### 4.5 CI Fail Path

A CI failure means the Factory produced a PR that doesn't survive the
codebase's CI. This is the critical feedback loop. The failure must
re-enter the pipeline as a Signal that triggers a repair run.

**Classification matters.** Not all CI failures warrant the same response.
The webhook-worker enriched the payload with per-check failure details.
The queue consumer classifies the failure and routes accordingly.

```typescript
async function handleCIFail(signalId: string, env: Env) {
  const signal = await readArango(env, 'specs_signals', signalId)
  const payload = signal.payload as CIFailPayload

  // 1. Update the function_run record
  await updateArango(env, 'function_runs', payload.functionId, {
    ciStatus: 'failed',
    ciCompletedAt: new Date().toISOString(),
    ciChecksFailed: payload.checksFailed,
  })

  // 2. Update the MRP with CI failure evidence
  await updateArango(env, 'merge_readiness_packs', payload.mrpId, {
    ciEvidence: {
      status: 'failed',
      checksFailed: payload.checksFailed,
      checksPassed: payload.checksPassed,
      workflowRunId: payload.ciWorkflowRunId,
      commitSha: payload.commitSha,
      durationMs: payload.durationMs,
      verifiedAt: new Date().toISOString(),
    },
    // Downgrade MRP verdict — it's no longer merge-ready
    verdict: 'needs-revision',
    verdictRationale: `CI failed: ${payload.checksFailed.map(c => c.name).join(', ')}`,
  })

  // 3. Classify the failure
  const classification = classifyCIFailure(payload.checksFailed)

  // 4. Route based on classification
  switch (classification.type) {
    case 'deterministic':
      // Lint error, type error, build error — the Coder can fix this.
      // Trigger a repair pipeline run.
      await triggerRepairPipeline(env, payload, classification)
      break

    case 'test-regression':
      // Existing test broke — needs investigation.
      // Could be a real regression or a flaky test.
      // Trigger repair pipeline with test context attached.
      await triggerRepairPipeline(env, payload, classification)
      break

    case 'environment':
      // CI environment issue (timeout, infra failure, cancelled).
      // Do NOT trigger a repair. Log and alert.
      await postPRComment(env, payload.prNumber, formatEnvFailureComment(payload))
      break

    case 'ambiguous':
      // Can't classify — generate CRP for architect.
      await generateCIFailureCRP(env, payload, classification)
      break
  }

  // 5. Add lineage edge
  await writeToArango(env, 'lineage_edges', {
    _from: `specs_signals/${signalId}`,
    _to: `merge_readiness_packs/${payload.mrpId}`,
    type: 'ci-failure-evidence',
    createdAt: new Date().toISOString(),
  })

  // 6. Post PR comment with failure details
  await postPRComment(env, payload.prNumber, formatCIFailComment(payload, classification))
}
```

**Failure classifier:**

```typescript
type CIFailureClassification = {
  type: 'deterministic' | 'test-regression' | 'environment' | 'ambiguous'
  repairHint: string
  affectedChecks: string[]
}

function classifyCIFailure(
  checksFailed: CIFailPayload['checksFailed']
): CIFailureClassification {

  const names = checksFailed.map(c => c.name)
  const conclusions = checksFailed.map(c => c.conclusion)

  // Environment failures: timeout, cancelled — not the code's fault
  if (conclusions.every(c => c === 'timed_out' || c === 'cancelled')) {
    return {
      type: 'environment',
      repairHint: 'CI infrastructure issue — not a code problem',
      affectedChecks: names,
    }
  }

  // Deterministic: lint, typecheck, build — always fixable by Coder
  const deterministicChecks = ['lint', 'typecheck', 'build', 'format']
  if (names.every(n => deterministicChecks.includes(n))) {
    return {
      type: 'deterministic',
      repairHint: `Fix ${names.join(', ')} errors`,
      affectedChecks: names,
    }
  }

  // Test regression: a test check failed
  const testChecks = names.filter(n =>
    n.includes('test') || n.includes('spec') || n.includes('jest') || n.includes('vitest')
  )
  if (testChecks.length > 0) {
    return {
      type: 'test-regression',
      repairHint: `Test failures in: ${testChecks.join(', ')}. Check for regressions.`,
      affectedChecks: testChecks,
    }
  }

  // Can't tell — architect decides
  return {
    type: 'ambiguous',
    repairHint: `Unclassifiable CI failure in: ${names.join(', ')}`,
    affectedChecks: names,
  }
}
```

---

### 4.6 Repair Pipeline — CI Failure → New Synthesis Run

When a CI failure is classified as `deterministic` or `test-regression`,
the system triggers a **repair pipeline**. This is NOT a full Stage 1-7
run. It's a scoped re-entry into Stage 6 (synthesis) with the failure
context injected.

```typescript
async function triggerRepairPipeline(
  env: Env,
  payload: CIFailPayload,
  classification: CIFailureClassification,
) {
  // 1. Read the original WorkGraph and MRP
  const mrp = await readArango(env, 'merge_readiness_packs', payload.mrpId)
  const workGraph = await readArango(env, 'specs_workgraphs', mrp.workGraphId)

  // 2. Fetch CI failure logs
  const failureLogs = await fetchCILogs(env, payload.checksFailed)

  // 3. Build a repair Signal — this re-enters Stage 6, not Stage 1
  const repairSignal: Signal = {
    _key: `SIG-${ulid()}`,
    signalType: 'internal',       // core.ts enum value
    source: 'ci-feedback-loop',
    idempotencyKey: `repair:${payload.ciWorkflowRunId}`,
    status: 'pending',
    createdAt: new Date().toISOString(),
    payload: {
      subtype: 'ci-repair',      // payload discriminant
      originalFunctionId: payload.functionId,
      originalMrpId: payload.mrpId,
      originalPipelineInstanceId: payload.pipelineInstanceId,
      workGraphId: mrp.workGraphId,
      classification,
      failureLogs,
      prNumber: payload.prNumber,
      branch: payload.branch,
      commitSha: payload.commitSha,
      repairAttempt: await countRepairAttempts(env, payload.functionId) + 1,
    },
  }

  await writeToArango(env, 'specs_signals', repairSignal)

  // 4. Check repair attempt budget (outer loop: CI → Stage 6 re-entry)
  const outerAttempts = repairSignal.payload.repairAttempt
  if (outerAttempts > 3) {
    await generateRepairBudgetCRP(env, payload, outerAttempts)
    return
  }

  // 5. Check global synthesis ceiling (outer × inner)
  //    Inner loop: Verifier → Coder, max 5 turns per Stage 6 run
  //    Outer loop: CI fail → Stage 6 re-entry, max 3 attempts
  //    Global ceiling: 9 total synthesis attempts (3 outer × 3 inner avg)
  //    This prevents 3 × 5 = 15 worst-case from burning budget silently
  const totalSyntheses = await countTotalSyntheses(env, payload.functionId)
  if (totalSyntheses >= 9) {
    await generateGlobalBudgetCRP(env, payload, totalSyntheses, outerAttempts)
    return
  }

  // 5. Trigger a repair Workflow instance
  //    This is a separate Workflow class that skips Stages 1-5
  //    and enters Stage 6 directly with repair context.
  const instance = await env.REPAIR_PIPELINE.create({
    params: {
      workGraph,
      repairContext: {
        ciFailure: classification,
        failureLogs,
        prNumber: payload.prNumber,
        branch: payload.branch,
      },
      repairAttempt: outerAttempts,
    },
  })

  // 7. Update function_run with repair reference
  await updateArango(env, 'function_runs', payload.functionId, {
    repairPipelineId: instance.id,
    repairAttempt: outerAttempts,
  })

  // 7. Add lineage: repair Signal → original MRP
  await writeToArango(env, 'lineage_edges', {
    _from: `specs_signals/${repairSignal._key}`,
    _to: `merge_readiness_packs/${payload.mrpId}`,
    type: 'ci-repair-trigger',
    createdAt: new Date().toISOString(),
  })
}
```

**Repair attempt budget:** 3 attempts maximum. After 3 failed repairs,
the system generates a CRP for the architect. The architect can: authorize
more attempts, take over manually, or abandon the Function.

---

### 4.7 Repair Workflow — Stage 6 Re-Entry

The RepairPipeline is a second Workflow class. It skips Stages 1-5
(the PRD, WorkGraph, and Gate 1 already exist and passed). It re-enters
Stage 6 with the CI failure context injected into the Coder and Tester
roles.

```typescript
export class RepairPipeline extends WorkflowEntrypoint<Env, RepairParams> {

  async run(event: WorkflowEvent<RepairParams>, step: WorkflowStep) {
    const { workGraph, repairContext, repairAttempt } = event.payload

    // Stage 6: synthesis with repair context
    const synthesis = await step.do('repair-synthesis', async () => {
      const id = this.env.COORDINATOR.idFromName(
        `${workGraph.id}-repair-${repairAttempt}`
      )
      const coord = this.env.COORDINATOR.get(id)
      return coord.synthesize(workGraph, {
        repairMode: true,
        ciFailure: repairContext.ciFailure,
        failureLogs: repairContext.failureLogs,
        existingBranch: repairContext.branch,
      })
    })

    if (synthesis.verdict.decision === 'fail') {
      // Repair failed — log and stop. CRP already generated if budget hit.
      return { status: 'repair-failed', attempt: repairAttempt }
    }

    // Gate 2: re-validate
    const gate2 = await step.do('repair-gate-2', async () => {
      return evaluateGate2(synthesis, workGraph, this.env)
    })
    if (!gate2.passed) {
      return { status: 'repair-gate2-failed', report: gate2.report }
    }

    // Assemble updated MRP
    const mrp = await step.do('repair-mrp', async () => {
      return assembleMRP({
        functionId: synthesis.functionId,
        workGraph,
        synthesis,
        gate2,
        repairAttempt,
        mentorRules: await getActiveMentorRules(this.env),
        tokenUsage: synthesis.tokenUsage,
      })
    })

    // Push repair commits to existing branch (additive, preserves history)
    await step.do('push-repair', async () => {
      await pushRepairCommits(
        repairContext.branch,
        synthesis.artifacts.commits,
        `repair-${repairAttempt}`,  // commit message prefix for traceability
      )
    })

    // Convert PR to draft if this is repair attempt 2+ (signals instability)
    if (repairAttempt >= 2) {
      await step.do('convert-to-draft', async () => {
        await convertPRToDraft(this.env, repairContext.prNumber)
      })
    }

    // Update PR with repair results
    await step.do('update-pr', async () => {
      await postPRComment(this.env, repairContext.prNumber,
        formatRepairComment(mrp, repairAttempt))
    })

    // CI re-runs automatically on push.
    // If CI fails again → new SIG-ci-fail → back to §4.5 → repair attempt 2/3.
    // If CI passes → SIG-ci-pass → §4.4 → MRP updated with CI evidence.

    return { status: 'repair-pushed', attempt: repairAttempt, mrpId: mrp._key }
  }
}
```

---

### 4.8 CI Failure CRP — Ambiguous Failures

When the classifier returns `ambiguous`, no automated repair runs. Instead,
the system generates a CRP for the architect.

```typescript
async function generateCIFailureCRP(
  env: Env,
  payload: CIFailPayload,
  classification: CIFailureClassification,
) {
  const crp: ConsultationRequestPack = {
    _key: `CRP-${ulid()}`,
    functionRunId: payload.functionId,
    workflowInstanceId: payload.pipelineInstanceId,
    role: 'ci-feedback-loop',
    stage: 'post-ci',

    question: `CI failed on PR #${payload.prNumber} for Function ${payload.functionId}. `
      + `The failure could not be automatically classified. `
      + `Should the Factory attempt an automated repair, or should this be handled manually?`,
    questionType: 'ambiguity',

    context: {
      currentState: `PR #${payload.prNumber} on branch ${payload.branch} failed CI.`,
      optionsConsidered: [
        {
          option: 'Trigger automated repair pipeline',
          pros: 'No architect time required if the fix is straightforward',
          cons: 'May waste compute if the failure is systemic or environmental',
        },
        {
          option: 'Architect investigates and fixes manually',
          pros: 'Human judgment on ambiguous failure',
          cons: 'Requires architect time',
        },
        {
          option: 'Abandon this Function',
          pros: 'Stops spending resources on a potentially unfixable issue',
          cons: 'Loses all pipeline work invested so far',
        },
      ],
      tradeoffs: `Classification: ${classification.type}. `
        + `Affected checks: ${classification.affectedChecks.join(', ')}. `
        + `Repair hint: ${classification.repairHint}`,
      relevantArtifacts: [payload.mrpId, payload.pipelineInstanceId],
    },

    routing: {
      targetRole: 'architect',
      urgency: 'blocking',
    },

    status: 'pending',
    createdAt: new Date().toISOString(),
  }

  await writeToArango(env, 'consultation_requests', crp)

  // Post on PR so architect sees it in GitHub too
  await postPRComment(env, payload.prNumber, formatCIFailureCRPComment(crp))
}
```

---

### 4.9 Branch Naming Contract (Issue 5)

The branch name is the **bidirectional key** between Stage 8 (PR creation)
and the webhook-worker (CI result ingestion). Both sides must agree on the
format. This is a contract, not a convention.

**Format:** `ff-{functionId}`

**Examples:**
```
ff-FN-001                     → functionId: FN-001
ff-FN-META-COMPILER-001       → functionId: FN-META-COMPILER-001
ff-FN-001-repair-2            → functionId: FN-001 (repair suffix stripped)
```

**Contract definition (shared constant):**

```typescript
// packages/schemas/src/branch.ts
// Both Stage 8 and webhook-worker import this

export const BRANCH_PREFIX = 'ff-'

export function toBranchName(functionId: string): string {
  return `${BRANCH_PREFIX}${functionId}`
}

export function toRepairBranchName(functionId: string, attempt: number): string {
  // Repairs push to the SAME branch (additive commits, not new branches)
  // The branch name doesn't change — only commit messages carry the attempt
  return `${BRANCH_PREFIX}${functionId}`
}

export function extractFunctionId(branch: string): string | null {
  if (!branch.startsWith(BRANCH_PREFIX)) return null
  const raw = branch.slice(BRANCH_PREFIX.length)
  // Strip repair suffix if present (legacy, shouldn't occur with additive push)
  return raw.replace(/-repair-\d+$/, '')
}

export function isFactoryBranch(branch: string): boolean {
  return branch.startsWith(BRANCH_PREFIX)
}
```

**Stage 8 uses `toBranchName`:**
```typescript
const branch = toBranchName(synthesis.functionId)
```

**Webhook-worker uses `extractFunctionId`:**
```typescript
const functionId = extractFunctionId(input.branch)
```

**GitHub Actions filter uses prefix:**
```yaml
if: startsWith(github.event.workflow_run.head_branch, 'ff-')
```

All three are derivations of the same shared constant. If the prefix
changes, it changes everywhere.

---

### 4.10 Stale PR/Branch Cleanup Policy (Issue 4)

If an architect never resolves a CRP, stale PRs and `ff-*` branches
accumulate. The Assurance DO handles cleanup via its existing alarm
mechanism.

**Rules:**

| Condition | Action | Trigger |
|---|---|---|
| CRP pending > 14 days | Close PR as stale, delete branch | Assurance DO alarm |
| MRP pending > 30 days | Close PR as stale, delete branch | Assurance DO alarm |
| Repair budget exhausted + no VCR for 7 days | Convert PR to draft, post warning comment | Assurance DO alarm |
| Architect VCR: "abandon" | Close PR immediately, delete branch | VCR handler |

**Implementation:** The Assurance DO's `alarm()` method gains a cleanup
sweep in addition to its Gate 3 checks:

```typescript
async alarm() {
  // Existing: Gate 3 continuous monitoring
  await this.checkDetectorFreshness(config)
  // ...

  // New: Stale PR cleanup
  await this.cleanupStalePRs()

  await this.ctx.storage.setAlarm(Date.now() + GATE_3_INTERVAL_MS)
}

private async cleanupStalePRs() {
  const staleCRPs = await queryArango(this.env, `
    FOR crp IN consultation_requests
      FILTER crp.status == 'pending'
      FILTER DATE_DIFF(crp.createdAt, DATE_NOW(), 'day') > 14
      RETURN crp
  `)

  for (const crp of staleCRPs) {
    // Look up the PR associated with this Function
    const run = await queryArango(this.env, `
      FOR r IN function_runs
        FILTER r.functionId == @fnId
        FILTER r.prNumber != null
        SORT r.createdAt DESC LIMIT 1
        RETURN r
    `, { fnId: crp.functionRunId })

    if (run?.prNumber) {
      await closePR(this.env, run.prNumber, 'Closed: CRP unresolved for 14+ days')
      await deleteBranch(this.env, toBranchName(crp.functionRunId))
    }

    await updateArango(this.env, 'consultation_requests', crp._key, {
      status: 'expired',
    })
  }

  // Same pattern for stale MRPs (30 day threshold)
  // ...
}
```

**Branch deletion is safe** because all artifacts are in ArangoDB (not on
the branch). The branch is a delivery mechanism, not a source of truth.

---

### 4.11 GitHub Token Specification (C3)

Stage 8 (PR creation), repair pipeline (push commits), and cleanup
(close PR, delete branch) all require GitHub API access. The token must
be scoped, short-lived, and non-human.

**Token type:** GitHub App installation token

**Why not a PAT (Personal Access Token):**
- PATs are tied to a human account
- PATs have broad scope (all repos the user can access)
- PATs are long-lived (up to never-expire)
- If the architect leaves the project, the PAT breaks

**GitHub App configuration:**

```
App name: function-factory-bot
Permissions:
  Repository:
    Contents:      Read & Write  (push commits, create branches)
    Pull Requests: Read & Write  (create PR, post comments, convert to draft)
    Checks:        Read          (read CI results — webhook receives these)
    Issues:        Read          (read issue details for signal ingestion)
  Organization:
    Members:       None
    Administration: None
```

**Token lifecycle:**
- GitHub App installation tokens expire after 1 hour
- The gateway-worker requests a fresh token at the start of any
  GitHub-interacting Workflow step
- Token is passed as a step parameter, never stored in ArangoDB
- Token request uses the App's private key (stored as Cloudflare secret)

```typescript
async function getGitHubInstallationToken(env: Env): Promise<string> {
  const jwt = signGitHubAppJWT(env.GITHUB_APP_PRIVATE_KEY, env.GITHUB_APP_ID)
  const { token } = await fetch(
    `https://api.github.com/app/installations/${env.GITHUB_INSTALLATION_ID}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
      },
    }
  ).then(r => r.json())
  return token  // expires in 1 hour
}
```

**Secrets (Cloudflare `wrangler secret put`):**
- `GITHUB_APP_ID` — numeric App ID
- `GITHUB_APP_PRIVATE_KEY` — PEM private key
- `GITHUB_INSTALLATION_ID` — installation ID for the target repo/org

---

### 4.12 The Full CI Feedback Loop — End to End

```
Factory creates PR (Stage 8)
  │
  ├─ Branch name: ff-{functionId}
  ├─ PR body: MRP summary
  │
  ▼
GitHub Actions CI runs (existing lint/test/build)
  │
  ├─ CI passes ──────────────────────────────────────────────────────┐
  │   │                                                              │
  │   ▼                                                              │
  │  factory-feedback.yml fires                                      │
  │   │                                                              │
  │   ▼                                                              │
  │  POST /webhook/ci-result → webhook-worker                       │
  │   │                                                              │
  │   ├─ Parse, validate, classify as ci-pass                       │
  │   ├─ Extract functionId from branch (ff-{functionId})           │
  │   ├─ Look up originating pipeline + MRP in ArangoDB             │
  │   ├─ Compute idempotency key: ci:{workflowRunId}                │
  │   ├─ Deduplicate (reject if key exists)                         │
  │   ├─ Write SIG-{ulid} to specs_signals                          │
  │   ├─ Write to memory_episodic (pain_score: 1, importance: 3)    │
  │   ├─ Enqueue to ff-signals Queue                                │
  │   └─ Update Signal status: ingested                             │
  │   │                                                              │
  │   ▼                                                              │
  │  Queue consumer routes to handleCIPass                           │
  │   │                                                              │
  │   ├─ Update function_run.ciStatus = 'passed'                    │
  │   ├─ Update MRP.ciEvidence (passed, checks, sha)                │
  │   ├─ Post PR comment: "✅ CI Passed — ready for merge"          │
  │   └─ Add lineage edge: Signal → MRP                             │
  │   │                                                              │
  │   ▼                                                              │
  │  Done. PR ready for human merge.                                 │
  │  Dream DO picks up ci-pass pattern on next consolidation.       │
  │                                                                  │
  ├─ CI fails ───────────────────────────────────────────────────────┘
  │   │
  │   ▼
  │  factory-feedback.yml fires
  │   │
  │   ▼
  │  POST /webhook/ci-result → webhook-worker
  │   │
  │   ├─ Same parse/validate/enrich/dedup/persist/enqueue as above
  │   ├─ pain_score: 8, importance: 9 (high-signal failure)
  │   │
  │   ▼
  │  Queue consumer routes to handleCIFail
  │   │
  │   ├─ Update function_run.ciStatus = 'failed'
  │   ├─ Update MRP.verdict = 'needs-revision'
  │   ├─ Classify failure:
  │   │   │
  │   │   ├─ deterministic (lint/type/build) ── triggerRepairPipeline
  │   │   │   │
  │   │   │   ├─ Check repair attempt budget (max 3)
  │   │   │   ├─ If within budget → RepairPipeline Workflow
  │   │   │   │   ├─ Re-enter Stage 6 with failure context
  │   │   │   │   ├─ Coder fixes, Tester re-tests
  │   │   │   │   ├─ Gate 2 re-validates
  │   │   │   │   ├─ Push repair commits to branch (additive, not force)
  │   │   │   │   ├─ CI re-runs automatically
  │   │   │   │   └─ Loop back to top ↑
  │   │   │   └─ If over budget → CRP for architect
  │   │   │
  │   │   ├─ test-regression ── triggerRepairPipeline (same path)
  │   │   │
  │   │   ├─ environment ── log + PR comment (no repair)
  │   │   │
  │   │   └─ ambiguous ── generateCIFailureCRP
  │   │       └─ Architect reviews in ACE/GitHub
  │   │           ├─ VCR: "repair" → triggerRepairPipeline
  │   │           ├─ VCR: "manual" → architect handles
  │   │           └─ VCR: "abandon" → Function abandoned
  │   │
  │   └─ Post PR comment with failure details + classification
  │
  └─ Done. Either repair in progress, CRP pending, or logged.
```

---

### 4.13 Wrangler Configuration — Repair Workflow

The RepairPipeline is a second Workflow class in the compiler package:

```jsonc
// packages/compiler/wrangler.jsonc (addition)
{
  "workflows": [
    {
      "name": "factory-pipeline",
      "binding": "FACTORY_PIPELINE",
      "class_name": "FactoryPipeline"
    },
    {
      "name": "repair-pipeline",
      "binding": "REPAIR_PIPELINE",
      "class_name": "RepairPipeline"
    }
  ]
}
```

---

### 4.14 GitHub Actions Workflows

Two new workflows in `.github/workflows/`:

**factory-signal.yml** — sends GitHub events to the Factory:

```yaml
name: Factory Signal
on:
  issues:
    types: [opened, labeled]
  issue_comment:
    types: [created]
  pull_request:
    types: [opened, synchronize]

jobs:
  signal:
    if: |
      contains(github.event.label.name, 'factory') ||
      contains(github.event.comment.body, '@factory')
    runs-on: ubuntu-latest
    steps:
      - name: Send signal to Factory
        run: |
          curl -sS -X POST "${{ secrets.FACTORY_GATEWAY_URL }}/signal" \
            -H "Authorization: Bearer ${{ secrets.FACTORY_TOKEN }}" \
            -H "Content-Type: application/json" \
            -d '{
              "subtype": "github-event",
              "source": "github-actions",
              "eventType": "${{ github.event_name }}",
              "action": "${{ github.event.action }}",
              "raw": ${{ toJson(github.event) }}
            }'
```

**factory-feedback.yml** — sends CI results back to Factory:

```yaml
name: Factory CI Feedback
on:
  workflow_run:
    types: [completed]

jobs:
  feedback:
    if: startsWith(github.event.workflow_run.head_branch, 'ff-')
    runs-on: ubuntu-latest
    steps:
      - name: Collect check results
        id: checks
        uses: actions/github-script@v7
        with:
          script: |
            const { data } = await github.rest.checks.listForRef({
              owner: context.repo.owner,
              repo: context.repo.repo,
              ref: context.payload.workflow_run.head_sha,
            })
            const checks = data.check_runs.map(c => ({
              name: c.name,
              conclusion: c.conclusion || 'unknown',
              logUrl: c.html_url,
              annotation: c.output?.annotations?.[0]?.message || null,
            }))
            const prs = context.payload.workflow_run.pull_requests
            core.setOutput('payload', JSON.stringify({
              prNumber: prs.length > 0 ? prs[0].number : null,
              branch: context.payload.workflow_run.head_branch,
              conclusion: context.payload.workflow_run.conclusion,
              commitSha: context.payload.workflow_run.head_sha,
              workflowName: context.payload.workflow_run.name,
              workflowRunId: context.payload.workflow_run.id,
              durationMs: new Date(context.payload.workflow_run.updated_at) -
                          new Date(context.payload.workflow_run.run_started_at),
              checks,
            }))

      - name: Report to Factory
        if: steps.checks.outputs.payload != ''
        run: |
          curl -sS -X POST "${{ secrets.FACTORY_GATEWAY_URL }}/webhook/ci-result" \
            -H "Authorization: Bearer ${{ secrets.FACTORY_TOKEN }}" \
            -H "Content-Type: application/json" \
            -d '${{ steps.checks.outputs.payload }}'
```

---

## 5. ACE — Agent Command Environment

The ACE is the architect's workbench. It consumes the gateway-worker API
and provides the human interface for the entire SDLC.

### 5.1 Gateway API Surface (already exists + new endpoints)

```
Existing:
  POST /pipeline          → trigger FactoryPipeline Workflow
  POST /signal            → enqueue Signal
  GET  /specs/:id         → spec lookup
  GET  /health            → system health
  POST /gate/1            → Gate 1 evaluation
  POST /approve/:id       → send Workflow event
  GET  /run/:id           → job status

New (for ACE):
  GET  /crps/pending      → list pending CRPs (inbox)
  GET  /crps/:id          → CRP detail with context
  POST /crps/:id/resolve  → submit VCR for a CRP

  GET  /mrps/pending      → list pending MRPs (inbox)
  GET  /mrps/:id          → MRP detail with progressive disclosure
  POST /mrps/:id/resolve  → submit VCR for an MRP

  GET  /mentorscript      → list active MentorScript rules
  POST /mentorscript      → add rule
  PUT  /mentorscript/:id  → update rule
  DELETE /mentorscript/:id → supersede rule

  GET  /pipelines         → list active/recent Workflow instances
  GET  /pipelines/:id     → pipeline detail (step-by-step status)

  GET  /costs             → per-role, per-provider cost summary
  GET  /costs/:pipelineId → cost breakdown for one pipeline run

  GET  /lineage/:id       → trace artifact back to originating Signal
```

### 5.2 ACE UI (Phase 9, frontend concern — API-only until then)

The ACE is a web application consuming the gateway API. Core views:

**Inbox** — pending CRPs and MRPs sorted by urgency. Each item shows a
one-line summary. Click to expand progressive disclosure: context →
options → trade-offs → relevant code → full artifact chain.

**Pipeline Monitor** — active Workflow instances with step-by-step
progress. Each step shows status (pending/running/completed/failed),
duration, and token usage. Click a step to see its output artifact.

**MentorScript Editor** — browse, search, add, edit, supersede rules.
Conflict detection highlights rules that may contradict. Test a proposed
rule by simulating it against recent Critic outputs.

**Cost Dashboard** — per-role, per-provider, per-pipeline cost tracking.
Aggregated from pi-ai's native token tracking. Shows DCE recommendations
(should this role escalate from Haiku to Sonnet?).

**Lineage Explorer** — visual graph traversal. Pick any artifact, see
its full provenance chain back to the originating Signal. Uses ArangoDB's
`lineage_edges` graph collection.

**Session Inspector** — for debugging Stage 6 repair loops. Shows the
pi SDK session tree: every prompt, every tool call, every branch point.
Available for pi SDK executions; not available for Container fallback runs
(those produce execution artifacts instead).

---

## 6. Full SDLC Coverage Map

```
SDLC Phase               Factory Stage          SASE Artifact       Output
──────────────────────────┼───────────────────────┼───────────────────┼──────────────────
Signal detection          │ Stage 1               │ —                 │ Signal
Requirements/Intent       │ Stages 2-4            │ ≈ BriefingScript  │ Pressure, Capability, PRD
Architect approval        │ waitForEvent           │ —                 │ VCR (approval)
Semantic review           │ Pre-compile step       │ CRP (if uncertain)│ Review verdict
Design/Compilation        │ Stage 5 (8 passes)     │ —                 │ WorkGraph
Structural validation     │ Gate 1                 │ —                 │ Coverage Report
Implementation            │ Stage 6: Coder         │ CRP (if stuck)    │ Code artifacts
Code review               │ Stage 6: Critic        │ MentorScript      │ Critique report
Testing                   │ Stage 6: Tester        │ —                 │ Test plan + results
Verdict                   │ Stage 6: Verifier      │ —                 │ Pass/patch/fail
Repair loop               │ Verifier → Coder       │ CRP (if budget)   │ Revised artifacts
Simulation validation     │ Gate 2                 │ —                 │ Coverage Report
Evidence bundling         │ MRP assembly           │ MRP               │ Merge-Readiness Pack
Human review              │ waitForEvent (MRP)     │ VCR               │ Approval/rejection
PR creation               │ Stage 8 (new)          │ —                 │ GitHub PR + MRP
CI validation             │ GitHub Actions         │ —                 │ CI reports
Merge                     │ Human (manual)         │ —                 │ Merged code
Deployment                │ Existing CD            │ —                 │ Deployed Function
Runtime monitoring        │ Stage 7 + Gate 3       │ —                 │ Coverage Reports
Maintenance/Learning      │ Dream DO               │ MentorScript (new)│ Crystallized rules
Regression response       │ CI feedback → Pipeline │ —                 │ New Signal → new run
```

---

## 7. ArangoDB Collections — New

Added to the existing collection design from the deployment architecture:

```
New document collections:
  mentorscript_rules       ── MR-* typed rules
  consultation_requests    ── CRP-* structured agent questions
  version_controlled_resolutions ── VCR-* architect decisions
  merge_readiness_packs    ── MRP-* evidence bundles
```

All four collections participate in the lineage graph via `lineage_edges`:

```
PRD ←── CRP (generated during PRD's execution)
CRP ←── VCR (resolves the CRP)
VCR ──→ MentorRule (if the resolution proposes a new rule)
MRP ←── Gate1 Report + Gate2 Report + Synthesis artifacts
MRP ←── VCR (architect approval/rejection)
```

---

## 8. Workflow Revision — Full Pipeline with SDLC Artifacts

The FactoryPipeline Workflow from the deployment architecture gains
three new steps: semantic review (already patched), MRP assembly, and
PR creation.

```
step.do('ingest-signal')
step.do('synthesize-pressure')
step.do('map-capability')
step.do('propose-function')
step.waitForEvent('architect-approval')       → VCR
step.do('semantic-review')                    → may generate CRP
step.do('compile-pass-1') ... step.do('compile-pass-8')
step.do('gate-1')
step.do('stage-6-synthesis')                  → may generate CRPs
step.do('gate-2-simulation')
step.do('assemble-mrp')                       ← NEW
step.waitForEvent('mrp-{id}')                 ← NEW (architect reviews MRP)
step.do('persist-artifacts')
step.do('create-pr')                          ← NEW (Stage 8)
step.do('register-monitoring')
```

Total: ~20 steps for a full pipeline run (8 compile passes + 12 other
steps). Well within Workflows' 25,000 step limit.

---

## 9. Migration Path (SDLC additions to deployment phases)

| Phase | Deployment Architecture | SDLC Architecture (this doc) |
|-------|-------------------------|------------------------------|
| 0 | Current state | — |
| 1 | ArangoDB (local Docker) | Create new collections (MR, CRP, VCR, MRP, mentorscript_rules) |
| 2 | Edge Workers + Gate 1 | Add CRP/MRP/MentorScript API endpoints |
| 3 | Workflows (Stages 1-5) | Add semantic review + MRP assembly steps. MentorScript rules loaded into Critic prompts |
| 4 | Coordinator DO + LangGraph + pi SDK | CRP generation in role nodes. Pi SDK extensions load MentorScript rules for Coder/Tester tool gating |
| 5 | Container fallback | — (no SDLC change) |
| 6 | Assurance DO + Dream DO + Gate 3 | Crystallization → MentorRule proposal. Stale PR cleanup. |
| 7 | — | Stage 8 (PR creation) + CI feedback loop + repair pipeline |
| 8 | — | GitHub App installation + branch contract enforcement |
| 9 | — | ACE UI (frontend — API-only until this phase) |

**MentorScript across phases:**
- Phase 1: `mentorscript_rules` collection created, empty
- Phase 3: Critic Workflow step loads active rules, checks compliance
- Phase 4: Pi SDK extensions load rules for Coder/Tester tool gating
- Phase 6: Dream DO crystallization proposes new rules
- Phase 7+: CI feedback loop generates MentorRule proposals from recurring failures
- Phase 9: ACE UI provides MentorScript editor for browsing/adding/testing rules

Phases 7-9 are new to the SDLC architecture. Phase 7 closes the loop
between the Factory and the codebase. Phase 9 gives the architect a
proper command center. All API functionality is available in Phases 2-8
via the gateway-worker endpoints; Phase 9 adds the UI. Each phase is
independently deployable.

---

## 10. What This Architecture Does NOT Do

- **Does not replace CI/CD.** The Factory produces PRs. Existing CI
  validates them. Existing CD deploys them. The Factory is not Jenkins,
  GitHub Actions, or ArgoCD.
- **Does not auto-merge.** Human merges PRs. The Factory creates merge-
  ready evidence, not merge authority.
- **Does not auto-deploy.** The Factory monitors deployed Functions
  (Gate 3) but does not perform deployment. ADR-002 §7: "Workers cannot
  merge PR, deploy, or modify production systems."
- **Does not prescribe an ACE implementation.** The API surface is
  defined. Whether the ACE is a web app, a CLI dashboard, a VS Code
  extension, or a Slack bot is a Phase 9 implementation choice.
  Until then, all ACE functionality is available via gateway-worker API.
- **Does not require all artifacts from day one.** MentorScript can
  start empty. CRPs can start as simple `waitForEvent` gates. MRPs can
  start as a Coverage Report dump. Structure accretes as the Factory
  matures. The artifact schemas are the target; the implementation can
  grow into them.
