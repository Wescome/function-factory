/**
 * Phase 2: File context cache tests (Fix 4).
 *
 * RED tests that FAIL against current code. Engineer makes them pass.
 *
 * Fix 4: Cache TTL and upsert behavior
 *   atom-executor-do.ts currently uses CACHE_TTL_MS = 3_600_000 (1 hour)
 *   and writes cache entries via plain db.save() which fails on duplicate
 *   SHA keys instead of refreshing the timestamp.
 *
 *   Problems:
 *   1. 1-hour TTL is too long -- stale file contexts cause edits to target
 *      old code that no longer exists. Should be 5 minutes (300_000ms).
 *   2. Plain save() throws on duplicate _key (same file SHA). Should use
 *      UPSERT to refresh cached_at on re-fetch of same content.
 *   3. cached_at is never refreshed on cache hit, meaning frequently
 *      accessed files still expire after the TTL even though they were
 *      just validated.
 *
 * These tests verify the cache logic in isolation by testing the AQL
 * queries and TTL constants. The AtomExecutor DO itself is not instantiated
 * -- we test the extractable cache contract.
 */

import { describe, expect, it } from 'vitest'

// ── Fix 4: Cache TTL ────────────────────────────────────────────────

describe('file-context-cache: TTL and upsert (Fix 4)', () => {

  it('uses 5-minute TTL for cache reads', async () => {
    // The cache TTL must be 5 minutes (300_000ms), not 1 hour.
    // We import the constant directly from the module.
    //
    // CURRENT BEHAVIOR: CACHE_TTL_MS = 3_600_000 (1 hour)
    // CORRECT BEHAVIOR: CACHE_TTL_MS = 300_000 (5 minutes)
    //
    // We read the source to verify the constant. Since CACHE_TTL_MS
    // is not exported, we read it from the file to assert on the value.
    // This is a structural assertion -- the Engineer must change the constant.

    const fs = await import('node:fs')
    const source = fs.readFileSync(
      new URL('./atom-executor-do.ts', import.meta.url).pathname,
      'utf-8',
    )

    // Extract the CACHE_TTL_MS value from source
    const match = source.match(/CACHE_TTL_MS\s*=\s*([\d_]+)/)
    expect(match).not.toBeNull()

    const ttlValue = Number(match![1]!.replace(/_/g, ''))

    // CORRECT: 5 minutes = 300,000 ms
    expect(ttlValue).toBe(300_000)
  })

  it('upserts cache entries instead of plain save', async () => {
    // The cache write must use UPSERT (or equivalent) so that re-fetching
    // a file with the same git SHA refreshes the cached_at timestamp
    // instead of throwing a duplicate key error.
    //
    // CURRENT BEHAVIOR: db.save('file_context_cache', { _key: data.sha, ... })
    //   This throws "unique constraint violated" on duplicate SHA.
    // CORRECT BEHAVIOR: AQL UPSERT or db.save with overwriteMode: 'replace'
    //
    // We verify by reading the source code for the UPSERT pattern.

    const fs = await import('node:fs')
    const source = fs.readFileSync(
      new URL('./atom-executor-do.ts', import.meta.url).pathname,
      'utf-8',
    )

    // The cache write section should use UPSERT, not plain save
    // Look for the file_context_cache write pattern
    const cacheWriteSection = source.slice(
      source.indexOf('file_context_cache'),
      source.indexOf('file_context_cache') + 500,
    )

    // CORRECT: Must contain UPSERT pattern (either in AQL or via save options)
    const hasUpsert =
      cacheWriteSection.includes('UPSERT') ||
      cacheWriteSection.includes('overwrite') ||
      cacheWriteSection.includes('replace')

    expect(hasUpsert).toBe(true)
  })

  it('refreshes cached_at on cache hit with same SHA', async () => {
    // When a file is fetched from GitHub and its SHA matches an existing
    // cache entry, the cached_at timestamp must be updated to extend the
    // entry's effective lifetime. Without this, frequently accessed files
    // still expire after TTL even though the content is known-current.
    //
    // CURRENT BEHAVIOR: plain save() -- on duplicate key, the catch(() => {})
    //   swallows the error and cached_at is never refreshed.
    // CORRECT BEHAVIOR: UPSERT that updates cached_at on conflict.
    //
    // We verify the source includes UPDATE logic for the cached_at field.

    const fs = await import('node:fs')
    const source = fs.readFileSync(
      new URL('./atom-executor-do.ts', import.meta.url).pathname,
      'utf-8',
    )

    // Find the cache write section near file_context_cache
    const cacheSection = source.slice(
      source.indexOf('// Write to ArangoDB cache'),
      source.indexOf('// Write to ArangoDB cache') + 600,
    )

    // CORRECT: The UPDATE clause of the UPSERT must refresh cached_at
    // This means the UPSERT pattern must include cached_at in its update
    const refreshesCachedAt =
      (cacheSection.includes('UPSERT') && cacheSection.includes('cached_at')) ||
      (cacheSection.includes('overwrite') && cacheSection.includes('cached_at'))

    expect(refreshesCachedAt).toBe(true)
  })
})
