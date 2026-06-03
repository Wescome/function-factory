import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PassThrough } from 'node:stream'
import { EventEmitter } from 'node:events'

vi.mock('node:http', async () => {
  const actual = await vi.importActual('node:http')
  return {
    ...actual,
    createServer: vi.fn(() => ({
      listen: vi.fn(),
    })),
  }
})

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual('node:child_process')
  return {
    ...actual,
    spawn: vi.fn(),
  }
})
vi.mock('./path-guard.mjs', () => ({
  createPathGuard: vi.fn(() => ({
    checkPatch: vi.fn(() => ({ allowed: [], blocked: [] })),
  })),
}))

const childProcess = await import('node:child_process')
const { handleExecute } = await import('./server.mjs')

function makeMockPiProcess() {
  const pi = new EventEmitter()
  pi.stdout = new PassThrough()
  pi.stderr = new PassThrough()
  pi.stdin = {
    write: vi.fn(() => {
      setTimeout(() => {
        pi.stdout.write(`${JSON.stringify({ type: 'agent_end' })}\n`)
      }, 10)
    }),
  }
  pi.pid = 12345
  pi.exitCode = null
  pi.kill = vi.fn()
  setTimeout(() => {
    pi.emit('exit', 0, null)
  }, 1000)
  return pi
}

function makeMockTarProcess() {
  const tar = new EventEmitter()
  tar.stdout = new PassThrough()
  tar.stderr = new PassThrough()
  tar.kill = vi.fn()
  Promise.resolve().then(() => {
    tar.emit('close', 0)
  })
  return tar
}

function makeRequest(body) {
  const req = new PassThrough()
  req.method = 'POST'
  req.url = '/execute'
  req.end(JSON.stringify(body))
  return req
}

function makeResponse() {
  const chunks = []
  const res = {
    headersSent: false,
    status: null,
    headers: null,
    writeHead: vi.fn((status, headers) => {
      res.headersSent = true
      res.status = status
      res.headers = headers
    }),
    end: vi.fn((chunk) => {
      if (chunk !== undefined) chunks.push(String(chunk))
    }),
  }
  return { res, chunks }
}

describe('pi-container autonomous execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    childProcess.spawn.mockImplementation((command) => {
      if (command === 'tar') return makeMockTarProcess()
      return makeMockPiProcess()
    })
  })

  it('handles null input artifact content in autonomous mode without crashing', async () => {
    const req = makeRequest({
      runId: 'autonomous-run-1',
      stageName: 'PLAN',
      roleName: 'Planner',
      execution: { authoringMode: 'autonomous_filesystem' },
      declaredOutputs: [],
      context: {
        inputArtifacts: {
          SeedWorkspace: null,
          Notes: 123,
        },
      },
    })
    const { res, chunks } = makeResponse()

    await handleExecute(req, res)

    expect(res.status).toBe(200)
    expect(res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ 'Content-Type': 'application/json' }),
    )
    expect(childProcess.spawn).toHaveBeenCalledTimes(2)
    const payload = JSON.parse(chunks.join(''))
    expect(payload.observation.executionPolicy.authoringMode).toBe('autonomous_filesystem')
    expect(payload.observation.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'input_artifact_written', name: 'SeedWorkspace', bytes: 0 }),
        expect.objectContaining({ type: 'input_artifact_written', name: 'Notes', bytes: 3 }),
      ]),
    )
    expect(payload.observation.events).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'contract.materialize_command' })]),
    )
  })

  it('returns an artifact manifest for missing declared outputs in autonomous mode', async () => {
    const req = makeRequest({
      runId: 'autonomous-run-2',
      stageName: 'VERIFY',
      roleName: 'Verifier',
      execution: { authoringMode: 'autonomous_filesystem' },
      declaredOutputs: ['VerifierReport'],
      context: {
        inputArtifacts: {
          Notes: null,
        },
      },
    })
    const { res, chunks } = makeResponse()

    await handleExecute(req, res)

    expect(res.status).toBe(500)
    const payload = JSON.parse(chunks.join(''))
    expect(payload.artifact_manifest).toEqual([
      { name: 'VerifierReport', state: 'missing' },
    ])
    expect(payload.error).toMatchObject({
      code: 'PI_TOOL_CAPABILITY_UNAVAILABLE',
    })
  })
})
