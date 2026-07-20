/**
 * @module envelope-validator
 *
 * Validates inbound WGSP envelopes at the gateway boundary (I-EXT-01).
 *
 * Rules:
 *   1. envelope_schema_version must be "1.0.0".
 *   2. actor_type must be present and non-empty.
 *   3. purpose_id must start with "BCO-" (governance reference prefix).
 *
 * This is a structural / policy pre-check only.  Cryptographic signature
 * verification is handled separately by the WGSP envelope-signer module.
 */

export interface EnvelopeValidationResult {
  valid: boolean
  error?: string
}

/**
 * Validates the structural and policy invariants of an inbound WGSP envelope.
 *
 * @param body  Raw parsed JSON body from the Connect request.
 * @returns     `{ valid: true }` on success, `{ valid: false, error }` on failure.
 */
export function validateEnvelope(body: unknown): EnvelopeValidationResult {
  if (body === null || typeof body !== 'object') {
    return { valid: false, error: 'envelope must be a non-null object' }
  }

  const env = body as Record<string, unknown>

  // Rule 1: schema version
  if (env['envelope_schema_version'] !== '1.0.0') {
    return {
      valid: false,
      error: `envelope_schema_version must be "1.0.0", got: ${JSON.stringify(env['envelope_schema_version'])}`,
    }
  }

  // Rule 2: actor_type present and non-empty
  const actorType = env['actor_type']
  if (typeof actorType !== 'string' || actorType.trim().length === 0) {
    return { valid: false, error: 'actor_type must be a non-empty string' }
  }

  // Rule 3: purpose_id starts with "BCO-" (I-EXT-01)
  const purposeId = env['purpose_id']
  if (typeof purposeId !== 'string' || !purposeId.startsWith('BCO-')) {
    return {
      valid: false,
      error: `purpose_id must start with "BCO-", got: ${JSON.stringify(purposeId)}`,
    }
  }

  return { valid: true }
}
