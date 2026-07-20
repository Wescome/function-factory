import { createHash } from 'crypto';

/**
 * Compute the content-addressed bead_id.
 *
 * bead_id = SHA-256(type + canonical_json(content) + sorted_join(parent_ids))
 *
 * Guarantees:
 *   - Deterministic: same inputs always produce the same ID
 *   - Parent-order independent: sorted parent_ids before join
 */
export function computeBeadId(
  type: string,
  content: Record<string, unknown>,
  parentIds: string[]
): string {
  const canonical =
    type +
    JSON.stringify(content, Object.keys(content).sort()) +
    [...parentIds].sort().join('');
  return createHash('sha256').update(canonical).digest('hex');
}
