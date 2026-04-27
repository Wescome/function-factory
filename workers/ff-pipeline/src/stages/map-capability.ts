import type { ArangoClient } from '@factory/arango-client'
import type { PipelineEnv } from '../types'
import { callModel } from '../model-bridge'

const SYSTEM_PROMPT = `You are a Capability Mapper in the Function Factory pipeline.

Given a Pressure (a named force acting on the system), identify the
Capability needed to address it — a concrete system ability.

A Capability is NOT a solution. It is the ABILITY the system needs.
"The system must be able to cache API responses" is a Capability.
"Add Redis caching" is a solution — that comes later.

Output JSON:
{
  "title": "Short name for the capability",
  "description": "What the system must be able to do",
  "category": "The domain this capability belongs to",
  "gapAnalysis": "What's missing today that this capability would provide",
  "sourcePressureId": "The Pressure ID this addresses",
  "sourceRefs": ["References"]
}

Respond ONLY with valid JSON.`

export async function mapCapability(
  pressure: Record<string, unknown>,
  db: ArangoClient,
  env: PipelineEnv,
  dryRun: boolean,
): Promise<Record<string, unknown>> {

  const key = `BC-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`

  if (dryRun) {
    const capability = {
      _key: key,
      type: 'capability',
      title: `Capability for ${pressure.title}`,
      description: `System capability addressing: ${pressure.description}`,
      category: pressure.category,
      gapAnalysis: 'Dry-run — no gap analysis performed',
      sourcePressureId: pressure._key,
      sourceRefs: [`PRS:${pressure._key}`],
      mappedBy: 'dry-run',
      ...(pressure.specContent ? { specContent: pressure.specContent } : {}),
      createdAt: new Date().toISOString(),
    }
    await db.save('specs_capabilities', capability)
    return capability
  }

  const userMessage = JSON.stringify({
    pressureId: pressure._key,
    title: pressure.title,
    description: pressure.description,
    priority: pressure.priority,
    category: pressure.category,
  })

  const result = await callModel('planning', SYSTEM_PROMPT, userMessage, env)
  const parsed = JSON.parse(result)

  const capability = {
    _key: key,
    type: 'capability',
    ...parsed,
    sourcePressureId: pressure._key,
    sourceRefs: [...(parsed.sourceRefs ?? []), `PRS:${pressure._key}`],
    mappedBy: 'gdk-ai',
    ...(pressure.specContent ? { specContent: pressure.specContent } : {}),
    createdAt: new Date().toISOString(),
  }

  await db.save('specs_capabilities', capability)
  return capability
}
