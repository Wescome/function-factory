import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callProvider, stripCodeFences, extractJSON } from './providers.js'
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
      { provider: 'cloudflare', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' },
      'You are a test.',
      'Say hello.',
      env,
    )

    expect(result).toBe('workers ai response')
    expect(mockRun).toHaveBeenCalledOnce()
    const [model, opts] = mockRun.mock.calls[0]!
    expect(model).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast')
    expect(opts.messages[0].role).toBe('system')
    expect(opts.messages[0].content).toContain('You are a test.')
    expect(opts.messages[1]).toEqual({ role: 'user', content: 'Say hello.' })
    expect(opts.response_format).toEqual({ type: 'json_object' })
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
      { provider: 'cloudflare', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' },
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
        { provider: 'cloudflare', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' },
        'sys',
        'user',
        env,
      ),
    ).rejects.toThrow('Workers AI fallback unavailable')
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

// ────────────────────────────────────────────────────────────
// stripCodeFences — unit tests
// ────────────────────────────────────────────────────────────

describe('stripCodeFences', () => {
  // Case 0: original happy path still works
  it('strips json code fence wrapping entire string', () => {
    const input = '```json\n{"ok": true}\n```'
    expect(stripCodeFences(input)).toBe('{"ok": true}')
  })

  // Case 1: text AFTER the closing fence (production error case)
  it('extracts json when LLM adds explanation after the fence', () => {
    const input = '```json\n{"status": "done"}\n```\nHere is the JSON you requested.'
    expect(stripCodeFences(input)).toBe('{"status": "done"}')
  })

  // Case 2: text BEFORE the opening fence
  it('extracts json when LLM adds preamble before the fence', () => {
    const input = 'Sure, here is the result:\n```json\n{"key": "value"}\n```'
    expect(stripCodeFences(input)).toBe('{"key": "value"}')
  })

  // Case 3: text both before AND after the fence
  it('extracts first code block when text surrounds it', () => {
    const input = 'Here you go:\n```json\n{"a": 1}\n```\nLet me know if you need more.'
    expect(stripCodeFences(input)).toBe('{"a": 1}')
  })

  // Case 4: multiple code blocks — extract only the first
  it('extracts the first code block when multiple exist', () => {
    const input = '```json\n{"first": true}\n```\nAnd also:\n```json\n{"second": true}\n```'
    expect(stripCodeFences(input)).toBe('{"first": true}')
  })

  // Case 5: no newline before closing fence
  it('handles no newline before closing fence', () => {
    const input = '```json\n{"compact": true}```'
    expect(stripCodeFences(input)).toBe('{"compact": true}')
  })

  // Case 6: bare ``` markers (no language tag)
  it('strips bare code fences without language tag', () => {
    const input = '```\n{"bare": true}\n```'
    expect(stripCodeFences(input)).toBe('{"bare": true}')
  })

  // Case 7: ```typescript marker
  it('strips typescript code fences', () => {
    const input = '```typescript\nconst x = 42;\n```'
    expect(stripCodeFences(input)).toBe('const x = 42;')
  })

  // Case 8: other language markers (```ts, ```js, etc.)
  it('strips arbitrary language markers', () => {
    const input = '```ts\ntype Foo = string;\n```'
    expect(stripCodeFences(input)).toBe('type Foo = string;')
  })

  // Case 9: no code fences at all — return as-is (trimmed)
  it('returns plain text unchanged when no code fences present', () => {
    const input = '  {"already": "clean"}  '
    expect(stripCodeFences(input)).toBe('{"already": "clean"}')
  })

  // Case 10: multiline content inside fence
  it('preserves multiline content inside fence', () => {
    const input = '```json\n{\n  "multi": true,\n  "line": "yes"\n}\n```'
    expect(stripCodeFences(input)).toBe('{\n  "multi": true,\n  "line": "yes"\n}')
  })

  // Case 11: closing fence with trailing spaces
  it('handles closing fence with trailing whitespace', () => {
    const input = '```json\n{"ok": true}\n```   '
    expect(stripCodeFences(input)).toBe('{"ok": true}')
  })

  // Case 12: fence content with no newline after opening marker
  it('handles content on same line as opening fence (no newline)', () => {
    const input = '```json{"inline": true}```'
    expect(stripCodeFences(input)).toBe('{"inline": true}')
  })
})

// ────────────────────────────────────────────────────────────
// extractJSON — 4-tier fallback JSON extraction
// ────────────────────────────────────────────────────────────

describe('extractJSON', () => {
  // Tier 1: Fast path — raw text is already valid JSON
  it('returns clean JSON object as-is (fast path)', () => {
    const input = '{"status": "done", "count": 42}'
    expect(extractJSON(input)).toBe('{"status": "done", "count": 42}')
  })

  it('returns clean JSON array as-is (fast path)', () => {
    const input = '[1, 2, 3]'
    expect(extractJSON(input)).toBe('[1, 2, 3]')
  })

  it('handles clean JSON with leading/trailing whitespace (fast path)', () => {
    const input = '  \n{"ok": true}\n  '
    expect(extractJSON(input)).toBe('{"ok": true}')
  })

  // Tier 2: Code fence extraction
  it('extracts JSON from ```json fence', () => {
    const input = '```json\n{"status": "done"}\n```'
    expect(extractJSON(input)).toBe('{"status": "done"}')
  })

  it('extracts JSON from ```JSON fence (uppercase)', () => {
    const input = '```JSON\n{"upper": true}\n```'
    expect(extractJSON(input)).toBe('{"upper": true}')
  })

  it('extracts JSON from bare ``` fence', () => {
    const input = '```\n{"bare": true}\n```'
    expect(extractJSON(input)).toBe('{"bare": true}')
  })

  it('extracts JSON when LLM adds preamble before fence', () => {
    const input = 'Here is the JSON:\n```json\n{"key": "value"}\n```'
    expect(extractJSON(input)).toBe('{"key": "value"}')
  })

  it('extracts JSON when LLM adds trailing text after fence', () => {
    const input = '```json\n{"result": true}\n```\nHope that helps!'
    expect(extractJSON(input)).toBe('{"result": true}')
  })

  it('extracts JSON when text surrounds the fence', () => {
    const input = 'Sure thing:\n```json\n{"a": 1}\n```\nLet me know if you need more.'
    expect(extractJSON(input)).toBe('{"a": 1}')
  })

  // Tier 3: Brace/bracket matching — no fences, JSON embedded in prose
  it('extracts JSON object embedded in prose (no fences)', () => {
    const input = 'The result is {"found": true, "id": 7} as expected.'
    expect(extractJSON(input)).toBe('{"found": true, "id": 7}')
  })

  it('extracts JSON array embedded in prose (first [ last ])', () => {
    const input = 'Here are the results: [{"a":1},{"b":2}] -- done.'
    expect(extractJSON(input)).toBe('[{"a":1},{"b":2}]')
  })

  it('extracts JSON object when prose wraps it on multiple lines', () => {
    const input = 'I generated this:\n{\n  "multi": true,\n  "line": "yes"\n}\nDone.'
    expect(extractJSON(input)).toBe('{\n  "multi": true,\n  "line": "yes"\n}')
  })

  // Tier 4: Nothing worked — return trimmed text
  it('returns trimmed text when no valid JSON found', () => {
    const input = '  This is just plain text with no JSON at all.  '
    expect(extractJSON(input)).toBe('This is just plain text with no JSON at all.')
  })

  it('returns trimmed text for malformed JSON-like content', () => {
    const input = '{not json at all, missing quotes}'
    // The braces are there but it won't parse — falls through to tier 4
    expect(extractJSON(input)).toBe('{not json at all, missing quotes}')
  })

  // Edge cases
  it('is deterministic and pure (same input always same output)', () => {
    const input = '```json\n{"deterministic": true}\n```'
    const r1 = extractJSON(input)
    const r2 = extractJSON(input)
    expect(r1).toBe(r2)
  })

  it('prefers code fence extraction over brace matching', () => {
    // If there's a code fence AND loose braces, the fence wins
    const input = 'Preamble {"noise": false} then:\n```json\n{"signal": true}\n```'
    expect(extractJSON(input)).toBe('{"signal": true}')
  })
})
