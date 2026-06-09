import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
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
  writePiAgentAuthConfig,
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

  it('writes per-stage Pi OpenRouter auth config into isolated HOME', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'pi-home-config-test-'))

    const written = await writePiAgentAuthConfig(homeDir)
    const auth = JSON.parse(await readFile(written.authPath, 'utf8'))
    const models = JSON.parse(await readFile(written.modelsPath, 'utf8'))

    expect(auth.openrouter).toEqual({ type: 'api_key', key: 'OFOX_API_KEY' })
    expect(models.providers.openrouter).toMatchObject({
      baseUrl: 'https://api.ofox.ai/v1',
      api: 'openai-completions',
      apiKey: 'OFOX_API_KEY',
      authHeader: true,
    })

    await cleanupWorkDir(homeDir)
  })

  it('removes the workdir after stage execution', async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'pi-cleanup-test-'))
    await writeFile(join(workDir, 'artifact.txt'), 'ok\n')

    expect(await cleanupWorkDir(workDir)).toEqual({ removed: true })
    await expect(stat(workDir)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
