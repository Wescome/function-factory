import type { ArangoClient } from '@factory/arango-client'
import type { SignalInput } from '../types'

export async function ingestSignal(
  input: SignalInput,
  db: ArangoClient,
): Promise<Record<string, unknown>> {
  if (!input.title || !input.description || !input.signalType) {
    throw new Error(
      `Signal missing required fields: ${
        ['title', 'description', 'signalType']
          .filter((f) => !input[f as keyof SignalInput])
          .join(', ')
      }`,
    )
  }

  const idempotencyKey = computeIdempotencyKey(input)

  const existing = await db.queryOne<Record<string, unknown>>(
    `FOR s IN specs_signals
       FILTER s.idempotencyKey == @key
       LIMIT 1
       RETURN s`,
    { key: idempotencyKey },
  )

  if (existing) return existing

  const key = `SIG-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`

  const signal = {
    _key: key,
    signalType: input.signalType,
    source: input.source,
    title: input.title,
    description: input.description,
    evidence: input.evidence ?? [],
    sourceRefs: input.sourceRefs ?? [],
    idempotencyKey,
    status: 'ingested',
    subtype: input.subtype,
    createdAt: new Date().toISOString(),
  }

  await db.save('specs_signals', signal)
  return signal
}

function computeIdempotencyKey(input: SignalInput): string {
  const parts = [
    input.signalType,
    input.source,
    input.title,
    input.description.slice(0, 200),
  ].join('|')

  let hash = 0
  for (let i = 0; i < parts.length; i++) {
    const char = parts.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return `sig:${Math.abs(hash).toString(36)}`
}
