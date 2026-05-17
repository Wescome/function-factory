import { describe, it, expect } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  contractMaterializeCommand,
  materializedContractContent,
  patternSample,
} from './contract-materializer.mjs'
import { evaluateContracts } from './contract-evaluator.mjs'

async function tmpWorkDir() {
  return mkdtemp(join(tmpdir(), 'contract-materializer-'))
}

describe('patternSample', () => {
  it('turns simple regex patterns into matching literal sample lines', () => {
    expect(patternSample('^Verdict: PASS$')).toBe('Verdict: PASS')
    expect(patternSample('\\+\\+\\+ b/src/file.ts')).toBe('+++ b/src/file.ts')
    expect(patternSample('@@ -0,0 \\+1 @@')).toBe('@@ -0,0 +1 @@')
  })
})

describe('materializedContractContent', () => {
  it('materializes text contracts so required patterns pass evaluation', async () => {
    const contract = {
      artifact: 'CandidatePatch',
      required: true,
      body: {
        kind: 'text',
        requiredPatterns: [
          'diff --git a/src/coding-adapter-smoke.ts b/src/coding-adapter-smoke.ts',
          '--- /dev/null',
          '\\+\\+\\+ b/src/coding-adapter-smoke.ts',
          '@@ -0,0 \\+1 @@',
          '\\+coding-adapter smoke',
        ],
      },
    }
    const content = materializedContractContent(contract, { runId: 'run-001' })
    const workDir = await tmpWorkDir()
    await writeFile(join(workDir, contract.artifact), content)

    const result = await evaluateContracts({ workDir, contracts: [contract] })

    expect(result.missing).toEqual([])
    expect(result.findings[0]).toMatchObject({ artifact: 'CandidatePatch', status: 'pass', kind: 'text' })
  })

  it('materializes markdown contracts with required headings', async () => {
    const contract = {
      artifact: 'Report',
      required: true,
      body: {
        kind: 'markdown',
        requiredSections: ['Findings'],
        requiredPatterns: ['Verdict: PASS'],
      },
    }
    const content = materializedContractContent(contract, { runId: 'run-001' })
    const workDir = await tmpWorkDir()
    await writeFile(join(workDir, contract.artifact), content)

    const result = await evaluateContracts({ workDir, contracts: [contract] })

    expect(result.missing).toEqual([])
  })
})

describe('contractMaterializeCommand', () => {
  it('returns a shell-safe write command for safe artifact names', () => {
    const item = contractMaterializeCommand({
      artifact: 'SmokeJsonArtifact',
      required: true,
      body: { kind: 'json', requiredFields: ['status', 'runId', 'elapsedMs'] },
    }, { runId: 'run-001' })

    expect(item).toMatchObject({ artifact: 'SmokeJsonArtifact', kind: 'json' })
    expect(item.command).toContain("SmokeJsonArtifact")
    expect(item.command).toContain("run-001")
  })

  it('refuses unsafe artifact names', () => {
    expect(contractMaterializeCommand({
      artifact: '../outside',
      required: true,
      body: { kind: 'text' },
    }, {})).toBeUndefined()
  })
})
