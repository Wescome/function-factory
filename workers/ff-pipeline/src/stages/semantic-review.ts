import type { ArangoClient } from '@factory/arango-client'
import type { PipelineEnv, SemanticReviewResult } from '../types'
import { callModel } from '../model-bridge'

const SYSTEM_PROMPT = `You are a Semantic Reviewer in the Function Factory pipeline.

You review a PRD (Product Requirements Document) BEFORE it enters compilation.
Your job is to catch conceptual misalignment — cases where the PRD is
structurally valid but semantically wrong.

Questions to answer:
1. Does the PRD's objective align with its source Capability?
2. Are the acceptance criteria testable and relevant?
3. Are the invariants meaningful (not trivial or tautological)?
4. Is the scope appropriate (not too broad, not too narrow)?
5. Do the source_refs actually support the claims made?

Output JSON:
{
  "alignment": "aligned | miscast | uncertain",
  "confidence": 0.0-1.0,
  "citations": ["Specific source_refs that support or contradict the PRD"],
  "rationale": "Why you assessed this alignment level"
}

"miscast" = the PRD is fundamentally wrong about what it's trying to do.
"uncertain" = you can't tell — needs human review.
"aligned" = the PRD correctly captures the intent.

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

  const prd = proposal.prd as Record<string, unknown>

  const userMessage = JSON.stringify({
    proposalId: proposal._key,
    title: proposal.title,
    prd: {
      title: prd?.title,
      objective: prd?.objective,
      acceptanceCriteria: prd?.acceptanceCriteria,
      invariants: prd?.invariants,
      scope: prd?.scope,
    },
    sourceCapabilityId: proposal.sourceCapabilityId,
    sourceRefs: proposal.sourceRefs,
  })

  const result = await callModel('critic', SYSTEM_PROMPT, userMessage, env)
  const parsed = JSON.parse(result)

  const review: SemanticReviewResult = {
    alignment: parsed.alignment ?? 'uncertain',
    confidence: parsed.confidence ?? 0.5,
    citations: parsed.citations ?? [],
    rationale: parsed.rationale ?? 'No rationale provided',
    timestamp: new Date().toISOString(),
  }

  await db.save('specs_coverage_reports', {
    _key: `CR-SR-${proposal._key}`,
    type: 'semantic-review',
    proposalId: proposal._key,
    ...review,
  })

  return review
}
