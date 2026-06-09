/**
 * stable-stringify.ts — deterministic JSON serialization shared across the
 * formula compiler and seed assembly.
 *
 * Deterministic JSON.stringify. Sorts object keys alphabetically (recursing
 * into nested objects). Arrays preserve their order. NaN / Infinity → throw
 * (we never want those in compiled or seed output).
 */
export function stableStringify(value: unknown): string {
  if (value === null) return "null"
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`stableStringify: non-finite number ${value}`)
    }
    return JSON.stringify(value)
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    const parts: string[] = []
    for (const k of keys) {
      parts.push(`${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    }
    return `{${parts.join(",")}}`
  }
  // undefined / function / symbol — should never appear in compiled/seed output.
  throw new Error(`stableStringify: unsupported value type ${typeof value}`)
}
