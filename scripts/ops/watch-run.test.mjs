import { describe, expect, it } from 'vitest'
import {
  formatSnapshot,
  parseArgs,
  selectLogStage,
  tailLines,
} from './watch-run.mjs'

const snapshot = {
  schemaVersion: '1.0',
  runId: 'run-001',
  status: 'running',
  currentStage: 'PATCH',
  updatedAt: '2026-05-18T20:00:00.000Z',
  stages: [
    { name: 'SEED', status: 'pass', worker: 'preseed', attempts: 1, artifacts: ['SeedWorkspace'] },
    { name: 'PATCH', status: 'running', worker: 'pi-author', attempts: 1, artifacts: [] },
  ],
  timeline: [
    {
      at: '2026-05-18T20:00:00.000Z',
      type: 'stage_started',
      emitter: 'harness-dispatcher',
      stageName: 'PATCH',
      attemptNumber: 1,
    },
  ],
  diagnostics: {
    observations: ['runs/run-001/artifacts/__observability/PATCH.container-observation.json'],
    contractEvaluations: [],
    attemptLogsPrefix: 'runs/_attempt-logs/run-001/',
  },
  artifacts: [
    { name: 'SeedWorkspace', stage: 'SEED', key: 'runs/run-001/artifacts/SeedWorkspace' },
  ],
}

describe('watch-run CLI helpers', () => {
  it('parses watch options conservatively', () => {
    expect(parseArgs(['run-001', '--once', '--limit', '8', '--interval', '2', '--logs', 'VERIFY'])).toMatchObject({
      runId: 'run-001',
      once: true,
      eventLimit: 8,
      intervalMs: 2000,
      logs: 'VERIFY',
    })
  })

  it('selects the running stage for active logs', () => {
    expect(selectLogStage(snapshot, 'active')).toBe('PATCH')
    expect(selectLogStage(snapshot, 'VERIFY')).toBe('VERIFY')
    expect(selectLogStage(snapshot, 'none')).toBe('')
  })

  it('formats a compact operator snapshot', () => {
    const text = formatSnapshot(snapshot, {
      stageName: 'PATCH',
      key: 'runs/_attempt-logs/run-001/PATCH/attempt-1.log',
      text: 'line 1\nline 2\n===STAGE_RESULT===\n{"status":"pass"}\n',
    }, new Date('2026-05-18T20:01:00.000Z'))

    expect(text).toContain('Function Factory Run Monitor')
    expect(text).toContain('runId: run-001')
    expect(text).toContain('PATCH')
    expect(text).toContain('pi-author')
    expect(text).toContain('Attempt Log: PATCH')
    expect(text).toContain('===STAGE_RESULT===')
  })

  it('tails log output without dropping the stage result marker', () => {
    expect(tailLines('a\nb\n===STAGE_RESULT===\n{"status":"pass"}\n', 2)).toContain('{"status":"pass"}')
  })
})
