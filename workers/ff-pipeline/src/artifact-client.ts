export class ArtifactClient {
  private readonly basePath = '/internal/bead-store/factory/artifacts'
  private readonly token: string | undefined

  constructor(private readonly gc: Fetcher, token?: string) {
    this.token = token
  }

  async insert(collection: string, doc: Record<string, unknown>): Promise<void> {
    const normalized = normalizeDoc(doc)
    await this.request('POST', `/${encodeURIComponent(collection)}`, normalized, { includeDocIdOn409: true })
  }

  async save(collection: string, doc: Record<string, unknown>): Promise<void> {
    await this.insert(collection, doc)
  }

  async get<T>(collection: string, id: string): Promise<T | null> {
    const response = await this.gc.fetch(
      new Request(`http://gascity${this.basePath}/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`, {
        method: 'GET',
        headers: this.headers(),
      }),
    )
    if (response.status === 404) return null
    if (!response.ok) {
      const body = await readBody(response)
      throw new Error(body || `artifact get failed (${response.status})`)
    }
    return normalizeRow(await response.json() as Record<string, unknown>) as T
  }

  async patch(collection: string, id: string, fields: Partial<Record<string, unknown>>): Promise<void> {
    await this.request('PATCH', `/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`, fields)
  }

  async update(collection: string, id: string, fields: Partial<Record<string, unknown>>): Promise<void> {
    await this.patch(collection, id, fields)
  }

  async query<T>(collection: string, params: Record<string, unknown>): Promise<T[]> {
    const query = encodeURIComponent(JSON.stringify(normalizeParams(params)))
    const response = await this.gc.fetch(
      new Request(`http://gascity${this.basePath}/${encodeURIComponent(collection)}?query=${query}`, {
        method: 'GET',
        headers: this.headers(),
      }),
    )
    if (!response.ok) {
      const body = await readBody(response)
      throw new Error(body || `artifact query failed (${response.status})`)
    }
    const rows = await response.json() as Record<string, unknown>[]
    return rows.map((row) => normalizeRow(row) as T)
  }

  async queryOne<T>(collection: string, params: Record<string, unknown>): Promise<T | null> {
    const rows = await this.query<T>(collection, params)
    return rows[0] ?? null
  }

  async addLineageEdge(edge: Record<string, unknown>): Promise<void> {
    await this.request('POST', '/lineage', edge)
  }

  async walkLineage(fromId: string, maxDepth = 10): Promise<unknown[]> {
    // FactoryStore currently expects `from`; spec also documents `from_id`.
    const response = await this.gc.fetch(
      new Request(`http://gascity${this.basePath}/lineage?from=${encodeURIComponent(fromId)}&max_depth=${maxDepth}`, {
        method: 'GET',
        headers: this.headers(),
      }),
    )
    if (!response.ok) {
      const body = await readBody(response)
      throw new Error(body || `artifact lineage walk failed (${response.status})`)
    }
    return await response.json<unknown[]>()
  }

  private async request(
    method: 'POST' | 'PATCH',
    path: string,
    body: Record<string, unknown>,
    opts?: { includeDocIdOn409?: boolean },
  ): Promise<void> {
    const response = await this.gc.fetch(
      new Request(`http://gascity${this.basePath}${path}`, {
        method,
        headers: this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      }),
    )

    if (!response.ok) {
      const responseBody = await readBody(response)
      if (response.status === 409 && opts?.includeDocIdOn409) {
        const docId = typeof body.id === 'string' ? body.id : '(missing-id)'
        throw new Error(`409 conflict for id=${docId}: ${responseBody}`)
      }
      throw new Error(responseBody || `artifact request failed (${response.status})`)
    }
  }

  private headers(extra?: Record<string, string>): Headers {
    const headers = new Headers(extra ?? {})
    if (this.token) headers.set('Authorization', `Bearer ${this.token}`)
    return headers
  }
}

export function createArtifactClient(env: { GAS_CITY?: Fetcher; GAS_CITY_BEARER_TOKEN?: string }): ArtifactClient | null {
  if (!env.GAS_CITY) return null
  return new ArtifactClient(env.GAS_CITY, env.GAS_CITY_BEARER_TOKEN)
}

async function readBody(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

function normalizeDoc(doc: Record<string, unknown>): Record<string, unknown> {
  if (typeof doc.id === 'string' && doc.id.length > 0) return doc
  if (typeof doc._key === 'string' && doc._key.length > 0) {
    return { ...doc, id: doc._key }
  }
  return doc
}

function normalizeParams(params: Record<string, unknown>): Record<string, unknown> {
  if (typeof params._key === 'string' && params.id === undefined) {
    return { ...params, id: params._key }
  }
  return params
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  if (typeof row.id === 'string' && row._key === undefined) {
    return { ...row, _key: row.id }
  }
  return row
}
