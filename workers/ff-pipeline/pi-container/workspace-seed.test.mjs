import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  hasSeedWorkspace,
  prepareSeedWorkspace,
  workspacePromptSection,
} from './workspace-seed.mjs'

const execFileAsync = promisify(execFile)

const seed = JSON.stringify({
  schemaVersion: '1.0',
  issue: 'Change the smoke file.',
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

describe('hasSeedWorkspace', () => {
  it('detects SeedWorkspace input artifacts', () => {
    expect(hasSeedWorkspace({ context: { inputArtifacts: { SeedWorkspace: seed } } })).toBe(true)
    expect(hasSeedWorkspace({ context: { inputArtifacts: {} } })).toBe(false)
  })
})

describe('prepareSeedWorkspace', () => {
  it('writes seed files into ./workspace and emits a helper summary', async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'seed-workspace-'))
    const prepared = await prepareSeedWorkspace(workDir, seed)

    expect(prepared.workspaceDir).toBe(join(workDir, 'workspace'))
    expect(await readFile(join(workDir, 'workspace/src/coding-adapter-smoke.ts'), 'utf8')).toBe(
      'export const message = "before"\n',
    )
    await expect(stat(join(workDir, 'workspace/.factory/seed-workspace.json'))).resolves.toMatchObject({
      isFile: expect.any(Function),
    })
  })

  it('initializes ./workspace as a clean git repo for diff generation', async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'seed-workspace-'))
    await prepareSeedWorkspace(workDir, seed)

    const { stdout } = await execFileAsync('git', ['-C', join(workDir, 'workspace'), 'status', '--short'])
    expect(stdout).toBe('')
  })

  it('rejects unsafe paths before writing files', async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'seed-workspace-'))
    await expect(prepareSeedWorkspace(workDir, JSON.stringify({
      schemaVersion: '1.0',
      files: [{ path: '/tmp/escape', content: 'bad' }],
    }))).rejects.toThrow('unsafe seed workspace path')
  })
})

describe('workspacePromptSection', () => {
  it('tells the agent where the workspace and test command are', async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'seed-workspace-'))
    const prepared = await prepareSeedWorkspace(workDir, seed)
    const section = workspacePromptSection(prepared)

    expect(section).toContain('./workspace')
    expect(section).toContain('node test/coding-adapter-smoke.test.js')
    expect(section).toContain('Change the smoke file.')
    expect(section).toContain('git apply ../CandidatePatch')
    expect(section).toContain('Python is not installed')
  })
})
