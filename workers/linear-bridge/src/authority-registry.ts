/**
 * @module authority-registry
 *
 * CF KV–backed AuthorityRegistry loader and accessor.
 *
 * Schema:
 *   KV key:   'authority-registry'
 *   KV value: JSON-serialized Record<linearUserId, AuthorityRecord>
 *
 * Bootstrap path: config/linear-authority.yaml → bootstrap script → BRIDGE_KV
 * Runtime read:   BRIDGE_KV.get('authority-registry') → JSON.parse → lookup
 */

import type { TokenScope } from '@factory/schemas/weops-disposition-token'
import type { DispositionVerb } from './types.js'
import { VERB_TO_SCOPE } from './types.js'

// ─── Authority Record ─────────────────────────────────────────────────────────

export interface AuthorityRecord {
  linearUserId: string
  linearUserName: string
  scopes: TokenScope[]
  addedAt: string         // ISO 8601
  addedBy: string         // Linear user ID of admin who added them
}

export type AuthorityRegistryData = Record<string, AuthorityRecord>

// ─── Check Result ────────────────────────────────────────────────────────────

export interface AuthorityCheckResult {
  permitted: boolean
  record?: AuthorityRecord
  requiredApprovals: number   // 1 for normal ops, 2 for override
  reason?: string
}

// ─── KV key ──────────────────────────────────────────────────────────────────

const KV_KEY = 'authority-registry'

// ─── Loader ───────────────────────────────────────────────────────────────────

/**
 * Loads the authority registry from KV.
 * Returns null if the registry has not been bootstrapped yet.
 */
export async function loadAuthorityRegistry(
  kv: KVNamespace,
): Promise<AuthorityRegistryData | null> {
  const raw = await kv.get(KV_KEY)
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      console.error('authority-registry: KV value is not an object')
      return null
    }
    return parsed as AuthorityRegistryData
  } catch (err) {
    console.error('authority-registry: failed to parse KV value:', err)
    return null
  }
}

// ─── Accessor ────────────────────────────────────────────────────────────────

/**
 * Checks whether a Linear user is authorized to perform a given disposition verb.
 *
 * @param kv            BRIDGE_KV namespace
 * @param linearUserId  Linear user ID of the commenter
 * @param verb          Disposition verb being checked
 */
export async function checkAuthority(
  kv: KVNamespace,
  linearUserId: string,
  verb: DispositionVerb,
): Promise<AuthorityCheckResult> {
  const registry = await loadAuthorityRegistry(kv)

  if (registry === null) {
    return {
      permitted: false,
      requiredApprovals: 1,
      reason: 'authority registry not initialized',
    }
  }

  const record = registry[linearUserId]
  if (record === undefined) {
    return {
      permitted: false,
      requiredApprovals: 1,
      reason: `user ${linearUserId} not in authority registry`,
    }
  }

  const requiredScope = VERB_TO_SCOPE[verb]
  if (!record.scopes.includes(requiredScope)) {
    return {
      permitted: false,
      record,
      requiredApprovals: 1,
      reason: `user ${linearUserId} lacks scope '${requiredScope}' for verb '${verb}'`,
    }
  }

  // Override requires two-person approval.
  const requiredApprovals = verb === 'override' ? 2 : 1

  return {
    permitted: true,
    record,
    requiredApprovals,
  }
}
