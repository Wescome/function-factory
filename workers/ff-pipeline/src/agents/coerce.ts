/**
 * LLM output coercion — normalize common type mismatches from model responses.
 *
 * LLMs frequently return arrays where strings are expected (bullet points),
 * strings where arrays are expected ("item1, item2"), numbers as strings,
 * booleans as strings. Coerce instead of rejecting.
 */

export function coerceToString(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(String).join('. ')
  if (value === null || value === undefined) return ''
  return String(value)
}

export function coerceToArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') return value.split(',').map(s => s.trim()).filter(Boolean)
  if (value === null || value === undefined) return []
  return [value]
}

export function coerceToNumber(value: unknown): number {
  if (typeof value === 'number') return value
  const n = Number(value)
  return isNaN(n) ? 0 : n
}

export function coerceToBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.toLowerCase() === 'true' || value === '1'
  return Boolean(value)
}
