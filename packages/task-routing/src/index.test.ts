import { describe, expect, it } from 'vitest'
import { resolve, resolveAndCall, isRetriableError } from './index.js'
import type { RoutingConfig } from './index.js'

const CF_70B = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
const CF_KIMI = '@cf/moonshotai/kimi-k2.6'
const DEEPSEEK = 'deepseek-v4-pro'

describe('resolve', () => {
  it('routes all pipeline task kinds to llama-70b with deepseek fallback', () => {
    for (const kind of ['planning', 'structured', 'interpretive', 'synthesis', 'validation', 'runtime_check', 'semantic_review'] as const) {
      const route = resolve(kind)
      expect(route.primary).toEqual({ provider: 'cloudflare', model: CF_70B })
      expect(route.fallback).toEqual({ provider: 'deepseek', model: DEEPSEEK })
    }
  })

  it('routes crystallizer + probe to llama-70b with deepseek fallback', () => {
    for (const kind of ['crystallizer', 'probe'] as const) {
      const route = resolve(kind)
      expect(route.primary).toEqual({ provider: 'cloudflare', model: CF_70B })
      expect(route.fallback).toEqual({ provider: 'deepseek', model: DEEPSEEK })
      expect(route.resolvedVia).toBe('route-default')
    }
  })

  it('all 9 pipeline stage routes have cross-provider fallback', () => {
    const pipelineKinds = [
      'planning', 'structured', 'interpretive', 'synthesis',
      'validation', 'runtime_check', 'semantic_review',
      'crystallizer', 'probe',
    ] as const
    for (const kind of pipelineKinds) {
      const route = resolve(kind)
      expect(route.fallback, `${kind} should have a fallback`).toBeDefined()
      expect(route.fallback!.provider).toBe('deepseek')
    }
  })

  it('routes stage 6 agent roles to Workers AI Kimi with llama fallback', () => {
    for (const kind of ['planner', 'coder', 'critic', 'tester', 'verifier'] as const) {
      const route = resolve(kind)
      expect(route.primary).toEqual({ provider: 'cloudflare', model: CF_KIMI })
      expect(route.fallback).toEqual({ provider: 'cloudflare', model: CF_70B })
      expect(route.resolvedVia).toBe('route-default')
    }
  })

  it('does not invent default pass overrides', () => {
    const route = resolve('planning', { passId: 'stage_2_pressure' })
    expect(route.primary).toEqual({ provider: 'cloudflare', model: CF_70B })
    expect(route.passId).toBeUndefined()
    expect(route.resolvedVia).toBe('route-default')
  })

  it('returns config default when the supplied config has no explicit route', () => {
    const sparse: RoutingConfig = {
      routes: [],
      default: { provider: 'deepseek', model: 'deepseek-v4-flash' },
    }
    const route = resolve('planning', { config: sparse })
    expect(route.primary).toEqual({ provider: 'deepseek', model: 'deepseek-v4-flash' })
    expect(route.fallback).toBeUndefined()
    expect(route.resolvedVia).toBe('config-default')
  })

  it('accepts a custom config route', () => {
    const custom: RoutingConfig = {
      routes: [
        {
          kind: 'planning',
          primary: { provider: 'cloudflare', model: '@cf/meta/llama-4-scout-17b-16e-instruct' },
        },
      ],
      default: { provider: 'deepseek', model: 'deepseek-v4-flash' },
    }
    const route = resolve('planning', { config: custom })
    expect(route.primary).toEqual({ provider: 'cloudflare', model: '@cf/meta/llama-4-scout-17b-16e-instruct' })
    expect(route.resolvedVia).toBe('route-default')
  })

  it('supports custom pass overrides and inherits route fallback when omitted', () => {
    const config: RoutingConfig = {
      routes: [
        {
          kind: 'planning',
          primary: { provider: 'cloudflare', model: CF_70B },
          fallback: { provider: 'cloudflare', model: CF_KIMI },
          passOverrides: {
            my_pass: {
              primary: { provider: 'google', model: 'gemini-3.1-pro-preview' },
            },
          },
        },
      ],
      default: { provider: 'cloudflare', model: CF_70B },
    }
    const route = resolve('planning', { passId: 'my_pass', config })
    expect(route.primary).toEqual({ provider: 'google', model: 'gemini-3.1-pro-preview' })
    expect(route.fallback).toEqual({ provider: 'cloudflare', model: CF_KIMI })
    expect(route.passId).toBe('my_pass')
    expect(route.resolvedVia).toBe('pass-override')
  })

  it('uses the current Workers AI model identifiers', () => {
    expect(resolve('planning').primary.model).toBe(CF_70B)
    expect(resolve('crystallizer').primary.model).toBe(CF_70B)
    expect(resolve('planner').primary.model).toBe(CF_KIMI)
  })
})

describe('resolveAndCall', () => {
  it('calls fn with the primary target on success', async () => {
    const result = await resolveAndCall('planner', async (target) => {
      return `called ${target.provider}/${target.model}`
    })
    expect(result).toBe(`called cloudflare/${CF_KIMI}`)
  })

  it('falls back when the primary target fails with a retriable error and a fallback exists', async () => {
    let attempt = 0
    const result = await resolveAndCall('planner', async (target) => {
      attempt += 1
      if (attempt === 1) throw new Error('fetch failed')
      return `called ${target.provider}/${target.model}`
    })
    expect(result).toBe(`called cloudflare/${CF_70B}`)
    expect(attempt).toBe(2)
  })

  it('uses custom pass overrides during resolveAndCall', async () => {
    const config: RoutingConfig = {
      routes: [
        {
          kind: 'planning',
          primary: { provider: 'cloudflare', model: CF_70B },
          passOverrides: {
            my_pass: {
              primary: { provider: 'google', model: 'gemini-3.1-pro-preview' },
            },
          },
        },
      ],
      default: { provider: 'cloudflare', model: CF_70B },
    }
    const result = await resolveAndCall(
      'planning',
      async (target) => `called ${target.provider}/${target.model}`,
      { passId: 'my_pass', config },
    )
    expect(result).toBe('called google/gemini-3.1-pro-preview')
  })

  it('throws if primary fails and no fallback exists', async () => {
    const noFallbackConfig: RoutingConfig = {
      routes: [{ kind: 'planning', primary: { provider: 'cloudflare', model: CF_70B } }],
      default: { provider: 'cloudflare', model: CF_70B },
    }
    await expect(
      resolveAndCall('planning', async () => {
        throw new Error('down')
      }, { config: noFallbackConfig }),
    ).rejects.toThrow('down')
  })

  it('invokes fallback on retriable timeout error', async () => {
    let attempt = 0
    const result = await resolveAndCall('planning', async (target) => {
      attempt += 1
      if (attempt === 1) {
        const err = new Error('request timeout')
        err.name = 'TimeoutError'
        throw err
      }
      return `called ${target.provider}/${target.model}`
    })
    expect(result).toBe(`called deepseek/${DEEPSEEK}`)
    expect(attempt).toBe(2)
  })

  it('throws immediately on non-retriable parse error (no fallback attempted)', async () => {
    let attempt = 0
    await expect(
      resolveAndCall('planning', async () => {
        attempt += 1
        throw new SyntaxError('Unexpected token < in JSON at position 0')
      }),
    ).rejects.toThrow('Unexpected token')
    expect(attempt).toBe(1)
  })

  it('throws immediately on schema validation error (no fallback attempted)', async () => {
    let attempt = 0
    await expect(
      resolveAndCall('planning', async () => {
        attempt += 1
        throw new Error('Schema validation failed: missing required field "title"')
      }),
    ).rejects.toThrow('Schema validation')
    expect(attempt).toBe(1)
  })
})

describe('isRetriableError', () => {
  it('classifies timeout errors as retriable', () => {
    const err = new Error('request timeout')
    err.name = 'TimeoutError'
    expect(isRetriableError(err)).toBe(true)
  })

  it('classifies AbortError as retriable', () => {
    const err = new Error('signal aborted')
    err.name = 'AbortError'
    expect(isRetriableError(err)).toBe(true)
  })

  it('classifies network errors as retriable', () => {
    expect(isRetriableError(new Error('fetch failed'))).toBe(true)
    expect(isRetriableError(new Error('ECONNREFUSED'))).toBe(true)
    expect(isRetriableError(new Error('ECONNRESET'))).toBe(true)
    expect(isRetriableError(new Error('network error'))).toBe(true)
  })

  it('classifies 5xx status errors as retriable', () => {
    expect(isRetriableError(new Error('Workers AI REST model 502: bad gateway'))).toBe(true)
    expect(isRetriableError(new Error('Workers AI REST model 503: unavailable'))).toBe(true)
    expect(isRetriableError(new Error('Workers AI REST model 504: gateway timeout'))).toBe(true)
  })

  it('classifies empty response errors as retriable', () => {
    expect(isRetriableError(new Error('Workers AI kimi-k2.6: empty response'))).toBe(true)
  })

  it('classifies JSON parse errors as NOT retriable', () => {
    expect(isRetriableError(new SyntaxError('Unexpected token < in JSON at position 0'))).toBe(false)
  })

  it('classifies schema validation errors as NOT retriable', () => {
    expect(isRetriableError(new Error('Schema validation failed: missing required field'))).toBe(false)
  })

  it('classifies generic application errors as NOT retriable', () => {
    expect(isRetriableError(new Error('Invalid input: title cannot be empty'))).toBe(false)
  })

  it('classifies non-Error values as retriable (unknown errors try fallback)', () => {
    expect(isRetriableError('some string error')).toBe(true)
    expect(isRetriableError(42)).toBe(true)
    expect(isRetriableError(null)).toBe(true)
    expect(isRetriableError(undefined)).toBe(true)
  })
})
