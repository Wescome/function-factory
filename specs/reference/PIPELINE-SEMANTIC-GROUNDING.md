# PIPELINE-SEMANTIC-GROUNDING

> Design spec: Fix the Factory pipeline's semantic blindness
> Author: Architect Agent (2026-04-25)
> Status: Proposed. Pending Architect approval.
> Traces to: DECISIONS 2026-04-19 "Gate 1 PASS does not imply conceptual correctness",
> DECISIONS 2026-04-24 "Semantic-alignment review via Critic-role involvement",
> DECISIONS 2026-04-24 "Universal Critic review before compilation — no exceptions",
> DECISIONS 2026-04-24 "Specification pipeline is self-sustaining"

---

## 1. Problem Statement

The Factory pipeline (Stages 1-4 in `ff-pipeline`) is semantically blind.
Each stage receives a one-paragraph prompt and the previous stage's JSON
output. By Stage 4 (Function Proposal + PRD), the model has never seen the
actual architectural specification that the Signal references. The model
hallucinates a generic PRD from a Capability title derived from a Pressure
title derived from a 1-2 sentence Signal description. The Stage 5 compiler
faithfully decomposes the hallucinated PRD into a well-structured but
semantically wrong WorkGraph.

**Evidence:** All 10 live-produced WorkGraphs are hallucinated or suspect.
Zero valid. Gate 1 passed all of them because Gate 1 checks structure, not
semantics. The Critic review (semantic-review.ts) runs post-Stage 4 but
checks the PRD against the Capability — which is itself hallucinated from
the same thin context. The Critic is comparing hallucination against
hallucination.

### Root causes

1. **Signals carry no spec content.** `SignalInput` has `title`, `description`
   (1-2 sentences), and `evidence` (string array). No field carries or
   references the actual architectural specification (e.g., 800 lines of
   Phase 5 v3, or a whitepaper section). The model at Stage 2 has never
   seen the thing it is reasoning about.

2. **Each stage prompt says "Output JSON" from thin air.** The system prompts
   in `synthesize-pressure.ts`, `map-capability.ts`, and `propose-function.ts`
   each give a role description and ask for JSON output. The user message is
   a JSON dump of the previous stage's output — typically 5-10 fields, none
   containing substantive spec content. The model fills gaps with generic
   patterns.

3. **The Critic verifies against hallucinated ground truth.** In
   `semantic-review.ts`, the Critic receives the proposal's PRD and its
   `sourceCapabilityId` + `sourceRefs`. But `sourceRefs` are IDs, not
   content. The Capability it would need to check against was itself
   hallucinated at Stage 3 from thin context. There is no ground truth
   in the review loop.

4. **No stage has access to reference documents.** None of the stage prompts
   reference DECISIONS.md, the whitepaper, ConOps, or any architectural
   specification. The pipeline operates in a vacuum.

---

## 2. Design Principles

These are non-negotiable constraints on any solution.

**P1: Content at the source.** The spec content that grounds a Signal must
enter the pipeline at Stage 1, not be reconstructed by LLM inference at
Stages 2-4. Information cannot be created by passing through a telephone
game of LLM calls. It can only be preserved or lost.

**P2: Stages 2-4 are derivation, not generation.** When spec content is
present, Stages 2-4 derive structured artifacts from that content. They do
not generate content from titles. The distinction: derivation extracts and
restructures existing meaning; generation invents meaning that may not exist
in the source.

**P3: The Critic verifies against source, not against pipeline intermediates.**
The semantic review must compare the PRD against the original spec content
attached to the Signal — not against the Capability or Pressure, which are
themselves derived artifacts that may have lost fidelity.

**P4: Pre-authored artifacts skip, not duplicate.** When a Signal already
carries a pre-authored PRD (as the human-authored meta-PRDs do), the
pipeline should accept it directly, not force it through LLM re-derivation
that can only degrade it.

**P5: Minimum change, maximum leverage.** The fix must work within CF
Workflows (step.do calls, ofox.ai LLM calls). It must not require
restructuring the pipeline's stage sequence or the Workflow orchestration.
The changes are: (a) what data enters the pipeline, (b) what data each
stage prompt receives, (c) what the Critic reviews against.

---

## 3. Design

### 3.1 Signal schema extension: `specContent` and `preAuthored`

Extend `SignalInput` in `types.ts` with two new optional fields:

```typescript
export interface SignalInput {
  // ... existing fields unchanged ...

  /**
   * The substantive specification content this Signal references.
   * Can be: inline markdown content, an ArangoDB document key
   * (prefix "arango:"), or a specs/ file path (prefix "file:").
   *
   * When present, this is the ground truth that Stages 2-4 must
   * derive from. When absent, Stages 2-4 operate in generation
   * mode (current behavior — suitable only for exploratory signals
   * where no spec exists).
   */
  specContent?: string

  /**
   * Pre-authored pipeline artifacts that skip LLM derivation.
   * Each key names the stage output; the value is the artifact content.
   *
   * When preAuthored.prd is present, Stages 2-4 still run (for lineage
   * artifact creation) but the LLM-generated PRD is REPLACED by the
   * pre-authored PRD before entering Stage 5.
   */
  preAuthored?: {
    pressure?: Record<string, unknown>
    capability?: Record<string, unknown>
    prd?: Record<string, unknown>
  }
}
```

**Rationale:** `specContent` solves root cause 1. The Signal becomes the
carrier of ground truth, not just a title. `preAuthored` solves the case
where the Architect has already written the artifacts — the pipeline
preserves lineage without degrading pre-authored content through LLM
re-derivation.

**ArangoDB storage:** `specContent` is stored verbatim on the signal
document. For large specs (>50KB), the `arango:` prefix convention stores
the content as a separate document in a `spec_content` collection and the
signal holds the reference key. Resolution happens at Stage 2 entry.

### 3.2 Spec content resolution

Add a resolution function in a new file `stages/resolve-spec.ts`:

```typescript
export async function resolveSpecContent(
  signal: Record<string, unknown>,
  db: ArangoClient,
): Promise<string | null>
```

Resolution rules:
- If `signal.specContent` is a string starting with `arango:`, fetch from
  `spec_content` collection by key.
- If `signal.specContent` is a string starting with `file:`, this is a
  reference to a `specs/` path. Not resolvable at runtime in CF Workers
  (no filesystem). The ingestion endpoint must inline the content before
  pipeline entry. The `file:` prefix is an authoring convenience that the
  ingestion API resolves.
- If `signal.specContent` is a plain string, it IS the content (inline).
- If `signal.specContent` is absent or null, return null (generation mode).

This function is called once, at the start of Stage 2, and the resolved
content is threaded through all subsequent stages.

### 3.3 Stage prompt changes: derivation mode vs generation mode

Each of Stages 2-4 operates in one of two modes based on whether
`specContent` resolved to non-null.

**Generation mode (specContent is null):** Current behavior. The model
receives the previous stage's JSON and generates output. This mode remains
for exploratory signals where no specification exists. A warning flag
`derivationMode: "generated"` is set on the output artifact.

**Derivation mode (specContent is non-null):** The model receives the
previous stage's JSON AND the resolved spec content. The system prompt
changes from "synthesize/map/propose" to "extract and structure."

#### Stage 2: synthesize-pressure.ts (derivation mode)

System prompt (replaces current when specContent present):

```
You are a Pressure Extractor in the Function Factory pipeline.

Given a Signal and its referenced specification content, extract the
Pressure — the force this specification exerts on the system.

Do NOT invent information. Every field you produce must be traceable
to a specific passage in the specification content. If the specification
does not address a field, set it to null rather than guessing.

SPECIFICATION CONTENT:
{specContent}

Output JSON with these fields:
{
  "title": "...",
  "description": "...",
  "priority": "...",
  "category": "...",
  "sourceSignalId": "...",
  "evidence": ["Direct quotes or paraphrases from the spec"],
  "sourceRefs": ["..."],
  "derivationMode": "extracted"
}
```

The key change: the spec content is IN the prompt. The model extracts
from it rather than inventing from a title.

#### Stage 3: map-capability.ts (derivation mode)

System prompt includes spec content AND the pressure. The model identifies
the capability gap that the specification addresses, quoting from the spec.

#### Stage 4: propose-function.ts (derivation mode)

System prompt includes spec content, pressure, AND capability. The model
produces a PRD whose acceptance criteria, invariants, and scope are
extracted from the specification — not invented.

**Critical constraint:** When `preAuthored.prd` is present on the Signal,
Stage 4's LLM output is discarded. The pre-authored PRD is used instead.
Stage 4 still runs (its output is stored for comparison/audit) but the
pipeline continues with the pre-authored PRD. This is logged explicitly:
`prdSource: "pre-authored"` vs `prdSource: "derived"` vs
`prdSource: "generated"`.

### 3.4 Critic review: verify against spec content, not pipeline intermediates

The current `semantic-review.ts` receives:
- The proposal's PRD
- The proposal's `sourceCapabilityId` and `sourceRefs`

This is insufficient. The Critic is comparing derived artifact against
derived artifact. It has no ground truth.

**New Critic input (derivation mode):** When `specContent` is present on
the originating Signal, the Critic receives:

1. The PRD (as now)
2. The resolved spec content (ground truth)
3. The Signal's original title and description (for context)

The Critic's question changes from "does this PRD align with its source
Capability?" to "does this PRD faithfully represent the specification
content attached to the originating Signal?"

**New system prompt for semantic-review.ts (derivation mode):**

```
You are a Semantic Reviewer in the Function Factory pipeline.

You review a PRD BEFORE it enters compilation. Your job is to verify
that the PRD faithfully represents the SPECIFICATION CONTENT it was
derived from.

SPECIFICATION CONTENT (ground truth):
{specContent}

SIGNAL CONTEXT:
Title: {signal.title}
Description: {signal.description}

PRD UNDER REVIEW:
{prd as JSON}

Questions to answer:
1. Does the PRD's objective match what the specification actually says?
2. Are the acceptance criteria derivable from the specification?
3. Are the invariants grounded in specification constraints?
4. Does the scope match the specification's boundaries?
5. Is anything in the PRD NOT in the specification (hallucinated)?
6. Is anything in the specification NOT in the PRD (dropped)?

Output JSON:
{
  "alignment": "aligned | miscast | uncertain",
  "confidence": 0.0-1.0,
  "groundedCriteria": ["AC numbers that trace to spec passages"],
  "ungroundedCriteria": ["AC numbers with no spec basis"],
  "missedContent": ["Spec content not reflected in PRD"],
  "citations": ["Specific spec passages supporting your assessment"],
  "rationale": "..."
}
```

**Generation mode Critic:** When specContent is null, the Critic falls
back to current behavior (review against Capability). A warning is
attached: `reviewBasis: "pipeline-intermediate"` vs
`reviewBasis: "source-specification"`.

### 3.5 Pipeline orchestration changes in pipeline.ts

The orchestration changes are minimal. After Stage 1 (signal ingestion),
add a spec resolution step:

```typescript
// ── Resolve spec content (if referenced by signal) ──
const specContent = await step.do('resolve-spec', async () => {
  const resolved = await resolveSpecContent(signal, db)
  return { content: resolved }
})
```

Thread `specContent.content` through Stages 2-4 and the Critic as an
additional parameter. Each stage function gains an optional
`specContent: string | null` parameter.

For pre-authored PRDs: after Stage 4, check if `params.signal.preAuthored?.prd`
exists. If so, replace the proposal's `prd` field before entering the
semantic review and Stage 5.

```typescript
// ── Pre-authored PRD substitution ──
if (params.signal.preAuthored?.prd) {
  proposal.prd = params.signal.preAuthored.prd
  proposal.prdSource = 'pre-authored'
}
```

### 3.6 Mode markers on all artifacts

Every pipeline-produced artifact carries a `derivationMode` field:

| Value | Meaning |
|---|---|
| `extracted` | Derived from specContent by LLM extraction |
| `generated` | Generated by LLM from title/description only (current behavior) |
| `pre-authored` | Human-authored, passed through pipeline for lineage |

This field is queryable. It enables: "show me all WorkGraphs produced
from generated (non-grounded) PRDs" — which is the query that reveals
the current problem at scale.

---

## 4. What about Stages 2-4 for spec-bearing Signals?

**Question 5 from the brief:** Should Stages 2-4 even be LLM-driven for
signals that already have a spec?

**Answer: Yes, but in derivation mode — with one exception.**

Stages 2-4 serve two purposes even when spec content is present:

1. **Lineage artifact creation.** The Pressure, Capability, and Function
   Proposal documents are lineage nodes in the ArangoDB graph. Skipping
   them breaks the lineage chain that every downstream artifact and
   gate check depends on.

2. **Structured extraction.** The spec content is unstructured markdown.
   Stages 2-4 in derivation mode extract structured JSON (priority,
   category, gap analysis, acceptance criteria) from that content. This
   is useful work — it is the difference between "we have a spec" and
   "we have a spec decomposed into the pipeline's artifact vocabulary."

**The exception: pre-authored PRDs.** When `preAuthored.prd` is present,
Stage 4's LLM output is replaced. The human-authored PRD is
architecturally correct by construction (the Architect wrote it against
the whitepaper). Forcing it through LLM re-derivation can only lose
fidelity. Stages 2-3 still run in derivation mode to produce the
Pressure and Capability lineage nodes.

**Future optimization:** If a Signal carries `preAuthored.pressure` and
`preAuthored.capability`, those stages also skip LLM and use the
pre-authored artifacts directly. This is the path for fully human-authored
spec chains (the current meta-PRD authoring workflow).

---

## 5. Minimum viable fix

The full design above is the correct long-term architecture. But the
brief asks: "What's the minimum change to stop producing garbage?"

**Minimum change (3 files, <100 lines net):**

1. **types.ts:** Add `specContent?: string` to `SignalInput`.

2. **propose-function.ts:** When `specContent` is present in the
   originating signal (threaded through pipeline state), include it in
   the Stage 4 prompt. This alone eliminates the worst hallucinations
   because Stage 4 (PRD generation) is where the most damage occurs.
   Stages 2-3 hallucinations are less harmful because their outputs are
   not compiled — the PRD is what enters Stage 5.

3. **semantic-review.ts:** When `specContent` is available, include it
   in the Critic prompt as ground truth instead of relying on the
   Capability.

**Why Stage 4 is the leverage point:** The compiler (Stage 5) consumes
only the PRD. It never sees the Pressure or Capability directly. A
hallucinated Pressure that produces a grounded PRD still yields a
valid WorkGraph. A grounded Pressure that produces a hallucinated PRD
yields garbage. Stage 4 is where fidelity matters most.

---

## 6. Implementation plan

### Phase 1: Stop the bleeding (1 session)

- Add `specContent` to `SignalInput` (types.ts)
- Add `resolveSpecContent` function (new file: stages/resolve-spec.ts)
- Modify `proposeFunction` to accept and use specContent in derivation mode
- Modify `semanticReview` to accept and verify against specContent
- Thread specContent through pipeline.ts
- Tests: unit tests for resolveSpecContent, integration test for
  derivation-mode Stage 4

### Phase 2: Full derivation mode (1 session)

- Add derivation-mode prompts to synthesize-pressure.ts and map-capability.ts
- Add `derivationMode` markers to all artifact outputs
- Add `preAuthored` support to SignalInput and pipeline.ts
- Tests: integration tests for pre-authored PRD passthrough

### Phase 3: Spec content storage (1 session)

- Create `spec_content` ArangoDB collection
- Implement `arango:` prefix resolution in resolveSpecContent
- Build ingestion API endpoint that resolves `file:` prefixes by reading
  local spec files and inlining content
- Tests: integration tests for arango-backed spec resolution

### Phase 4: Retroactive cleanup

- Re-run the 10 existing Signals through the pipeline with specContent
  attached
- Compare old (generated) vs new (derived) WorkGraphs
- Archive or mark the 10 hallucinated WorkGraphs as `derivationMode: "generated"`

---

## 7. Risk assessment

**Risk 1: specContent exceeds model context window.**
Mitigation: ofox.ai routes to models with 128K+ context. An 800-line
spec is ~3K tokens. Even with the full prompt + previous stage JSON,
this is well within limits. For exceptionally large specs, the
`arango:` indirection allows storing a summary alongside the full
content, with the prompt receiving the summary and the full content
available for citation verification.

**Risk 2: Derivation mode still hallucinates.**
Mitigation: The Critic now has ground truth to verify against. Even if
Stage 4 hallucinates details, the Critic catches them because it
compares the PRD against the spec content, not against another
derived artifact. This is the defense-in-depth: derivation reduces
hallucination; Critic-with-ground-truth catches what remains.

**Risk 3: Pre-authored PRD skips LLM improvement.**
This is a feature, not a risk. The Architect's PRD is the ground truth.
LLM "improvement" of a human-authored PRD is degradation. The PRD
still passes through the Critic and Gate 1 — both of which can reject
it on their own terms.

**Risk 4: Migration burden for existing signals.**
Mitigation: Existing signals continue to work in generation mode.
The `derivationMode` marker makes the quality difference visible.
No breaking changes.

---

## 8. Success criteria

1. A Signal with specContent produces a PRD whose acceptance criteria
   are traceable to specific passages in the spec.
2. The Critic, given specContent as ground truth, can identify ungrounded
   criteria in a derived PRD.
3. A pre-authored PRD passes through the pipeline without LLM degradation,
   with lineage intact.
4. The `derivationMode` field on every artifact makes the grounding
   quality queryable.
5. Zero new hallucinated WorkGraphs from spec-bearing Signals.

---

## 9. Relationship to existing decisions

| Decision | Relationship |
|---|---|
| Gate 1 PASS does not imply conceptual correctness (2026-04-19) | This spec addresses the gap Gate 1 cannot close — semantic grounding |
| Semantic-alignment via Critic role (2026-04-24) | This spec gives the Critic actual ground truth to verify against |
| Universal Critic review (2026-04-24) | Unchanged — Critic still runs on every PRD. What changes is its input |
| Specification pipeline is self-sustaining (2026-04-24) | This spec strengthens the pipeline's autonomy by reducing dependence on LLM generation |

---

## 10. What this does NOT address

- **Gate 1 structural checks.** Unchanged. Gate 1 remains necessary for
  structural coverage. This spec addresses the semantic gap Gate 1
  cannot close.
- **Stage 6 (Function Synthesis).** Unchanged. The synthesis topology
  consumes WorkGraphs; better WorkGraphs produce better synthesis.
- **Self-sensing Signals.** The Factory cannot yet sense its own
  operational state to produce Signals. This spec assumes Signals are
  externally authored (by the Architect or by integrations). Self-sensing
  is a Stage 7 concern.
- **Prompt engineering details.** The exact wording of derivation-mode
  prompts is implementation-level. This spec establishes the principle
  (spec content in prompt, extraction not generation) and the data flow
  (specContent threaded through pipeline). Prompt tuning is Phase 2 work.
