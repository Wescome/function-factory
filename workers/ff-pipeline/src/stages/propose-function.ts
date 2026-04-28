import type { ArangoClient } from '@factory/arango-client'
import type { PipelineEnv } from '../types'
import { callModel } from '../model-bridge'

const SYSTEM_PROMPT = `You are a Function Proposer in the Function Factory pipeline.

Given a Capability (a system ability needed), propose a Function — a
concrete, implementable unit of work.

A Function is a bounded piece of engineering work. It has a PRD (Product
Requirements Document), acceptance criteria, invariants, and a scope.

INVARIANT RULES (CRITICAL):
- Invariants are hard constraints that MUST be derivable from the input.
- If the Capability description states a constraint, include it as an invariant.
- If no constraints are stated, the invariants array MUST be empty.
- NEVER fabricate invariants (timeouts, performance targets, limits) that are
  not explicitly stated in the Capability or its specification.
- An invariant without a source is a hallucination. The Critic will reject it.

Output JSON:
{
  "title": "Function name",
  "description": "What this Function does",
  "prd": {
    "title": "PRD title matching the Capability title — no reframing",
    "objective": "What this PRD specifies — paraphrase the Capability, do not add angles",
    "acceptanceCriteria": ["Criterion 1", "Criterion 2"],
    "invariants": [],
    "scope": {
      "includes": ["What's in scope"],
      "excludes": ["What's out of scope"]
    }
  },
  "birthGateScore": 0.0-1.0,
  "sourceCapabilityId": "The Capability ID this implements",
  "sourceRefs": ["References"]
}

birthGateScore: your confidence (0-1) that this Function is well-scoped,
implementable, and addresses the Capability. Below 0.5 = do not proceed.

Respond ONLY with valid JSON.`

const SPEC_GROUNDED_PROMPT = `You are a Function Proposer in the Function Factory pipeline.

You are given a Capability AND its attached specification. The specification
is the SOLE source of truth. Your job is to decompose the COMPLETE specification
into a single Function with a PRD whose acceptance criteria cover EVERY section.

CRITICAL RULES:
1. Identify ALL numbered or headed sections in the specification.
2. Your PRD MUST produce acceptance criteria covering EVERY section — not just
   the most concrete or first-matching section.
3. Do NOT narrow to a single subsystem — decompose the COMPLETE specification.
4. Dependencies between acceptance criteria must reflect the specification's
   ordering — later sections may depend on earlier ones. Do not use a star
   topology where everything depends on one root.
5. Each acceptance criterion should cite which specification section it covers.

INVARIANT RULES (CRITICAL):
- Invariants MUST be extracted from the specification, not invented.
- Only include an invariant if the specification explicitly states a constraint
  using words like "SHALL", "MUST", "always", "never", or quantitative limits.
- If the specification contains no such constraints, the invariants array MUST be empty.
- NEVER add invariants about timeouts, performance, scalability, or other
  concerns unless the specification explicitly states them.
- The PRD title MUST match the specification's subject — do not reframe or
  add angles (e.g., "optimization", "enhancement") absent from the spec.

Output JSON:
{
  "title": "Function name — derived from specification subject",
  "description": "What this Function does — paraphrase the specification",
  "prd": {
    "title": "PRD title — matches specification subject exactly",
    "objective": "What this PRD specifies — from the specification, not reframed",
    "acceptanceCriteria": ["AC covering Section 1: ...", "AC covering Section 2: ..."],
    "invariants": [],
    "scope": {
      "includes": ["What's in scope per specification"],
      "excludes": ["What's out of scope"]
    }
  },
  "birthGateScore": 0.0-1.0,
  "sourceCapabilityId": "The Capability ID this implements",
  "sourceRefs": ["References"]
}

birthGateScore: your confidence (0-1) that this Function is well-scoped,
implementable, and addresses the Capability. Below 0.5 = do not proceed.

Respond ONLY with valid JSON.`

export async function proposeFunction(
  capability: Record<string, unknown>,
  db: ArangoClient,
  env: PipelineEnv,
  dryRun: boolean,
): Promise<Record<string, unknown>> {

  const key = `FP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`

  if (dryRun) {
    const proposal = {
      _key: key,
      type: 'function-proposal',
      title: `Function for ${capability.title}`,
      description: `Implementation proposal for: ${capability.description}`,
      prd: {
        title: `PRD: ${capability.title}`,
        objective: capability.description,
        acceptanceCriteria: ['Dry-run — no criteria generated'],
        invariants: [],
        scope: { includes: ['TBD'], excludes: [] },
      },
      birthGateScore: 0.75,
      sourceCapabilityId: capability._key,
      sourceRefs: [`BC:${capability._key}`],
      proposedBy: 'dry-run',
      ...(capability.specContent ? { specContent: capability.specContent } : {}),
      createdAt: new Date().toISOString(),
    }
    await db.save('specs_functions', proposal)
    return proposal
  }

  const hasSpecContent = typeof capability.specContent === 'string' && capability.specContent.length > 0
  const systemPrompt = hasSpecContent ? SPEC_GROUNDED_PROMPT : SYSTEM_PROMPT

  let userMessage = JSON.stringify({
    capabilityId: capability._key,
    title: capability.title,
    description: capability.description,
    gapAnalysis: capability.gapAnalysis,
    category: capability.category,
  })

  if (hasSpecContent) {
    userMessage += '\n\n## Original Specification\n' + capability.specContent
  }

  const result = await callModel('planning', systemPrompt, userMessage, env)
  const parsed = JSON.parse(result)

  if ((parsed.birthGateScore ?? 0) < 0.5) {
    throw new Error(
      `Birth gate failed: score ${parsed.birthGateScore} < 0.5 for "${parsed.title}"`,
    )
  }

  const proposal = {
    _key: key,
    type: 'function-proposal',
    ...parsed,
    sourceCapabilityId: capability._key,
    sourceRefs: [...(parsed.sourceRefs ?? []), `BC:${capability._key}`],
    proposedBy: 'gdk-ai',
    ...(capability.specContent ? { specContent: capability.specContent } : {}),
    createdAt: new Date().toISOString(),
  }

  await db.save('specs_functions', proposal)
  return proposal
}
