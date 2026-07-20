#!/usr/bin/env node
// e2e-commissioning.mjs — full factory pipeline e2e. Signal in → poll for seeded+atomCount>0.
// Env: WEOPS_SIGNING_KEY (base64), FF_GATEWAY_URL, FF_CA_URL (defaults to workers.dev)
import { webcrypto, randomUUID } from 'node:crypto'
import process from 'node:process'

const { subtle } = webcrypto
const GATEWAY = process.env.FF_GATEWAY_URL ?? 'https://ff-gateway.koales.workers.dev'
const CA_URL = process.env.FF_CA_URL ?? 'https://ff-commissioning-agent.koales.workers.dev'
const WEOPS_B64 = process.env.WEOPS_SIGNING_KEY
if (!WEOPS_B64) { console.error('WEOPS_SIGNING_KEY not set'); process.exit(1) }

const DISPOSITION_ID = 'E2E-GTM-' + Date.now()
const ORG_ID = 'acme-gtm-e2e'
const WG_ID = 'WG-gtm-e2e-' + Date.now()

async function httpPost(url, headers, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) })
  return { status: res.status, body: await res.text() }
}

async function httpGet(url) {
  const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(10000) })
  return { status: res.status, body: await res.text() }
}

const keyBytes = Buffer.from(WEOPS_B64, 'base64')
const key = await subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
const hdr = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
const now = Math.floor(Date.now() / 1000)
const claims = Buffer.from(JSON.stringify({
  iss: 'weops-gateway', sub: '98037a7f-c284-44e2-b867-06198d166c9e',
  aud: 'factory-i-layer', iat: now, exp: now + 300,
  jti: randomUUID(), scope: ['we-layer:commission'],
  dispositionEventId: DISPOSITION_ID, elucidationArtifactId: DISPOSITION_ID,
})).toString('base64url')
const sig = Buffer.from(await subtle.sign('HMAC', key, Buffer.from(hdr + '.' + claims))).toString('base64url')
const jwt = hdr + '.' + claims + '.' + sig

console.log('\n→ POST ' + GATEWAY + '/signals')
console.log('  orgId: ' + ORG_ID + '  dispositionEventId: ' + DISPOSITION_ID)
console.log('  repoId: function-factory (bootstrap)')

const res = await httpPost(GATEWAY + '/signals', { Authorization: 'Bearer ' + jwt }, {
  signalType: 'CommissioningSignal',
  repoId: 'function-factory',
  workGraphId: WG_ID,
  workGraphVersion: 'v1',
  dispositionEventId: DISPOSITION_ID,
  elucidationArtifactId: DISPOSITION_ID,
  issuedAt: new Date().toISOString(),
  requireHumanApproval: false,
})

console.log('  gateway status: ' + res.status)
console.log('  gateway body:   ' + res.body)

let accepted
try { accepted = JSON.parse(res.body) } catch { accepted = {} }

if (res.status !== 202 || !accepted.sessionId) {
  console.log('\n❌ Gateway did not accept signal (expected 202 with sessionId) — FAIL')
  process.exit(1)
}

const sessionId = accepted.sessionId
const orgId = accepted.orgId ?? 'function-factory'
// CA worker routes GET /agents/commissioning/{orgId}/signal/{sessionId} → DO poll
const pollUrl = CA_URL + '/agents/commissioning/' + orgId + '/signal/' + sessionId
console.log('\n✓ Commissioned  sessionId=' + sessionId)
console.log('  Polling CA:   ' + pollUrl)

const POLL_INTERVAL_MS = 5000
const POLL_MAX_MS = 300000
const start = Date.now()

while (Date.now() - start < POLL_MAX_MS) {
  await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
  const elapsed = Math.round((Date.now() - start) / 1000)
  let poll
  try {
    poll = await httpGet(pollUrl)
  } catch (err) {
    console.log('  [' + elapsed + 's] poll error: ' + err.message)
    continue
  }
  let state
  try { state = JSON.parse(poll.body) } catch { state = {} }
  console.log('  [' + elapsed + 's] phase=' + state.phase + ' isNodeId=' + state.isNodeId + ' runId=' + state.runId)

  // Terminal: workflow completed and IS-* was emitted to Mediation
  if (state.phase === 'idle' && state.isNodeId) {
    console.log('\n✅ Compiler workflow complete — isNodeId: ' + state.isNodeId + ' — PASS')
    process.exit(0)
  }
  // Terminal: suspended waiting for human approval (shouldn't happen with requireHumanApproval:false)
  if (state.phase === 'suspended-approval') {
    console.log('\n⚠️  Workflow suspended for human approval — isNodeId: ' + state.isNodeId)
    console.log('   POST /divergence with a ResumeSignal to continue')
    process.exit(1)
  }
  // Error response
  if (poll.status === 404) {
    console.log('\n❌ Session not found (404) — signal may not have reached CA — FAIL')
    process.exit(1)
  }
}

console.log('\n❌ Timed out after ' + Math.round(POLL_MAX_MS/1000) + 's — workflow did not complete — FAIL')
process.exit(1)
