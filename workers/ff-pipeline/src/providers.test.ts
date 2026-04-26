import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callProvider } from './providers.js'
import type { ProviderEnv } from './providers.js'

// ────────────────────────────────────────────────────────────
// Workers AI provider path
// ────────────────────────────────────────────────────────────

describe('callProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  // ── ofox.ai (default path, existing behavior) ──

  it('calls ofox.ai for non-cloudflare providers', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'hello world' } }],
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const env: ProviderEnv = { OFOX_API_KEY: 'test-key' }
    const result = await callProvider(
      { provider: 'deepseek', model: 'deepseek-v4-flash' },
      'You are a test.',
      'Say hello.',
      env,
    )

    expect(result).toBe('hello world')
    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, opts] = mockFetch.mock.calls[0]!
    expect(url).toBe('https://api.ofox.ai/v1/chat/completions')
    expect(JSON.parse(opts.body).model).toBe('deepseek/deepseek-v4-flash')
  })

  it('throws when OFOX_API_KEY is not set for non-cloudflare provider', async () => {
    const env: ProviderEnv = {}
    await expect(
      callProvider(
        { provider: 'deepseek', model: 'deepseek-v4-flash' },
        'sys',
        'user',
        env,
      ),
    ).rejects.toThrow('OFOX_API_KEY not set')
  })

  it('throws on non-OK ofox response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    }))
    const env: ProviderEnv = { OFOX_API_KEY: 'key' }
    await expect(
      callProvider(
        { provider: 'anthropic', model: 'claude-opus-4.6' },
        'sys',
        'user',
        env,
      ),
    ).rejects.toThrow('ofox')
  })

  // ── Workers AI (cloudflare provider) ──

  it('calls env.AI.run() for cloudflare provider', async () => {
    const mockRun = vi.fn().mockResolvedValue({
      response: 'workers ai response',
    })
    const env: ProviderEnv = {
      AI: { run: mockRun },
    }

    const result = await callProvider(
      { provider: 'cloudflare', model: '@cf/qwen/qwen3-30b-a3b' },
      'You are a test.',
      'Say hello.',
      env,
    )

    expect(result).toBe('workers ai response')
    expect(mockRun).toHaveBeenCalledOnce()
    expect(mockRun).toHaveBeenCalledWith(
      '@cf/qwen/qwen3-30b-a3b',
      {
        messages: [
          { role: 'system', content: 'You are a test.' },
          { role: 'user', content: 'Say hello.' },
        ],
      },
    )
  })

  it('does NOT require OFOX_API_KEY for cloudflare provider', async () => {
    const mockRun = vi.fn().mockResolvedValue({
      response: 'no key needed',
    })
    const env: ProviderEnv = {
      // No OFOX_API_KEY — should still work
      AI: { run: mockRun },
    }

    const result = await callProvider(
      { provider: 'cloudflare', model: '@cf/qwen/qwen3-30b-a3b' },
      'sys',
      'user',
      env,
    )
    expect(result).toBe('no key needed')
  })

  it('throws when cloudflare provider has no AI binding', async () => {
    const env: ProviderEnv = {}
    await expect(
      callProvider(
        { provider: 'cloudflare', model: '@cf/qwen/qwen3-30b-a3b' },
        'sys',
        'user',
        env,
      ),
    ).rejects.toThrow('AI binding')
  })

  it('strips code fences from ofox response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '```json\n{"ok": true}\n```' } }],
      }),
    }))
    const env: ProviderEnv = { OFOX_API_KEY: 'key' }
    const result = await callProvider(
      { provider: 'deepseek', model: 'deepseek-v4-flash' },
      'sys',
      'user',
      env,
    )
    expect(result).toBe('{"ok": true}')
  })
})
