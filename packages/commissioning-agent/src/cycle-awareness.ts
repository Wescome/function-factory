/**
 * @factory/commissioning-agent — cycle-awareness
 *
 * Thin wrapper for fetching Linear cycle context.
 * Implements SPEC-FF-CYCLE-HEALTH-001 §2.2 getCycleContext() contract.
 *
 * Results are cached in KV with a 1h TTL to avoid thrashing the Linear API
 * during the 6h alarm interval.
 */

import type { CycleContext } from './schemas.js'

const CACHE_TTL_SECONDS = 60 * 60 // 1 hour
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
 * Returns null if no active cycle or on API failure.
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

  // Fetch from Linear
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
      console.warn(`[cycle-awareness] Linear API error ${resp.status}`)
      return null
    }

    const payload = (await resp.json()) as LinearCycleResponse
    const cycle = payload.data?.team?.activeCycle
    if (!cycle) return null

    const endDate = new Date(cycle.endsAt)
    const now = new Date()
    const msUntilEnd = endDate.getTime() - now.getTime()
    const daysUntilEnd = msUntilEnd / (1000 * 60 * 60 * 24)

    const ctx: CycleContext = {
      cycleId: cycle.id,
      cycleName: cycle.name,
      startDate: cycle.startsAt,
      endDate: cycle.endsAt,
      isLastTwoDays: daysUntilEnd >= 0 && daysUntilEnd <= 2,
      isCycleEnd: daysUntilEnd >= 0 && daysUntilEnd < 0.25, // within last 6 hours
      teamId,
    }

    // Cache for 1h
    await kv.put(cacheKey, JSON.stringify(ctx), { expirationTtl: CACHE_TTL_SECONDS })
    return ctx
  } catch (err) {
    console.warn('[cycle-awareness] Failed to fetch cycle context:', err)
    return null
  }
}
