import { describe, expect, it } from 'vitest'
import {
  buildVerificationReport,
  parseSmokeArgs,
  writeVerificationReport,
} from './prod-live-control-smoke.mjs'

describe('prod-live-control-smoke helpers', () => {
  it('parses production smoke args with dedicated operator token', () => {
    expect(parseSmokeArgs([
      '--token', 'tok',
      '--operator', 'ops',
      '--run-prefix', 'prod-check',
      '--timeout', '30',
      '--poll', '1',
      '--skip-harness-upload',
    ], {})).toMatchObject({
      token: 'tok',
      operator: 'ops',
      runPrefix: 'prod-check',
      timeoutMs: 30000,
      pollMs: 1000,
      uploadHarness: false,
    })
  })

  it('requires an operator token', () => {
    expect(() => parseSmokeArgs([], {})).toThrow(/missing operator token/)
  })

  it('builds a pass/fail Verification Report from smoke check results', () => {
    const report = buildVerificationReport({
      id: 'VR-FN-SYNTH-MIGRATE-PROD-LIVE-CONTROL-2026-05-18T22-30-00-000Z',
      createdAt: '2026-05-18T22:30:00.000Z',
      baseUrl: 'https://ff-pipeline.example.com',
      harnessKey: 'harnesses/operator-recovery-smoke.harness.yaml',
      worker: {
        environment: 'production',
        workerVersion: { id: 'worker-123' },
      },
      results: [
        {
          name: 'interactive_retry',
          ok: true,
          rationale: 'retry works',
          evidence: { run_id: 'run-retry', status: 'completed' },
        },
      ],
    })

    expect(report).toMatchObject({
      artifact_type: 'VerificationReport',
      source_refs: ['FN-SYNTH-MIGRATE'],
      verdict: 'pass',
      target: {
        worker_version_id: 'worker-123',
        environment: 'production',
      },
      remediation: 'no remediation required',
    })
    expect(report.checks[0]).toMatchObject({
      name: 'interactive_retry',
      verdict: 'pass',
      explicitness: 'explicit',
    })
  })

  it('writes the report to a VR-prefixed YAML path', () => {
    const writes = []
    const report = {
      id: 'VR-FN-SYNTH-MIGRATE-PROD-LIVE-CONTROL-2026-05-18T22-30-00-000Z',
      verdict: 'pass',
    }
    const path = writeVerificationReport(report, 'specs/verification-reports', {
      mkdir: () => {},
      writeFile: (...args) => writes.push(args),
    })

    expect(path).toBe('specs/verification-reports/VR-FN-SYNTH-MIGRATE-PROD-LIVE-CONTROL-2026-05-18T22-30-00-000Z.yaml')
    expect(writes[0][1]).toContain('verdict: pass')
  })
})
