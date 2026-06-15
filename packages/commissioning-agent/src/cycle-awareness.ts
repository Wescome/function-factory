/**
 * @factory/commissioning-agent — CycleAwarenessService
 *
 * Fetches the active Linear cycle for a team and derives cycle-boundary flags.
 * Implements SPEC-FF-CYCLE-HEALTH-001 §2.2 getCycleContext() contract.
 *
 * Results are cached in KV with a 1h TTL to avoid thrashing the Linear API
 * during the 6h alarm interval.
 */

import type { CycleContext } from './schemas.js'

export const CYCLE_CACHE_TTL_SECONDS = 60 * 60 // 1 hour
const CACHE_KEY_PREFIX = 'cycle-context:'

interface LinearCycle {
  id: string
  name: string
  startsAt: string
  endsAt: string
}

interface LinearCycleResponse {
  data?: {
    team?: {
      activeCycle?: LinearCycle
    }
  }
}

/**
 * Fetch the active cycle for a Linear team, with KV caching.
 *
 * - KV cache key: `cycle-context:{teamId}`, TTL 3600s
 * - `isCycleEnd` is true when fewer than 6 hours remain (0.25 days),
 *   ensuring the alarm always fires at least once within the `isCycleEnd`
 *   window given the 6h alarm cadence.
 * - `isLastTwoDays` is true when 0 ≤ daysRemaining ≤ 2.
 * - Returns null if no active cycle or on API failure (non-fatal).
 */
export async function getCycleContext(
  teamId: string,
  kv: KVNamespace,
  linearApiKey: string,
): Promise<CycleContext | null> {
  const cacheKey = `${CACHE_KEY_PREFIX}${teamId}`

  // Try KV cache first
  const cached = await kv.get(cacheKey, 'json') as CycleContext | null
  if (cached !== null) return cached

  // Fetch from Linear GraphQL
  try {
    const query = `
      query($teamId: String!) {
        team(id: $teamId) {
          activeCycle {
            id
            name
            startsAt
            endsAt
          }
        }
      }
    `
    const resp = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: linearApiKey,
      },
      body: JSON.stringify({ query, variables: { teamId } }),
    })

    if (!resp.ok) {
      console.warn(`[CycleAwarenessService] Linear API error ${resp.status} for team ${teamId}`)
      return null
    }

    const payload = (await resp.json()) as LinearCycleResponse
    const cycle = payload.data?.team?.activeCycle
    if (!cycle) return null

    const endDate = new Date(cycle.endsAt)
    const now = new Date()
    const msUntilEnd = endDate.getTime() - now.getTime()
    const daysRemaining = msUntilEnd / (1000 * 60 * 60 * 24)

    const ctx: CycleContext = {
      cycleId: cycle.id,
      cycleName: cycle.name,
      startDate: cycle.startsAt,
      endDate: cycle.endsAt,
      daysRemaining,
      // Within last 6 hours of the cycle (0.25 days = 6h — aligns with alarm cadence)
      isCycleEnd: daysRemaining >= 0 && daysRemaining < 0.25,
      // Advisory items are surfaced when 0 ≤ daysRemaining ≤ 2
      isLastTwoDays: daysRemaining >= 0 && daysRemaining <= 2,
      teamId,
    }

    // Cache for 1h — short enough to refresh after cycle boundaries
    await kv.put(cacheKey, JSON.stringify(ctx), { expirationTtl: CYCLE_CACHE_TTL_SECONDS })
    return ctx
  } catch (err) {
    console.warn('[CycleAwarenessService] Failed to fetch cycle context:', err)
    return null
  }
}

/**
 * Invalidate the KV cache for a team's cycle context.
 * Call this when a cycle transition is detected (e.g. at isCycleEnd) so the
 * next alarm interval picks up the fresh cycle immediately.
 */
export async function invalidateCycleCache(teamId: string, kv: KVNamespace): Promise<void> {
  await kv.delete(`${CACHE_KEY_PREFIX}${teamId}`)
}
