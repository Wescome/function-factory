/**
 * @module arango-client
 *
 * Lightweight ArangoDB HTTP client for Cloudflare Workers.
 *
 * Workers can't use arangojs (Node.js socket assumptions). This client
 * uses fetch() directly against ArangoDB's HTTP API. Designed for the
 * Factory's access patterns: document CRUD, AQL queries, graph traversals.
 *
 * Not a general-purpose driver. Covers what the Factory needs.
 */

export interface ArangoConfig {
  url: string        // e.g., "https://your-instance.arangodb.cloud:8529"
  database: string   // e.g., "function_factory"
  auth: {
    type: 'jwt'
    token: string
  } | {
    type: 'basic'
    username: string
    password: string
  }
}

export interface ArangoQueryResult<T = unknown> {
  result: T[]
  hasMore: boolean
  count?: number
}

export class ArangoClient {
  private baseUrl: string
  private headers: Record<string, string>

  constructor(private config: ArangoConfig) {
    this.baseUrl = `${config.url}/_db/${config.database}`
    this.headers = {
      'Content-Type': 'application/json',
      ...this.authHeader(),
    }
  }

  private authHeader(): Record<string, string> {
    if (this.config.auth.type === 'jwt') {
      return { Authorization: `Bearer ${this.config.auth.token}` }
    }
    const encoded = btoa(
      `${this.config.auth.username}:${this.config.auth.password}`,
    )
    return { Authorization: `Basic ${encoded}` }
  }

  // ── Document operations ──

  async get<T = unknown>(
    collection: string,
    key: string,
  ): Promise<T | null> {
    const res = await fetch(
      `${this.baseUrl}/_api/document/${collection}/${key}`,
      { headers: this.headers },
    )
    if (res.status === 404) return null
    if (!res.ok) throw await this.error(res, 'GET', collection, key)
    return res.json() as Promise<T>
  }

  async save<T = unknown>(
    collection: string,
    doc: Record<string, unknown>,
  ): Promise<T> {
    const res = await fetch(
      `${this.baseUrl}/_api/document/${collection}`,
      {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(doc),
      },
    )
    if (!res.ok) throw await this.error(res, 'SAVE', collection)
    return res.json() as Promise<T>
  }

  async update<T = unknown>(
    collection: string,
    key: string,
    patch: Record<string, unknown>,
  ): Promise<T> {
    const res = await fetch(
      `${this.baseUrl}/_api/document/${collection}/${key}`,
      {
        method: 'PATCH',
        headers: this.headers,
        body: JSON.stringify(patch),
      },
    )
    if (!res.ok) throw await this.error(res, 'UPDATE', collection, key)
    return res.json() as Promise<T>
  }

  async remove(collection: string, key: string): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/_api/document/${collection}/${key}`,
      { method: 'DELETE', headers: this.headers },
    )
    if (!res.ok && res.status !== 404) {
      throw await this.error(res, 'REMOVE', collection, key)
    }
  }

  // ── AQL queries ──

  async query<T = unknown>(
    aql: string,
    bindVars: Record<string, unknown> = {},
  ): Promise<T[]> {
    const res = await fetch(`${this.baseUrl}/_api/cursor`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ query: aql, bindVars }),
    })
    if (!res.ok) throw await this.error(res, 'QUERY')
    const data = (await res.json()) as ArangoQueryResult<T>
    return data.result
  }

  async queryOne<T = unknown>(
    aql: string,
    bindVars: Record<string, unknown> = {},
  ): Promise<T | null> {
    const results = await this.query<T>(aql, bindVars)
    return results[0] ?? null
  }

  // ── Edge operations (for lineage graph) ──

  async saveEdge(
    collection: string,
    from: string,
    to: string,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    await this.save(collection, { _from: from, _to: to, ...data })
  }

  // ── Graph traversal ──

  async traverse<T = unknown>(
    startVertex: string,
    edgeCollection: string,
    direction: 'OUTBOUND' | 'INBOUND' | 'ANY',
    minDepth: number,
    maxDepth: number,
  ): Promise<T[]> {
    return this.query<T>(
      `FOR v, e, p IN ${minDepth}..${maxDepth} ${direction} @start ${edgeCollection}
       RETURN v`,
      { start: startVertex },
    )
  }

  // ── Health check ──

  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.config.url}/_api/version`, {
        headers: this.headers,
      })
      return res.ok
    } catch {
      return false
    }
  }

  // ── Error handling ──

  private async error(
    res: Response,
    op: string,
    collection?: string,
    key?: string,
  ): Promise<Error> {
    const body = await res.text().catch(() => 'no body')
    const target = [collection, key].filter(Boolean).join('/')
    return new Error(
      `ArangoDB ${op} failed [${res.status}]${target ? ` on ${target}` : ''}: ${body}`,
    )
  }
}

/**
 * Create an ArangoClient from Cloudflare Worker env bindings.
 *
 * Expects env to have:
 *   ARANGO_URL      — https://your-instance:8529
 *   ARANGO_DATABASE — function_factory
 *   ARANGO_JWT      — JWT token (production)
 *   or ARANGO_USERNAME + ARANGO_PASSWORD (development)
 */
export function createClientFromEnv(env: {
  ARANGO_URL: string
  ARANGO_DATABASE: string
  ARANGO_JWT?: string
  ARANGO_USERNAME?: string
  ARANGO_PASSWORD?: string
}): ArangoClient {
  const auth = env.ARANGO_JWT
    ? { type: 'jwt' as const, token: env.ARANGO_JWT }
    : {
        type: 'basic' as const,
        username: env.ARANGO_USERNAME ?? 'root',
        password: env.ARANGO_PASSWORD ?? '',
      }

  return new ArangoClient({
    url: env.ARANGO_URL,
    database: env.ARANGO_DATABASE,
    auth,
  })
}
