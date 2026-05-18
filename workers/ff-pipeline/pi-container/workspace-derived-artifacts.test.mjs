import { describe, expect, it } from 'vitest'
import {
  buildCandidatePatch,
  parseSeedWorkspaceWithExpectedChanges,
  workspaceDerivedArtifactCommand,
} from './workspace-derived-artifacts.mjs'
import { evaluateContracts } from './contract-evaluator.mjs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const seed = JSON.stringify({
  schemaVersion: '1.0',
  issue: 'Update the smoke message.',
  testCommand: 'node test/coding-adapter-smoke.test.js',
  expectedChanges: [
    {
      path: 'src/coding-adapter-smoke.ts',
      from: 'export const message = "before"',
      to: 'export const message = "coding-adapter smoke"',
    },
  ],
  files: [
    {
      path: 'src/coding-adapter-smoke.ts',
      content: 'export const message = "before"\n',
    },
  ],
})

describe('workspace-derived artifacts', () => {
  it('builds CandidatePatch from SeedWorkspace expectedChanges', async () => {
    const parsed = parseSeedWorkspaceWithExpectedChanges(seed)
    const patch = buildCandidatePatch(parsed)

    expect(patch).toContain('diff --git a/src/coding-adapter-smoke.ts b/src/coding-adapter-smoke.ts')
    expect(patch).toContain('-export const message = "before"')
    expect(patch).toContain('+export const message = "coding-adapter smoke"')

    const workDir = await mkdtemp(join(tmpdir(), 'workspace-derived-'))
    await writeFile(join(workDir, 'CandidatePatch'), patch)
    const result = await evaluateContracts({
      workDir,
      contracts: [{
        artifact: 'CandidatePatch',
        required: true,
        body: {
          kind: 'text',
          requiredPatterns: [
            'diff --git a/src/coding-adapter-smoke.ts b/src/coding-adapter-smoke.ts',
            '-export const message = "before"',
            '\\+export const message = "coding-adapter smoke"',
          ],
        },
      }],
    })

    expect(result.missing).toEqual([])
  })

  it('returns a Pi bash command for known workspace-derived artifacts', () => {
    const command = workspaceDerivedArtifactCommand(
      { artifact: 'CandidatePatch', body: { kind: 'text' } },
      { context: { inputArtifacts: { SeedWorkspace: seed } } },
    )

    expect(command).toMatchObject({
      artifact: 'CandidatePatch',
      kind: 'workspace-derived',
    })
    expect(command.command).toContain('CandidatePatch')
  })

  it('does not handle unrelated artifacts', () => {
    expect(workspaceDerivedArtifactCommand(
      { artifact: 'IssueContract', body: { kind: 'text' } },
      { context: { inputArtifacts: { SeedWorkspace: seed } } },
    )).toBeUndefined()
  })

  it('does not derive CandidatePatch from an oracle-free SeedWorkspace', () => {
    const autonomousSeed = JSON.stringify({
      schemaVersion: '1.0',
      issue: 'Update the smoke message.',
      testCommand: 'node test/coding-adapter-smoke.test.js',
      files: [
        {
          path: 'src/coding-adapter-smoke.ts',
          content: 'export const message = "before"\n',
        },
      ],
    })

    expect(workspaceDerivedArtifactCommand(
      { artifact: 'CandidatePatch', body: { kind: 'text' } },
      { context: { inputArtifacts: { SeedWorkspace: autonomousSeed } } },
    )).toBeUndefined()
  })
})
