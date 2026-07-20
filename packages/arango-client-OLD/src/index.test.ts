import { describe, expect, it, vi } from 'vitest'
import { ArangoClient } from './index.js'

function client(fetcher: typeof fetch) {
  return new ArangoClient({
    url: 'https://arango.example.com:8529',
    database: 'function_factory_test',
    auth: { type: 'jwt', token: 'test-jwt' },
    fetcher,
  })
}

describe('ArangoClient schema helpers', () => {
  it('creates edge collections with Arango collection type 3', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch
    await client(fetcher).ensureCollection('lifecycle_transitions', { type: 'edge' })

    expect(fetcher).toHaveBeenCalledWith(
      'https://arango.example.com:8529/_db/function_factory_test/_api/collection',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'lifecycle_transitions', type: 3 }),
      }),
    )
  })

  it('creates named indexes against a collection', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch
    await client(fetcher).ensureIndex('completion_events', {
      type: 'persistent',
      fields: ['bead_id'],
      unique: true,
      name: 'idx_completion_events_bead_id',
    })

    expect(fetcher).toHaveBeenCalledWith(
      'https://arango.example.com:8529/_db/function_factory_test/_api/index?collection=completion_events',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          type: 'persistent',
          fields: ['bead_id'],
          unique: true,
          sparse: false,
          name: 'idx_completion_events_bead_id',
        }),
      }),
    )
  })
})
