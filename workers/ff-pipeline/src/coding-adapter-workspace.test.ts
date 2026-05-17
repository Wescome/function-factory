import { describe, expect, it } from 'vitest'
import {
  applyUnifiedDiffToSeedWorkspace,
  parseSeedWorkspace,
  validatePatchAgainstSeedWorkspace,
} from './coding-adapter-workspace'

const seedJson = JSON.stringify({
  schemaVersion: '1.0',
  issue: 'Change src/coding-adapter-smoke.ts to export the smoke string.',
  acceptance: ['src/coding-adapter-smoke.ts contains coding-adapter smoke'],
  testCommand: 'node test/coding-adapter-smoke.test.js',
  files: [
    {
      path: 'src/coding-adapter-smoke.ts',
      content: 'export const message = "before"\n',
    },
    {
      path: 'test/coding-adapter-smoke.test.js',
      content: 'ok\n',
    },
  ],
})

const validPatch = [
  'diff --git a/src/coding-adapter-smoke.ts b/src/coding-adapter-smoke.ts',
  '--- a/src/coding-adapter-smoke.ts',
  '+++ b/src/coding-adapter-smoke.ts',
  '@@ -1 +1 @@',
  '-export const message = "before"',
  '+export const message = "coding-adapter smoke"',
  '',
].join('\n')

describe('parseSeedWorkspace', () => {
  it('parses a valid seed workspace artifact', () => {
    expect(parseSeedWorkspace(seedJson)).toMatchObject({
      schemaVersion: '1.0',
      testCommand: 'node test/coding-adapter-smoke.test.js',
      files: expect.arrayContaining([
        expect.objectContaining({ path: 'src/coding-adapter-smoke.ts' }),
      ]),
    })
  })

  it('rejects unsafe file paths', () => {
    expect(() => parseSeedWorkspace(JSON.stringify({
      schemaVersion: '1.0',
      files: [{ path: '../escape.ts', content: 'bad' }],
    }))).toThrow('unsafe seed workspace path')
  })
})

describe('applyUnifiedDiffToSeedWorkspace', () => {
  it('applies a unified diff to the seeded file set', () => {
    const seed = parseSeedWorkspace(seedJson)
    const result = applyUnifiedDiffToSeedWorkspace(seed, validPatch)

    expect(result.files['src/coding-adapter-smoke.ts']).toBe(
      'export const message = "coding-adapter smoke"\n',
    )
  })

  it('rejects a patch whose old line does not match the seed', () => {
    const seed = parseSeedWorkspace(seedJson)
    expect(() => applyUnifiedDiffToSeedWorkspace(
      seed,
      validPatch.replace('"before"', '"wrong"'),
    )).toThrow('hunk removal mismatch')
  })
})

describe('validatePatchAgainstSeedWorkspace', () => {
  it('returns pass for a patch that applies to the seed workspace', () => {
    const result = validatePatchAgainstSeedWorkspace(seedJson, validPatch)
    expect(result).toEqual({ passed: true })
  })

  it('returns fail detail for a patch that does not apply', () => {
    const result = validatePatchAgainstSeedWorkspace(
      seedJson,
      validPatch.replaceAll('src/coding-adapter-smoke.ts', 'src/missing.ts'),
    )
    expect(result).toMatchObject({ passed: false })
    if (!result.passed) expect(result.message).toContain('target file missing')
  })
})
