import { createHash } from 'node:crypto'

export function promptDiagnosticKey(stageName, attempt) {
  const safeStage = safeKeyPart(stageName)
  const safeAttempt = safeKeyPart(attempt)
  return `__observability/${safeStage}.prompt.${safeAttempt}.txt`
}

export function createPromptDiagnostic(stageName, attempt, prompt) {
  const content = String(prompt ?? '')
  const key = promptDiagnosticKey(stageName, attempt)
  return {
    key,
    content,
    event: {
      type: 'prompt.rendered',
      attempt,
      key,
      bytes: Buffer.byteLength(content, 'utf8'),
      sha256: createHash('sha256').update(content).digest('hex'),
    },
  }
}

function safeKeyPart(value) {
  return String(value ?? 'unknown')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'unknown'
}
