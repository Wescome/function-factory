import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getInstallationToken } from './github-app-auth'

const originalFetch = globalThis.fetch
const privateKeyWithLiteralNewlines = '-----BEGIN PRIVATE KEY-----\\nAQIDBA==\\n-----END PRIVATE KEY-----'

function mockSubtle() {
  const importKeySpy = vi
    .spyOn(crypto.subtle, 'importKey')
    .mockResolvedValue({} as CryptoKey)
  const signSpy = vi
    .spyOn(crypto.subtle, 'sign')
    .mockResolvedValue(new Uint8Array([1, 2, 3, 4]).buffer)

  return { importKeySpy, signSpy }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

describe('getInstallationToken', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('normalizes PEM with literal newline escapes when creating a JWT', async () => {
    mockSubtle()
    const fetchMock = vi.fn(async (url: string | Request, _init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.url
      if (urlStr.endsWith('/repos/Wescome/function-factory/installation')) {
        return jsonResponse({ id: 42 })
      }
      if (urlStr.endsWith('/app/installations/42/access_tokens')) {
        return jsonResponse({ token: 'ghs_test' })
      }
      return new Response('Not Found', { status: 404 })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await expect(getInstallationToken(
      '12345',
      privateKeyWithLiteralNewlines,
      'Wescome',
      'function-factory',
    )).resolves.toBe('ghs_test')

    const firstInit = fetchMock.mock.calls[0]?.[1]
    if (!firstInit) throw new Error('expected first GitHub fetch call to include RequestInit')
    const firstHeaders = firstInit.headers as Record<string, string>
    const authorization = firstHeaders.Authorization
    if (!authorization) throw new Error('expected first GitHub fetch call to include Authorization header')
    const jwt = authorization.replace('Bearer ', '')
    expect(jwt.split('.')).toHaveLength(3)
  })

  it('returns the installation token on success', async () => {
    mockSubtle()
    globalThis.fetch = vi.fn(async (url: string | Request) => {
      const urlStr = typeof url === 'string' ? url : url.url
      if (urlStr.endsWith('/repos/Wescome/function-factory/installation')) {
        return jsonResponse({ id: 42 })
      }
      if (urlStr.endsWith('/app/installations/42/access_tokens')) {
        return jsonResponse({ token: 'ghs_test' })
      }
      return new Response('Not Found', { status: 404 })
    }) as unknown as typeof fetch

    await expect(getInstallationToken(
      '12345',
      privateKeyWithLiteralNewlines,
      'Wescome',
      'function-factory',
    )).resolves.toBe('ghs_test')
  })

  it('throws on non-401 installation lookup failure', async () => {
    mockSubtle()
    globalThis.fetch = vi.fn(async () => {
      return new Response('not found', { status: 404 })
    }) as unknown as typeof fetch

    await expect(getInstallationToken(
      '12345',
      privateKeyWithLiteralNewlines,
      'Wescome',
      'function-factory',
    )).rejects.toThrow('404')
  })

  it('retries once on 401 from installation lookup', async () => {
    mockSubtle()
    let installationCalls = 0
    globalThis.fetch = vi.fn(async (url: string | Request) => {
      const urlStr = typeof url === 'string' ? url : url.url
      if (urlStr.endsWith('/repos/Wescome/function-factory/installation')) {
        installationCalls++
        if (installationCalls === 1) return new Response('expired jwt', { status: 401 })
        return jsonResponse({ id: 42 })
      }
      if (urlStr.endsWith('/app/installations/42/access_tokens')) {
        return jsonResponse({ token: 'ghs_retry' })
      }
      return new Response('Not Found', { status: 404 })
    }) as unknown as typeof fetch

    await expect(getInstallationToken(
      '12345',
      privateKeyWithLiteralNewlines,
      'Wescome',
      'function-factory',
    )).resolves.toBe('ghs_retry')
    expect(installationCalls).toBe(2)
  })

  it('does not retry forever on repeated 401 installation lookup failures', async () => {
    mockSubtle()
    const fetchMock = vi.fn(async () => {
      return new Response('expired jwt', { status: 401 })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await expect(getInstallationToken(
      '12345',
      privateKeyWithLiteralNewlines,
      'Wescome',
      'function-factory',
    )).rejects.toThrow('401')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
