import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import {
  buildPrompt,
  buildRepairPrompt,
  buildMaterializeCommands,
  deriveExactLineContent,
  readDeclaredArtifacts,
} from './execution-contract.mjs'

describe('pi container execution contract', () => {
  it('prompts Pi to create exact local files for declared outputs', () => {
    const prompt = buildPrompt({
      roleName: 'SmokeWriter',
      context: {
        taskText: 'write the smoke artifact',
        outputArtifactPaths: {
          SmokeArtifact: 'runs/run-1/artifacts/SmokeArtifact',
        },
      },
      declaredOutputs: ['SmokeArtifact'],
    })

    expect(prompt).toContain('Artifact `SmokeArtifact`: write local file `./SmokeArtifact`')
    expect(prompt).toContain('A final chat response is not an artifact')
    expect(prompt).toContain('file name must match the artifact name exactly')
  })

  it('builds a bounded repair prompt for missing outputs', () => {
    const prompt = buildRepairPrompt(['SmokeArtifact'])

    expect(prompt).toContain('previous turn ended before all required output files existed')
    expect(prompt).toContain('`./SmokeArtifact`')
    expect(prompt).toContain('Do not summarize')
  })

  it('derives explicit smoke artifact content without inventing generic output content', () => {
    const input = {
      context: {
        taskText: 'Create a non-empty local file named SmokeArtifact containing exactly the line pi container smoke ok, then finish.',
      },
    }

    expect(deriveExactLineContent(input, 'SmokeArtifact')).toBe('pi container smoke ok')
    expect(deriveExactLineContent({ context: { taskText: 'Write a useful report.' } }, 'Report')).toBeUndefined()
  })

  it('builds Pi bash materialization commands only for explicit exact-line contracts', () => {
    const commands = buildMaterializeCommands({
      context: {
        taskText: 'Create a file named SmokeArtifact containing exactly the line pi container smoke ok.',
      },
    }, ['SmokeArtifact', '../escape'])

    expect(commands).toEqual([
      {
        artifact: 'SmokeArtifact',
        command: "printf '%s\\n' 'pi container smoke ok' > 'SmokeArtifact'",
      },
    ])
  })

  it('classifies declared output files as read, empty, or missing', async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'pi-contract-'))
    await writeFile(join(workDir, 'PresentArtifact'), 'ok\n', 'utf8')
    await writeFile(join(workDir, 'EmptyArtifact'), '', 'utf8')
    const observation = { artifacts: [] }
    const log = vi.fn()

    const result = await readDeclaredArtifacts({
      workDir,
      declaredOutputs: ['PresentArtifact', 'EmptyArtifact', 'MissingArtifact'],
      observation,
      log,
      attempt: 'initial',
    })

    expect(result.artifacts).toEqual(['PresentArtifact'])
    expect(result.artifactContents).toEqual({ PresentArtifact: 'ok\n' })
    expect(result.missing).toEqual(['EmptyArtifact', 'MissingArtifact'])
    expect(observation.artifacts).toEqual([
      { name: 'PresentArtifact', status: 'read', bytes: 3, attempt: 'initial' },
      { name: 'EmptyArtifact', status: 'empty', attempt: 'initial' },
      expect.objectContaining({ name: 'MissingArtifact', status: 'missing', attempt: 'initial' }),
    ])
  })
})
