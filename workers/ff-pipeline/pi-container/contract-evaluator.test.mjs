/**
 * contract-evaluator.test.mjs — Vitest coverage for the OutputContract
 * evaluator that runs inside the pi Container.
 *
 * Run:
 *   pnpm --filter @factory/ff-pipeline exec vitest run pi-container/contract-evaluator.test.mjs
 */

import { describe, it, expect } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  defaultContract,
  evaluateContracts,
  buildContractRepairPrompt,
} from './contract-evaluator.mjs'

async function makeWorkDir() {
  return mkdtemp(join(tmpdir(), 'contract-eval-'))
}

async function write(workDir, name, body) {
  await writeFile(join(workDir, name), body, 'utf8')
}

describe('defaultContract', () => {
  it('returns a text/nonEmpty contract for the given artifact name', () => {
    expect(defaultContract('SmokeArtifact')).toEqual({
      artifact: 'SmokeArtifact',
      required: true,
      body: { kind: 'text', nonEmpty: true },
    })
  })
})

describe('evaluateContracts — exact_line', () => {
  it('passes when file content equals the line (single trailing newline stripped)', async () => {
    const workDir = await makeWorkDir()
    await write(workDir, 'Smoke', 'pi container smoke ok\n')
    const result = await evaluateContracts({
      workDir,
      contracts: [{
        artifact: 'Smoke',
        required: true,
        body: { kind: 'exact_line', line: 'pi container smoke ok' },
      }],
    })

    expect(result.missing).toEqual([])
    expect(result.findings).toEqual([
      expect.objectContaining({ artifact: 'Smoke', status: 'pass', kind: 'exact_line' }),
    ])
    expect(result.contents).toEqual({ Smoke: 'pi container smoke ok\n' })
  })

  it('fails with exact_line_mismatch when content differs', async () => {
    const workDir = await makeWorkDir()
    await write(workDir, 'Smoke', 'wrong\n')
    const result = await evaluateContracts({
      workDir,
      contracts: [{
        artifact: 'Smoke',
        required: true,
        body: { kind: 'exact_line', line: 'right' },
      }],
    })

    expect(result.missing).toEqual(['Smoke'])
    const finding = result.findings[0]
    expect(finding.status).toBe('fail')
    expect(finding.failureCode).toBe('exact_line_mismatch')
  })

  it('fails with exact_line_mismatch when file is missing', async () => {
    const workDir = await makeWorkDir()
    const result = await evaluateContracts({
      workDir,
      contracts: [{
        artifact: 'Gone',
        required: true,
        body: { kind: 'exact_line', line: 'x' },
      }],
    })
    expect(result.missing).toEqual(['Gone'])
    expect(result.findings[0].status).toBe('fail')
    expect(result.findings[0].failureCode).toBe('exact_line_mismatch')
  })
})

describe('evaluateContracts — text', () => {
  it('passes when nonEmpty is satisfied', async () => {
    const workDir = await makeWorkDir()
    await write(workDir, 'Notes', 'hello\n')
    const result = await evaluateContracts({
      workDir,
      contracts: [{
        artifact: 'Notes',
        required: true,
        body: { kind: 'text', nonEmpty: true },
      }],
    })
    expect(result.missing).toEqual([])
    expect(result.contents.Notes).toBe('hello\n')
  })

  it('fails with empty when nonEmpty trip and content is whitespace-only', async () => {
    const workDir = await makeWorkDir()
    await write(workDir, 'Notes', '   \n\n')
    const result = await evaluateContracts({
      workDir,
      contracts: [{
        artifact: 'Notes',
        required: true,
        body: { kind: 'text', nonEmpty: true },
      }],
    })
    expect(result.missing).toEqual(['Notes'])
    expect(result.findings[0].failureCode).toBe('empty')
  })

  it('allows empty when nonEmpty is false but checks requiredPatterns', async () => {
    const workDir = await makeWorkDir()
    await write(workDir, 'Notes', '')
    const result = await evaluateContracts({
      workDir,
      contracts: [{
        artifact: 'Notes',
        required: true,
        body: { kind: 'text', nonEmpty: false },
      }],
    })
    expect(result.missing).toEqual([])
  })

  it('fails with missing_pattern when a requiredPattern is absent', async () => {
    const workDir = await makeWorkDir()
    await write(workDir, 'Notes', 'something else\n')
    const result = await evaluateContracts({
      workDir,
      contracts: [{
        artifact: 'Notes',
        required: true,
        body: { kind: 'text', requiredPatterns: ['^hello$'] },
      }],
    })
    expect(result.missing).toEqual(['Notes'])
    expect(result.findings[0].failureCode).toBe('missing_pattern')
  })

  it('passes requiredPatterns case-insensitively (im flags)', async () => {
    const workDir = await makeWorkDir()
    await write(workDir, 'Notes', 'Status: OK\n')
    const result = await evaluateContracts({
      workDir,
      contracts: [{
        artifact: 'Notes',
        required: true,
        body: { kind: 'text', requiredPatterns: ['^status: ok$'] },
      }],
    })
    expect(result.missing).toEqual([])
  })

  it('treats a missing required text artifact as missing', async () => {
    const workDir = await makeWorkDir()
    const result = await evaluateContracts({
      workDir,
      contracts: [{
        artifact: 'Gone',
        required: true,
        body: { kind: 'text', nonEmpty: true },
      }],
    })
    expect(result.missing).toEqual(['Gone'])
  })

  it('does NOT include a missing optional artifact in missing[]', async () => {
    const workDir = await makeWorkDir()
    const result = await evaluateContracts({
      workDir,
      contracts: [{
        artifact: 'Optional',
        required: false,
        body: { kind: 'text', nonEmpty: true },
      }],
    })
    expect(result.missing).toEqual([])
    expect(result.findings[0].status).toBe('fail')
  })
})

describe('evaluateContracts — json', () => {
  it('passes when JSON object has all required fields', async () => {
    const workDir = await makeWorkDir()
    await write(workDir, 'data.json', JSON.stringify({ status: 'ok', runId: 'r1', elapsedMs: 12 }))
    const result = await evaluateContracts({
      workDir,
      contracts: [{
        artifact: 'data.json',
        required: true,
        body: { kind: 'json', requiredFields: ['status', 'runId', 'elapsedMs'] },
      }],
    })
    expect(result.missing).toEqual([])
  })

  it('fails with invalid_json when content is not parseable', async () => {
    const workDir = await makeWorkDir()
    await write(workDir, 'data.json', 'not json{')
    const result = await evaluateContracts({
      workDir,
      contracts: [{
        artifact: 'data.json',
        required: true,
        body: { kind: 'json' },
      }],
    })
    expect(result.findings[0].failureCode).toBe('invalid_json')
    expect(result.missing).toEqual(['data.json'])
  })

  it('fails with invalid_json when parsed value is an array', async () => {
    const workDir = await makeWorkDir()
    await write(workDir, 'data.json', '[1,2,3]')
    const result = await evaluateContracts({
      workDir,
      contracts: [{
        artifact: 'data.json',
        required: true,
        body: { kind: 'json' },
      }],
    })
    expect(result.findings[0].failureCode).toBe('invalid_json')
  })

  it('fails with invalid_json when parsed value is null', async () => {
    const workDir = await makeWorkDir()
    await write(workDir, 'data.json', 'null')
    const result = await evaluateContracts({
      workDir,
      contracts: [{
        artifact: 'data.json',
        required: true,
        body: { kind: 'json' },
      }],
    })
    expect(result.findings[0].failureCode).toBe('invalid_json')
  })

  it('fails with missing_field listing absent keys', async () => {
    const workDir = await makeWorkDir()
    await write(workDir, 'data.json', JSON.stringify({ status: 'ok' }))
    const result = await evaluateContracts({
      workDir,
      contracts: [{
        artifact: 'data.json',
        required: true,
        body: { kind: 'json', requiredFields: ['status', 'runId', 'elapsedMs'] },
      }],
    })
    const finding = result.findings[0]
    expect(finding.failureCode).toBe('missing_field')
    expect(finding.detail).toContain('runId')
    expect(finding.detail).toContain('elapsedMs')
    expect(finding.detail).not.toContain('status')
  })

  it('treats null/undefined field values as missing', async () => {
    const workDir = await makeWorkDir()
    await write(workDir, 'data.json', JSON.stringify({ status: null }))
    const result = await evaluateContracts({
      workDir,
      contracts: [{
        artifact: 'data.json',
        required: true,
        body: { kind: 'json', requiredFields: ['status'] },
      }],
    })
    expect(result.findings[0].failureCode).toBe('missing_field')
  })
})

describe('evaluateContracts — markdown', () => {
  it('passes when all required sections + patterns are present', async () => {
    const workDir = await makeWorkDir()
    await write(workDir, 'Doc.md', '# Summary\n\nblah\n\n## Details\n\nresult: ok\n')
    const result = await evaluateContracts({
      workDir,
      contracts: [{
        artifact: 'Doc.md',
        required: true,
        body: {
          kind: 'markdown',
          requiredSections: ['Summary', 'Details'],
          requiredPatterns: ['^result: ok$'],
        },
      }],
    })
    expect(result.missing).toEqual([])
  })

  it('fails with empty for whitespace-only markdown', async () => {
    const workDir = await makeWorkDir()
    await write(workDir, 'Doc.md', '   \n')
    const result = await evaluateContracts({
      workDir,
      contracts: [{
        artifact: 'Doc.md',
        required: true,
        body: { kind: 'markdown' },
      }],
    })
    expect(result.findings[0].failureCode).toBe('empty')
  })

  it('fails with missing_section when a heading is absent', async () => {
    const workDir = await makeWorkDir()
    await write(workDir, 'Doc.md', '# Summary\n\nblah\n')
    const result = await evaluateContracts({
      workDir,
      contracts: [{
        artifact: 'Doc.md',
        required: true,
        body: { kind: 'markdown', requiredSections: ['Summary', 'Details'] },
      }],
    })
    const finding = result.findings[0]
    expect(finding.failureCode).toBe('missing_section')
    expect(finding.detail).toContain('Details')
  })

  it('accepts headings at any depth (h1-h6)', async () => {
    const workDir = await makeWorkDir()
    await write(workDir, 'Doc.md', '###### Deep\n')
    const result = await evaluateContracts({
      workDir,
      contracts: [{
        artifact: 'Doc.md',
        required: true,
        body: { kind: 'markdown', requiredSections: ['Deep'] },
      }],
    })
    expect(result.missing).toEqual([])
  })

  it('fails with missing_pattern when sections pass but pattern does not', async () => {
    const workDir = await makeWorkDir()
    await write(workDir, 'Doc.md', '# Summary\n\nbody\n')
    const result = await evaluateContracts({
      workDir,
      contracts: [{
        artifact: 'Doc.md',
        required: true,
        body: {
          kind: 'markdown',
          requiredSections: ['Summary'],
          requiredPatterns: ['result: ok'],
        },
      }],
    })
    expect(result.findings[0].failureCode).toBe('missing_pattern')
  })
})

describe('evaluateContracts — multi-artifact', () => {
  it('returns all findings, missing only for required failures, contents only for passing', async () => {
    const workDir = await makeWorkDir()
    await write(workDir, 'PassReq', 'ok\n')
    await write(workDir, 'FailReq', '')
    await write(workDir, 'FailOpt', '')
    const result = await evaluateContracts({
      workDir,
      contracts: [
        { artifact: 'PassReq', required: true,  body: { kind: 'text', nonEmpty: true } },
        { artifact: 'FailReq', required: true,  body: { kind: 'text', nonEmpty: true } },
        { artifact: 'FailOpt', required: false, body: { kind: 'text', nonEmpty: true } },
      ],
    })
    expect(result.missing).toEqual(['FailReq'])
    expect(Object.keys(result.contents)).toEqual(['PassReq'])
    expect(result.findings.map((f) => f.status)).toEqual(['pass', 'fail', 'fail'])
  })
})

describe('buildContractRepairPrompt', () => {
  it('lists each failing finding with artifact / kind / failureCode / detail', () => {
    const prompt = buildContractRepairPrompt([
      { artifact: 'A', status: 'pass', kind: 'text' },
      { artifact: 'B', status: 'fail', kind: 'json', failureCode: 'missing_field', detail: 'fields: status' },
      { artifact: 'C', status: 'fail', kind: 'markdown', failureCode: 'missing_section', detail: 'Summary' },
    ])
    expect(prompt).toContain('B')
    expect(prompt).toContain('json')
    expect(prompt).toContain('missing_field')
    expect(prompt).toContain('fields: status')
    expect(prompt).toContain('C')
    expect(prompt).toContain('missing_section')
    expect(prompt).toContain('Summary')
    expect(prompt).not.toContain('"artifact":"A"')
    expect(prompt.toLowerCase()).toContain('fix')
    expect(prompt.toLowerCase()).toContain('write')
  })

  it('returns a non-empty string even when given no findings', () => {
    const prompt = buildContractRepairPrompt([])
    expect(typeof prompt).toBe('string')
    expect(prompt.length).toBeGreaterThan(0)
  })

  it('repeats root patch artifact guidance for failed patch outputs', () => {
    const prompt = buildContractRepairPrompt([
      { artifact: 'CandidatePatch', status: 'fail', kind: 'text', failureCode: 'missing_file' },
    ])

    expect(prompt).toContain('`./CandidatePatch`')
    expect(prompt).toContain('cd workspace && git diff > ../CandidatePatch')
  })
})
