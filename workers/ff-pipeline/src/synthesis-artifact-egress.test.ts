import { describe, expect, it } from 'vitest'
import {
  SynthesisArtifactEgressError,
  applySynthesisCodeFiles,
  extractSynthesisCodeFiles,
  validateSynthesisCodeFile,
} from './synthesis-artifact-egress'

function makePipelineResult(overrides: Record<string, unknown> = {}) {
  return {
    status: 'complete',
    output: {
      status: 'synthesis-passed',
      executableSpecificationId: 'WG-MOTE4M1R-G7I0',
      atomResults: {
        'atom-001': {
          atomId: 'atom-001',
          verdict: { decision: 'pass', confidence: 0.95 },
          codeArtifact: {
            files: [
              {
                path: 'workers/ff-pipeline/src/runtime-verification.ts',
                action: 'create',
                content: 'export const runtimeVerification = true\n',
              },
            ],
          },
        },
      },
      ...overrides,
    },
  }
}

describe('synthesis artifact egress guard', () => {
  it('extracts validated code files from the WG-MOTE4M1R-G7I0 result shape', () => {
    const files = extractSynthesisCodeFiles(makePipelineResult())

    expect(files).toEqual([
      {
        atomId: 'atom-001',
        path: 'workers/ff-pipeline/src/runtime-verification.ts',
        action: 'create',
        content: 'export const runtimeVerification = true\n',
      },
    ])
  })

  it('extracts files across multiple atom results in stable atom order', () => {
    const files = extractSynthesisCodeFiles(makePipelineResult({
      atomResults: {
        'atom-002': {
          codeArtifact: {
            files: [{ path: 'src/b.ts', action: 'modify', content: 'export const b = 2\n' }],
          },
        },
        'atom-001': {
          codeArtifact: {
            files: [{ path: 'src/a.ts', action: 'create', content: 'export const a = 1\n' }],
          },
        },
      },
    }))

    expect(files.map(file => `${file.atomId}:${file.path}`)).toEqual([
      'atom-001:src/a.ts',
      'atom-002:src/b.ts',
    ])
  })

  it('accepts delete actions without content', () => {
    expect(validateSynthesisCodeFile({ path: 'src/old.ts', action: 'delete' }, 'atom-001')).toEqual({
      atomId: 'atom-001',
      path: 'src/old.ts',
      action: 'delete',
    })
  })

  it('rejects absolute paths', () => {
    expect(() => validateSynthesisCodeFile({
      path: '/Users/wes/Developer/function-factory/src/x.ts',
      action: 'create',
      content: 'x',
    }, 'atom-001')).toThrow(SynthesisArtifactEgressError)
  })

  it('rejects parent directory traversal', () => {
    expect(() => validateSynthesisCodeFile({
      path: 'workers/../.env',
      action: 'create',
      content: 'SECRET=1',
    }, 'atom-001')).toThrow(/parent directory/i)
  })

  it('rejects .git paths', () => {
    expect(() => validateSynthesisCodeFile({
      path: '.git/config',
      action: 'modify',
      content: 'bad',
    }, 'atom-001')).toThrow(/\.git/i)
  })

  it('rejects node_modules paths', () => {
    expect(() => validateSynthesisCodeFile({
      path: 'workers/ff-pipeline/node_modules/pkg/index.js',
      action: 'modify',
      content: 'bad',
    }, 'atom-001')).toThrow(/node_modules/i)
  })

  it('rejects env files', () => {
    expect(() => validateSynthesisCodeFile({
      path: 'workers/ff-pipeline/.env.production',
      action: 'create',
      content: 'TOKEN=1',
    }, 'atom-001')).toThrow(/env/i)
  })

  it('rejects secret-like paths', () => {
    expect(() => validateSynthesisCodeFile({
      path: 'config/secrets/runtime.json',
      action: 'create',
      content: '{}',
    }, 'atom-001')).toThrow(/secret/i)
  })

  it('rejects invalid actions', () => {
    expect(() => validateSynthesisCodeFile({
      path: 'src/x.ts',
      action: 'rename',
      content: 'x',
    }, 'atom-001')).toThrow(/action/i)
  })

  it('requires content for create actions', () => {
    expect(() => validateSynthesisCodeFile({
      path: 'src/x.ts',
      action: 'create',
    }, 'atom-001')).toThrow(/content/i)
  })

  it('requires content for modify actions', () => {
    expect(() => validateSynthesisCodeFile({
      path: 'src/x.ts',
      action: 'modify',
    }, 'atom-001')).toThrow(/content/i)
  })

  it('rejects malformed pipeline results', () => {
    expect(() => extractSynthesisCodeFiles({ status: 'complete', output: null })).toThrow(
      /output/i,
    )
  })

  it('applies validated files through injected filesystem operations and emits an audit record', async () => {
    const writes: Record<string, string> = {}
    const deletes: string[] = []

    const audit = await applySynthesisCodeFiles(
      [
        { atomId: 'atom-001', path: 'src/new.ts', action: 'create', content: 'export const n = 1\n' },
        { atomId: 'atom-002', path: 'src/old.ts', action: 'modify', content: 'export const o = 2\n' },
        { atomId: 'atom-003', path: 'src/dead.ts', action: 'delete' },
      ],
      {
        pipelineId: 'b1b51f73-416d-4d87-90a5-9ccaa12bec76',
        executableSpecificationId: 'WG-MOTE4M1R-G7I0',
        appliedBy: 'test-runner',
      },
      {
        exists: async path => path !== 'src/new.ts',
        writeFile: async (path, content) => { writes[path] = content },
        deleteFile: async path => { deletes.push(path) },
        hashContent: async content => `sha256:${content.length}`,
        now: () => '2026-05-06T02:42:26.000Z',
      },
    )

    expect(writes).toEqual({
      'src/new.ts': 'export const n = 1\n',
      'src/old.ts': 'export const o = 2\n',
    })
    expect(deletes).toEqual(['src/dead.ts'])
    expect(audit).toMatchObject({
      pipelineId: 'b1b51f73-416d-4d87-90a5-9ccaa12bec76',
      executableSpecificationId: 'WG-MOTE4M1R-G7I0',
      appliedBy: 'test-runner',
      appliedAt: '2026-05-06T02:42:26.000Z',
      validationPassed: true,
      files: [
        { atomId: 'atom-001', path: 'src/new.ts', action: 'create', contentHash: 'sha256:19' },
        { atomId: 'atom-002', path: 'src/old.ts', action: 'modify', contentHash: 'sha256:19' },
        { atomId: 'atom-003', path: 'src/dead.ts', action: 'delete', contentHash: null },
      ],
    })
  })

  it('fails create when the target already exists', async () => {
    await expect(applySynthesisCodeFiles(
      [{ atomId: 'atom-001', path: 'src/existing.ts', action: 'create', content: 'x' }],
      { pipelineId: 'pipe', executableSpecificationId: 'WG', appliedBy: 'test' },
      {
        exists: async () => true,
        writeFile: async () => {},
        deleteFile: async () => {},
        hashContent: async () => 'hash',
      },
    )).rejects.toThrow(/already exists/i)
  })

  it('fails modify when the target is missing', async () => {
    await expect(applySynthesisCodeFiles(
      [{ atomId: 'atom-001', path: 'src/missing.ts', action: 'modify', content: 'x' }],
      { pipelineId: 'pipe', executableSpecificationId: 'WG', appliedBy: 'test' },
      {
        exists: async () => false,
        writeFile: async () => {},
        deleteFile: async () => {},
        hashContent: async () => 'hash',
      },
    )).rejects.toThrow(/does not exist/i)
  })
})
