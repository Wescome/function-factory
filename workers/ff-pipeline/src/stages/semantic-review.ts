import type { ArangoClient } from '@factory/arango-client'
import type { PipelineEnv, SemanticReviewResult } from '../types'
import { callModel } from '../model-bridge'

const SYSTEM_PROMPT = `You are a Semantic Reviewer in the Function Factory pipeline.

You review a Intent Specification (Product Requirements Document) BEFORE it enters compilation.
Your job is to catch conceptual misalignment — cases where the Intent Specification is
structurally valid but semantically wrong.

Questions to answer:
1. Does the Intent Specification's objective align with its source Capability?
2. Are the acceptance criteria testable and relevant?
3. Are the invariants meaningful (not trivial or tautological)?
4. Is the scope appropriate (not too broad, not too narrow)?
5. Do the source_refs actually support the claims made?

Output JSON:
{
  "alignment": "aligned | miscast | uncertain",
  "confidence": 0.0-1.0,
  "citations": ["Specific source_refs that support or contradict the Intent Specification"],
  "rationale": "Why you assessed this alignment level"
}

"miscast" = the Intent Specification is fundamentally wrong about what it's trying to do.
"uncertain" = you can't tell — needs human review.
"aligned" = the Intent Specification correctly captures the intent.

Respond ONLY with valid JSON.`

const GROUNDED_SYSTEM_PROMPT = `You are a Semantic Reviewer in the Function Factory pipeline.

You review a Intent Specification BEFORE it enters compilation. Your job is to verify
that the Intent Specification faithfully represents the ORIGINAL SPECIFICATION it was
derived from.

Compare this Intent Specification against the ORIGINAL SPECIFICATION provided.

Questions to answer:
1. Does the Intent Specification's objective match what the specification actually says?
2. Are the acceptance criteria derivable from the specification?
3. Are the invariants grounded in specification constraints?
4. Does the scope match the specification's boundaries?
5. Is anything in the Intent Specification NOT in the specification (hallucinated)?
6. Is anything in the specification NOT in the Intent Specification (dropped)?

Output JSON:
{
  "alignment": "aligned | miscast | uncertain",
  "confidence": 0.0-1.0,
  "citations": ["Specific spec passages supporting your assessment"],
  "rationale": "Why you assessed this alignment level"
}

"miscast" = the Intent Specification is fundamentally wrong about what the spec says.
"uncertain" = you can't tell — needs human review.
"aligned" = the Intent Specification correctly captures the specification's intent.

Respond ONLY with valid JSON.`

export async function semanticReview(
  proposal: Record<string, unknown>,
  db: ArangoClient,
  env: PipelineEnv,
  dryRun: boolean,
): Promise<SemanticReviewResult> {

  if (dryRun) {
    return {
      alignment: 'aligned',
      confidence: 1.0,
      citations: [],
      rationale: 'Dry-run — no semantic review performed',
      timestamp: new Date().toISOString(),
    }
  }

  const intentSpecification = proposal.intentSpecification as Record<string, unknown>
  const hasSpecContent = typeof proposal.specContent === 'string' && proposal.specContent.length > 0

  const systemPrompt = hasSpecContent ? GROUNDED_SYSTEM_PROMPT : SYSTEM_PROMPT

  const userPayload: Record<string, unknown> = {
    proposalId: proposal._key,
    title: proposal.title,
    intentSpecification: {
      title: intentSpecification?.title,
      objective: intentSpecification?.objective,
      acceptanceCriteria: intentSpecification?.acceptanceCriteria,
      invariants: intentSpecification?.invariants,
      scope: intentSpecification?.scope,
    },
    sourceCapabilityId: proposal.sourceCapabilityId,
    sourceRefs: proposal.sourceRefs,
  }

  if (hasSpecContent) {
    userPayload.originalSpecification = proposal.specContent
  }

  const userMessage = JSON.stringify(userPayload)

  const result = await callModel('semantic_review', systemPrompt, userMessage, env)
  const parsed = JSON.parse(result)

  const review: SemanticReviewResult = {
    alignment: parsed.alignment ?? 'uncertain',
    confidence: parsed.confidence ?? 0.5,
    citations: parsed.citations ?? [],
    rationale: parsed.rationale ?? 'No rationale provided',
    timestamp: new Date().toISOString(),
  }

  await db.save('verification_reports', {
    _key: `VR-SR-${proposal._key}-${Date.now().toString(36)}`,
    type: 'semantic-review',
    passed: review.alignment === 'aligned',
    proposalId: proposal._key,
    sourceRefs: [`FP:${proposal._key}`],
    ...review,
  })

  return review
}
