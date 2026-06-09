import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import {
  createPromptDiagnostic,
  promptDiagnosticKey,
} from './prompt-diagnostics.mjs'

describe('prompt diagnostics', () => {
  it('builds stable observability keys for initial and repair prompts', () => {
    expect(promptDiagnosticKey('PATCH', 'initial'))
      .toBe('__observability/PATCH.prompt.initial.txt')
    expect(promptDiagnosticKey('PATCH', 'repair-1'))
      .toBe('__observability/PATCH.prompt.repair-1.txt')
  })

  it('captures prompt content separately from bounded observation metadata', () => {
    const prompt = 'You are PatchWorker.\nWrite ./CandidatePatch.\n'
    const diagnostic = createPromptDiagnostic('PATCH', 'initial', prompt)

    expect(diagnostic).toEqual({
      key: '__observability/PATCH.prompt.initial.txt',
      content: prompt,
      event: {
        type: 'prompt.rendered',
        attempt: 'initial',
        key: '__observability/PATCH.prompt.initial.txt',
        bytes: Buffer.byteLength(prompt, 'utf8'),
        sha256: createHash('sha256').update(prompt).digest('hex'),
      },
    })
    expect(JSON.stringify(diagnostic.event)).not.toContain('PatchWorker')
    expect(JSON.stringify(diagnostic.event)).not.toContain('CandidatePatch')
  })
})
