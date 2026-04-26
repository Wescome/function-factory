import { describe, it, expect } from 'vitest'
import { resolve, resolveAndCall } from './index.js'
import type { RoutingConfig } from './index.js'

// ────────────────────────────────────────────────────────────
// resolve() — basic kind resolution
// ────────────────────────────────────────────────────────────

describe('resolve', () => {
  it('returns primary + fallback for a known task kind', () => {
    const route = resolve('planner')
    expect(route.primary.provider).toBe('google')
    expect(route.primary.model).toBe('gemini-3.1-pro-preview')
    expect(route.fallback?.provider).toBe('deepseek')
    expect(route.resolvedVia).toBe('route-default')
  })

  it('returns config default when task kind has no explicit route', () => {
    const sparse: RoutingConfig = {
      routes: [],
      default: { provider: 'deepseek', model: 'deepseek-v4-flash' },
    }
    const route = resolve('planning', { config: sparse })
    expect(route.primary.provider).toBe('deepseek')
    expect(route.primary.model).toBe('deepseek-v4-flash')
    expect(route.fallback).toBeUndefined()
    expect(route.resolvedVia).toBe('config-default')
  })

  // ── Pass-level overrides ──

  it('resolves pass override for stage_2_pressure', () => {
    const route = resolve('planning', { passId: 'stage_2_pressure' })
    expect(route.primary.provider).toBe('deepseek')
    expect(route.primary.model).toBe('deepseek-v4-pro')
    expect(route.fallback?.provider).toBe('google')
    expect(route.resolvedVia).toBe('pass-override')
    expect(route.passId).toBe('stage_2_pressure')
  })

  it('resolves pass override for stage_3_capability', () => {
    const route = resolve('planning', { passId: 'stage_3_capability' })
    expect(route.primary.provider).toBe('google')
    expect(route.primary.model).toBe('gemini-3.1-pro-preview')
    expect(route.resolvedVia).toBe('pass-override')
  })

  it('resolves pass override for pass_3_invariants', () => {
    const route = resolve('structured', { passId: 'pass_3_invariants' })
    expect(route.primary.provider).toBe('z-ai')
    expect(route.primary.model).toBe('glm-5')
    expect(route.fallback?.provider).toBe('deepseek')
    expect(route.fallback?.model).toBe('deepseek-v4-pro')
    expect(route.resolvedVia).toBe('pass-override')
  })

  it('resolves pass override for pass_5_validations', () => {
    const route = resolve('structured', { passId: 'pass_5_validations' })
    expect(route.primary.provider).toBe('z-ai')
    expect(route.primary.model).toBe('glm-5')
    expect(route.resolvedVia).toBe('pass-override')
  })

  it('falls back to route default for unknown passId', () => {
    const route = resolve('planning', { passId: 'nonexistent_pass' })
    expect(route.primary.provider).toBe('deepseek')
    expect(route.primary.model).toBe('deepseek-v4-flash')
    expect(route.resolvedVia).toBe('route-default')
  })

  it('falls back to route default when no passId provided', () => {
    const route = resolve('planning')
    expect(route.primary.provider).toBe('deepseek')
    expect(route.primary.model).toBe('deepseek-v4-flash')
    expect(route.resolvedVia).toBe('route-default')
  })

  // ── Workers AI (cloudflare provider) ──

  it('resolves stage_1_signal to Workers AI primary', () => {
    const route = resolve('planning', { passId: 'stage_1_signal' })
    expect(route.primary.provider).toBe('cloudflare')
    expect(route.primary.model).toBe('@cf/qwen/qwen3-30b-a3b')
    expect(route.fallback?.provider).toBe('deepseek')
    expect(route.resolvedVia).toBe('pass-override')
  })

  it('uses Workers AI as fallback for validation tasks', () => {
    const route = resolve('validation')
    expect(route.primary.provider).toBe('deepseek')
    expect(route.fallback?.provider).toBe('cloudflare')
    expect(route.fallback?.model).toBe('@cf/qwen/qwen3-30b-a3b')
  })

  it('uses Workers AI as fallback for runtime_check tasks', () => {
    const route = resolve('runtime_check')
    expect(route.fallback?.provider).toBe('cloudflare')
  })

  // ── New TaskKinds: semantic_review and runtime_check ──

  it('routes semantic_review to Opus', () => {
    const route = resolve('semantic_review')
    expect(route.primary.provider).toBe('anthropic')
    expect(route.primary.model).toBe('claude-opus-4.6')
    expect(route.fallback?.provider).toBe('google')
  })

  it('routes runtime_check to DeepSeek with cloudflare fallback', () => {
    const route = resolve('runtime_check')
    expect(route.primary.provider).toBe('deepseek')
    expect(route.primary.model).toBe('deepseek-v4-flash')
    expect(route.fallback?.provider).toBe('cloudflare')
  })

  // ── Stage 6 roles per April 2026 analysis ──

  it('maps each stage 6 role correctly', () => {
    const planner = resolve('planner')
    expect(planner.primary.provider).toBe('google')

    const coder = resolve('coder')
    expect(coder.primary.provider).toBe('deepseek')
    expect(coder.primary.model).toBe('deepseek-v4-pro')
    expect(coder.fallback?.provider).toBe('anthropic')

    const critic = resolve('critic')
    expect(critic.primary.provider).toBe('anthropic')
    expect(critic.primary.model).toBe('claude-opus-4.6')

    const tester = resolve('tester')
    expect(tester.primary.provider).toBe('deepseek')
    expect(tester.fallback?.provider).toBe('moonshotai')
    expect(tester.fallback?.model).toBe('kimi-k2.6')

    const verifier = resolve('verifier')
    expect(verifier.primary.provider).toBe('google')
    expect(verifier.fallback?.provider).toBe('anthropic')
  })

  // ── Custom config ──

  it('accepts a custom config', () => {
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
    expect(route.primary.provider).toBe('cloudflare')
    expect(route.primary.model).toBe('@cf/meta/llama-4-scout-17b-16e-instruct')
  })

  // ── Fallback inheritance ──

  it('pass override without fallback inherits route fallback', () => {
    const config: RoutingConfig = {
      routes: [{
        kind: 'planning',
        primary: { provider: 'deepseek', model: 'deepseek-v4-flash' },
        fallback: { provider: 'anthropic', model: 'claude-haiku-4.5' },
        passOverrides: {
          'my_pass': {
            primary: { provider: 'google', model: 'gemini-3.1-pro-preview' },
            // no fallback — should inherit route's fallback
          },
        },
      }],
      default: { provider: 'deepseek', model: 'deepseek-v4-flash' },
    }
    const route = resolve('planning', { passId: 'my_pass', config })
    expect(route.primary.provider).toBe('google')
    expect(route.fallback?.provider).toBe('anthropic')  // inherited from route
  })

  // ── Model ID correctness (ofox.ai catalog) ──

  it('uses dots in claude-opus-4.6 (not hyphens)', () => {
    const route = resolve('semantic_review')
    expect(route.primary.model).toBe('claude-opus-4.6')
    expect(route.primary.model).not.toContain('4-6')
  })

  it('uses -preview suffix for gemini', () => {
    const route = resolve('interpretive')
    expect(route.primary.model).toBe('gemini-3.1-pro-preview')
  })

  it('uses z-ai provider (not zhipu)', () => {
    const route = resolve('structured', { passId: 'pass_3_invariants' })
    expect(route.primary.provider).toBe('z-ai')
    expect(route.primary.provider).not.toBe('zhipu')
  })

  it('uses moonshotai provider (not moonshot)', () => {
    const route = resolve('tester')
    expect(route.fallback?.provider).toBe('moonshotai')
    expect(route.fallback?.provider).not.toBe('moonshot')
  })
})

// ────────────────────────────────────────────────────────────
// resolveAndCall() — primary + fallback execution
// ────────────────────────────────────────────────────────────

describe('resolveAndCall', () => {
  it('calls fn with primary target on success', async () => {
    const result = await resolveAndCall('planner', async (target) => {
      return `called ${target.provider}/${target.model}`
    })
    expect(result).toBe('called google/gemini-3.1-pro-preview')
  })

  it('falls back on primary failure', async () => {
    let attempt = 0
    const result = await resolveAndCall('planner', async (target) => {
      attempt++
      if (attempt === 1) throw new Error('primary down')
      return `called ${target.provider}/${target.model}`
    })
    expect(result).toBe('called deepseek/deepseek-v4-pro')
    expect(attempt).toBe(2)
  })

  it('respects passId in resolveAndCall', async () => {
    const result = await resolveAndCall(
      'planning',
      async (target) => `called ${target.provider}/${target.model}`,
      { passId: 'stage_2_pressure' },
    )
    expect(result).toBe('called deepseek/deepseek-v4-pro')
  })

  it('falls back from pass override primary to pass override fallback', async () => {
    let attempt = 0
    const result = await resolveAndCall(
      'planning',
      async (target) => {
        attempt++
        if (attempt === 1) throw new Error('V4 Pro down')
        return `called ${target.provider}/${target.model}`
      },
      { passId: 'stage_2_pressure' },
    )
    // stage_2_pressure fallback is google/gemini-3.1-pro-preview
    expect(result).toBe('called google/gemini-3.1-pro-preview')
  })

  it('throws if primary fails and no fallback exists', async () => {
    const noFallback: RoutingConfig = {
      routes: [{
        kind: 'planning',
        primary: { provider: 'openai', model: 'gpt-5.4' },
      }],
      default: { provider: 'deepseek', model: 'deepseek-v4-flash' },
    }
    await expect(
      resolveAndCall(
        'planning',
        async () => { throw new Error('down') },
        { config: noFallback },
      ),
    ).rejects.toThrow('down')
  })

  it('resolveAndCall with Workers AI primary', async () => {
    const result = await resolveAndCall(
      'planning',
      async (target) => `called ${target.provider}/${target.model}`,
      { passId: 'stage_1_signal' },
    )
    expect(result).toBe('called cloudflare/@cf/qwen/qwen3-30b-a3b')
  })
})
