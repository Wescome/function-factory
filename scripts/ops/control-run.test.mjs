import { describe, expect, it } from 'vitest'
import {
  buildInterventionRequest,
  formatControlResponse,
  parseControlArgs,
} from './control-run.mjs'

describe('control-run CLI helpers', () => {
  it('parses note, cancel, retry, and redispatch commands', () => {
    expect(parseControlArgs(['note', 'run-001', 'watch', 'closely', '--token', 'tok'])).toMatchObject({
      action: 'note',
      runId: 'run-001',
      message: 'watch closely',
      token: 'tok',
    })
    expect(parseControlArgs(['cancel', 'run-001', 'bad', 'run', '--token', 'tok'])).toMatchObject({
      action: 'cancel',
      runId: 'run-001',
      message: 'bad run',
    })
    expect(parseControlArgs(['retry', 'run-001', 'PATCH', 'try', 'again', '--token', 'tok'])).toMatchObject({
      action: 'retry-stage',
      runId: 'run-001',
      stageName: 'PATCH',
      message: 'try again',
    })
    expect(parseControlArgs(['redispatch', 'run-001', 'VERIFY', '--token', 'tok'])).toMatchObject({
      action: 'redispatch-stage',
      runId: 'run-001',
      stageName: 'VERIFY',
    })
  })

  it('builds authenticated intervention requests without leaking token into body', () => {
    const request = buildInterventionRequest(parseControlArgs([
      'retry-stage',
      'run-001',
      'PATCH',
      'recover',
      '--token',
      'tok',
      '--operator',
      'ops',
      '--idempotency-key',
      'idem-1',
    ]))
    expect(request.url.pathname).toBe('/run-interventions/run-001/retry-stage')
    expect(request.init.headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(request.init.body)).toEqual({
      operator: 'ops',
      stageName: 'PATCH',
      reason: 'recover',
      idempotencyKey: 'idem-1',
    })
  })

  it('formats accepted responses compactly', () => {
    expect(formatControlResponse({
      action: 'stage_retry_requested',
      runId: 'run-001',
      stageName: 'PATCH',
      effect: { deduped: true },
    })).toContain('deduped=true')
  })

  it('does not accept broad Cloudflare API tokens as operator control tokens', () => {
    const previous = {
      FF_OPERATOR_TOKEN: process.env.FF_OPERATOR_TOKEN,
      OPERATOR_CONTROL_TOKEN: process.env.OPERATOR_CONTROL_TOKEN,
      CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
      CF_API_TOKEN: process.env.CF_API_TOKEN,
    }
    delete process.env.FF_OPERATOR_TOKEN
    delete process.env.OPERATOR_CONTROL_TOKEN
    process.env.CLOUDFLARE_API_TOKEN = 'cloudflare-token'
    process.env.CF_API_TOKEN = 'cf-token'
    try {
      expect(() => parseControlArgs(['note', 'run-001', 'watch closely'])).toThrow(/missing operator token/)
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })
})
