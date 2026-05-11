function sanitizeKeyPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "-").replace(/-+/g, "-")
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`
  }
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`
}

export function stableHash(value: unknown): string {
  const input = stableStringify(value)
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export function learningRunTranscriptKey(runId: string): string {
  return `run-${sanitizeKeyPart(runId)}`
}

export function learningObservationKey(input: {
  runId: string
  kind: string
  basis: unknown
}): string {
  return `obs-${sanitizeKeyPart(input.runId)}-${sanitizeKeyPart(input.kind)}-${stableHash(input.basis)}`
}

export function templateCandidateKey(input: {
  executableSpecificationId: string
  sourceRefs: readonly string[]
}): string {
  return `candidate-${sanitizeKeyPart(input.executableSpecificationId)}-${stableHash(input.sourceRefs)}`
}

export function routingObservationKey(input: {
  runId: string
  taskKind: string
  model: string
}): string {
  return `routing-${sanitizeKeyPart(input.runId)}-${sanitizeKeyPart(input.taskKind)}-${sanitizeKeyPart(input.model)}`
}
