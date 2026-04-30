import { describe, expect, it } from 'vitest'
import { resolve, resolveAndCall } from './index.js'
import type { RoutingConfig } from './index.js'

const CF_70B = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
const CF_KIMI = '@cf/moonshotai/kimi-k2.6'

describe('resolve', () => {
  it('routes pipeline task kinds to Workers AI llama 70B by default', () => {
    for (const kind of ['planning', 'structured', 'interpretive', 'synthesis', 'validation', 'runtime_check', 'semantic_review'] as const) {
      const route = resolve(kind)
      expect(route.primary).toEqual({ provider: 'cloudflare', model: CF_70B })
      expect(route.fallback).toBeUndefined()
      expect(route.resolvedVia).toBe('route-default')
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

  it('falls back when the primary target fails and a fallback exists', async () => {
    let attempt = 0
    const result = await resolveAndCall('planner', async (target) => {
      attempt += 1
      if (attempt === 1) throw new Error('primary down')
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
    await expect(
      resolveAndCall('planning', async () => {
        throw new Error('down')
      }),
    ).rejects.toThrow('down')
  })
})
