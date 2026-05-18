import { describe, expect, it } from 'vitest'
import {
  buildInteractiveControlArgs,
  currentStageName,
  executeInteractiveCommand,
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
  interventions: [
    {
      at: '2026-05-18T20:00:30.000Z',
      type: 'operator_note_added',
      operator: 'ops',
      message: 'watch this run',
    },
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

  it('parses interactive mode with an operator token', () => {
    expect(parseArgs(['run-001', '--interactive', '--token', 'tok', '--operator', 'ops'])).toMatchObject({
      runId: 'run-001',
      interactive: true,
      token: 'tok',
      operator: 'ops',
    })
  })

  it('rejects interactive mode without an operator token', () => {
    const previous = {
      FF_OPERATOR_TOKEN: process.env.FF_OPERATOR_TOKEN,
      OPERATOR_CONTROL_TOKEN: process.env.OPERATOR_CONTROL_TOKEN,
    }
    delete process.env.FF_OPERATOR_TOKEN
    delete process.env.OPERATOR_CONTROL_TOKEN
    try {
      expect(() => parseArgs(['run-001', '--interactive'])).toThrow(/missing operator token/)
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })

  it('selects the running stage for active logs', () => {
    expect(selectLogStage(snapshot, 'active')).toBe('PATCH')
    expect(selectLogStage(snapshot, 'VERIFY')).toBe('VERIFY')
    expect(selectLogStage(snapshot, 'none')).toBe('')
    expect(currentStageName(snapshot)).toBe('PATCH')
  })

  it('builds interactive retry and redispatch payloads for the current stage', () => {
    const args = parseArgs(['run-001', '--interactive', '--token', 'tok', '--operator', 'ops'])
    expect(buildInteractiveControlArgs(args, snapshot, 'retry-stage', 'try again')).toMatchObject({
      action: 'retry-stage',
      runId: 'run-001',
      stageName: 'PATCH',
      message: 'try again',
      token: 'tok',
      operator: 'ops',
    })
    expect(buildInteractiveControlArgs(args, snapshot, 'redispatch-stage', 'send again')).toMatchObject({
      action: 'redispatch-stage',
      stageName: 'PATCH',
      message: 'send again',
    })
  })

  it('requires cancel confirmation before dispatching', async () => {
    const args = parseArgs(['run-001', '--interactive', '--token', 'tok'])
    const calls = []
    const result = await executeInteractiveCommand(
      async (...call) => {
        calls.push(call)
        return new Response('{}')
      },
      args,
      snapshot,
      'c',
      async () => 'no',
    )

    expect(result).toMatchObject({ refresh: false, message: 'cancel aborted' })
    expect(calls).toHaveLength(0)
  })

  it('dispatches interactive actions and asks the caller to refresh after acceptance', async () => {
    const args = parseArgs(['run-001', '--interactive', '--token', 'tok'])
    const requests = []
    const result = await executeInteractiveCommand(
      async (url, init) => {
        requests.push({ url, init })
        return new Response(JSON.stringify({
          ok: true,
          action: 'stage_retry_requested',
          runId: 'run-001',
          stageName: 'PATCH',
          effect: { enqueued: true },
        }), { status: 202 })
      },
      args,
      snapshot,
      'r',
      async () => 'recover patch',
    )

    expect(result.refresh).toBe(true)
    expect(result.message).toContain('stage_retry_requested accepted')
    expect(requests).toHaveLength(1)
    expect(requests[0].url.pathname).toBe('/run-interventions/run-001/retry-stage')
    expect(requests[0].init.headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(requests[0].init.body)).toMatchObject({
      stageName: 'PATCH',
      reason: 'recover patch',
    })
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
    expect(text).toContain('Interventions')
    expect(text).toContain('watch this run')
    expect(text).toContain('Attempt Log: PATCH')
    expect(text).toContain('===STAGE_RESULT===')
  })

  it('tails log output without dropping the stage result marker', () => {
    expect(tailLines('a\nb\n===STAGE_RESULT===\n{"status":"pass"}\n', 2)).toContain('{"status":"pass"}')
  })
})
