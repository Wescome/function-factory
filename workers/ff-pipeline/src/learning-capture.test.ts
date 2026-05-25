import { describe, expect, it, vi } from 'vitest'
import { captureLearningTranscript } from './learning-capture'
import type { PipelineEnv, PipelineResult } from './types'

function env(overrides: Partial<PipelineEnv> = {}): PipelineEnv {
  return {
    ARANGO_URL: 'http://localhost:8529',
    ARANGO_DATABASE: 'test',
    ARANGO_JWT: 'jwt',
    ENVIRONMENT: 'test',
    GATES: {
      evaluateCoherenceVerification: vi.fn(),
    },
    FACTORY_PIPELINE: {
      create: vi.fn(),
      get: vi.fn(),
    },
    COORDINATOR: {} as PipelineEnv['COORDINATOR'],
    ATOM_EXECUTOR: {} as PipelineEnv['ATOM_EXECUTOR'],
    SYNTHESIS_QUEUE: {} as PipelineEnv['SYNTHESIS_QUEUE'],
    SYNTHESIS_RESULTS: {} as PipelineEnv['SYNTHESIS_RESULTS'],
    ATOM_RESULTS: {} as PipelineEnv['ATOM_RESULTS'],
    GITHUB_APP_ID: '12345',
    GITHUB_APP_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nAQIDBA==\\n-----END PRIVATE KEY-----',
    ...overrides,
  }
}

function db() {
  return {
    query: vi.fn(async () => []),
  }
}

const result: PipelineResult = {
  status: 'synthesis-passed',
  signalId: 'SIG-META-LEARN',
  pressureId: 'PRS-META-LEARN',
  capabilityId: 'BC-META-LEARN',
  proposalId: 'FP-META-LEARN',
  executableSpecificationId: 'ES-META-LEARN',
  coherenceVerificationReport: {
    verification: 'coherence',
    passed: true,
    timestamp: '2026-05-11T00:00:00.000Z',
    executableSpecificationId: 'ES-META-LEARN',
    checks: [],
    summary: 'passed',
  },
  synthesisResult: {
    verdict: { decision: 'pass', confidence: 0.95, reason: 'ok' },
    tokenUsage: 10,
    repairCount: 0,
  },
}

describe('captureLearningTranscript', () => {
  it('returns the original result and performs no write when disabled', async () => {
    const mockDb = db()
    const captured = await captureLearningTranscript({
      env: env({ LEARNING_ENABLED: 'false' }),
      db: mockDb as never,
      runId: 'run-disabled',
      terminalResult: result,
    })

    expect(captured).toBe(result)
    expect(mockDb.query).not.toHaveBeenCalled()
  })

  it('uses UPSERT semantics for enabled transcript writes', async () => {
    const mockDb = db()
    const captured = await captureLearningTranscript({
      env: env({ LEARNING_ENABLED: 'true' }),
      db: mockDb as never,
      runId: 'run-enabled',
      terminalResult: result,
    })

    expect(captured).toBe(result)
    expect(mockDb.query).toHaveBeenCalledOnce()
    const calls = mockDb.query.mock.calls as unknown as Array<[string, Record<string, unknown>]>
    const [query, bindVars] = calls[0]!
    expect(query).toContain('UPSERT')
    expect(bindVars).toMatchObject({
      '@collection': 'learning_run_transcripts',
      key: 'run-run-enabled',
    })
  })

  it('can write factual observations without changing the result', async () => {
    const mockDb = db()
    const captured = await captureLearningTranscript({
      env: env({
        LEARNING_ENABLED: 'true',
        LEARNING_OBSERVATIONS_ENABLED: 'true',
      }),
      db: mockDb as never,
      runId: 'run-observations',
      terminalResult: result,
    })

    expect(captured).toBe(result)
    expect(mockDb.query.mock.calls.length).toBeGreaterThan(1)
    const calls = mockDb.query.mock.calls as unknown as Array<[string, Record<string, unknown>]>
    expect(calls[1]?.[1]).toMatchObject({
      '@collection': 'learning_observations',
    })
  })

  it('catches storage failures and preserves the terminal verdict', async () => {
    const mockDb = {
      query: vi.fn(async () => {
        throw new Error('arango unavailable')
      }),
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const captured = await captureLearningTranscript({
      env: env({ LEARNING_ENABLED: 'true' }),
      db: mockDb as never,
      runId: 'run-failure',
      terminalResult: result,
    })

    expect(captured).toBe(result)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('arango unavailable'))
    warn.mockRestore()
  })
})
