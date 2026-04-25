import type { ArangoClient } from '@factory/arango-client'
import type { PipelineEnv } from '../types'
import { callModel } from '../model-bridge'

const SYSTEM_PROMPT = `You are a Pressure Synthesizer in the Function Factory pipeline.

Given a Signal (a raw observation from the environment), synthesize a Pressure:
a named, prioritized force acting on the system that demands a response.

A Pressure is NOT the same as the Signal. The Signal is raw data.
The Pressure is the interpreted force — what the Signal MEANS for the system.

Output JSON with these fields:
{
  "title": "Short, descriptive name for the pressure",
  "description": "What force this pressure exerts on the system",
  "priority": "critical | high | medium | low",
  "category": "The domain this pressure belongs to",
  "sourceSignalId": "The Signal ID this was derived from",
  "evidence": ["Array of supporting observations"],
  "sourceRefs": ["References to authoritative sources"]
}

Respond ONLY with valid JSON. No markdown, no explanation.`

export async function synthesizePressure(
  signal: Record<string, unknown>,
  db: ArangoClient,
  env: PipelineEnv,
  dryRun: boolean,
): Promise<Record<string, unknown>> {

  const key = `PRS-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`

  if (dryRun) {
    const pressure = {
      _key: key,
      type: 'pressure',
      title: `Pressure from ${signal.title}`,
      description: `System pressure derived from signal: ${signal.description}`,
      priority: 'medium',
      category: signal.signalType,
      sourceSignalId: signal._key,
      evidence: signal.evidence ?? [],
      sourceRefs: [`SIG:${signal._key}`],
      synthesizedBy: 'dry-run',
      createdAt: new Date().toISOString(),
    }
    await db.save('specs_pressures', pressure)
    return pressure
  }

  const userMessage = JSON.stringify({
    signalId: signal._key,
    signalType: signal.signalType,
    title: signal.title,
    description: signal.description,
    evidence: signal.evidence,
    source: signal.source,
  })

  const result = await callModel('planning', SYSTEM_PROMPT, userMessage, env)
  const parsed = JSON.parse(result)

  const pressure = {
    _key: key,
    type: 'pressure',
    ...parsed,
    sourceSignalId: signal._key,
    sourceRefs: [...(parsed.sourceRefs ?? []), `SIG:${signal._key}`],
    synthesizedBy: 'pi-ai',
    createdAt: new Date().toISOString(),
  }

  await db.save('specs_pressures', pressure)
  return pressure
}
