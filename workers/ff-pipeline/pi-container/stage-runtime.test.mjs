import { describe, expect, it } from 'vitest'
import { mkdtemp, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  cleanupWorkDir,
  createStageLogCollector,
  createStageLogStore,
  redact,
  resolvePiHomeDir,
  resolvePiSessionDir,
  sessionArchiveCandidates,
} from './stage-runtime.mjs'

describe('stage runtime isolation helpers', () => {
  it('redacts secrets before retaining stage logs', () => {
    expect(redact('Authorization: "Bearer sk-secret-token" OPENROUTER_API_KEY=sk-123456789'))
      .not.toContain('sk-secret-token')
  })

  it('keeps stage log tails isolated by run and stage', () => {
    const store = createStageLogStore()
    store.set('run-a', 'PATCH', '{"stage":"PATCH"}\n')
    store.set('run-a', 'VERIFY', '{"stage":"VERIFY"}\n')

    expect(store.consume('run-a', 'PATCH')).toContain('PATCH')
    expect(store.consume('run-a', 'PATCH')).toBe('')
    expect(store.consume('run-a', 'VERIFY')).toContain('VERIFY')
  })

  it('bounds retained log bytes without dropping redaction', () => {
    const collector = createStageLogCollector(32)
    collector.append(`before sk-123456789 ${'x'.repeat(80)}`)

    expect(collector.bytes()).toBeLessThanOrEqual(32)
    expect(collector.tail()).not.toContain('sk-123456789')
  })

  it('uses per-workdir Pi session and home directories', () => {
    const workDir = '/tmp/pi-stage-abc'
    expect(resolvePiSessionDir(workDir)).toBe('/tmp/pi-stage-abc/.pi-sessions')
    expect(resolvePiHomeDir(workDir)).toBe('/tmp/pi-stage-abc/.pi-home')
    expect(sessionArchiveCandidates(workDir).map((candidate) => candidate.dir))
      .not.toContain('/root/.pi/sessions')
  })

  it('removes the workdir after stage execution', async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'pi-cleanup-test-'))
    await writeFile(join(workDir, 'artifact.txt'), 'ok\n')

    expect(await cleanupWorkDir(workDir)).toEqual({ removed: true })
    await expect(stat(workDir)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
