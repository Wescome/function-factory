import type { ArangoClient } from '@factory/arango-client'
import type { PipelineEnv } from '../types'
import { callModel } from '../model-bridge'

const SYSTEM_PROMPT = `You are a Function Proposer in the Function Factory pipeline.

Given a Capability (a system ability needed), propose a Function — a
concrete, implementable unit of work.

A Function is a bounded piece of engineering work. It has a PRD (Product
Requirements Document), acceptance criteria, invariants, and a scope.

Output JSON:
{
  "title": "Function name",
  "description": "What this Function does",
  "prd": {
    "title": "PRD title",
    "objective": "What this PRD specifies",
    "acceptanceCriteria": ["Criterion 1", "Criterion 2"],
    "invariants": ["Invariant 1"],
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

  let userMessage = JSON.stringify({
    capabilityId: capability._key,
    title: capability.title,
    description: capability.description,
    gapAnalysis: capability.gapAnalysis,
    category: capability.category,
  })

  if (capability.specContent) {
    userMessage += '\n\n## Original Specification\n' + capability.specContent
  }

  const result = await callModel('planning', SYSTEM_PROMPT, userMessage, env)
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
    proposedBy: 'pi-ai',
    ...(capability.specContent ? { specContent: capability.specContent } : {}),
    createdAt: new Date().toISOString(),
  }

  await db.save('specs_functions', proposal)
  return proposal
}
