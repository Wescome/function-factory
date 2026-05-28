import test from 'node:test'
import assert from 'node:assert/strict'

import { evaluateSlos } from './slo-dashboard.mjs'

test('evaluateSlos passes for healthy snapshot', () => {
  const snapshot = {
    health: { ok: true, status: 200, data: { status: 'healthy', arango: true, aiBinding: true } },
    version: { ok: true, status: 200, data: { workerVersion: { timestamp: new Date().toISOString() } } },
    autonomy: {
      ok: true,
      status: 200,
      data: {
        ok: true,
        function_states: { monitored: 1 },
        open_incidents: [],
        recent_persistence: [{ timestamp: new Date().toISOString() }]
      }
    }
  }

  const result = evaluateSlos(snapshot)
  assert.equal(result.summary.pass, true)
  assert.equal(result.summary.total, 6)
  assert.equal(result.summary.passed, 6)
})

test('evaluateSlos fails when monitored coverage is zero', () => {
  const snapshot = {
    health: { ok: true, status: 200, data: { status: 'healthy', arango: true, aiBinding: true } },
    version: { ok: true, status: 200, data: { workerVersion: { timestamp: new Date().toISOString() } } },
    autonomy: {
      ok: true,
      status: 200,
      data: {
        ok: true,
        function_states: { monitored: 0 },
        open_incidents: [],
        recent_persistence: [{ timestamp: new Date().toISOString() }]
      }
    }
  }

  const result = evaluateSlos(snapshot)
  const coverageCheck = result.checks.find((check) => check.key === 'autonomy_coverage')
  assert.equal(coverageCheck?.pass, false)
  assert.equal(result.summary.pass, false)
})
