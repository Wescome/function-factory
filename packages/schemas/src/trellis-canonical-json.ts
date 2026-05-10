import { createHash } from "node:crypto"

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

const ARRAY_SORT_KEYS: Record<string, readonly string[]> = {
  source_refs: ["$"],
  roles: ["roleId"],
  nodes: ["roleId"],
  edges: ["from", "to", "reason"],
  bindings: ["bindingId"],
  requiredEvidence: ["evidenceId"],
  failureClasses: ["code"],
  sourceCoverage: ["sourceRef", "sourceField"],
  unmappedExecutableRefs: ["$"],
  policyWarnings: ["$"],
  deterministicInputs: ["$"],
  uncertaintyRefs: ["$"],
  diagnostics: ["code", "message"],
  uncertaintyEntries: ["$"],
}

export function canonicalizeForTrellisHash(value: unknown): JsonValue {
  return canonicalize(value, undefined, [])
}

export function canonicalTrellisJson(value: unknown): string {
  return JSON.stringify(canonicalizeForTrellisHash(value))
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

export function trellisContentHash(value: unknown): string {
  return sha256Hex(canonicalTrellisJson(value))
}

function canonicalize(value: unknown, propertyName: string | undefined, path: readonly string[]): JsonValue {
  if (value === null) return null
  if (typeof value === "string") return value.normalize("NFC")
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "boolean") return value
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalize(item, propertyName, path))
    return sortArray(propertyName, items)
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>
    const out: Record<string, JsonValue> = {}
    for (const key of Object.keys(record).sort()) {
      if (shouldOmitForPacketHash(path, key)) continue
      const item = record[key]
      if (item === undefined) continue
      out[key] = canonicalize(item, key, [...path, key])
    }
    return out
  }
  return null
}

function shouldOmitForPacketHash(path: readonly string[], key: string): boolean {
  if (path.length === 1 && path[0] === "audit" && key === "packetHash") return true
  if (path.length === 1 && path[0] === "instructionTuning" && key === "outputPacketHash") return true
  if (path.length === 1 && path[0] === "instructionTuning" && key === "generatedAt") return true
  return false
}

function sortArray(propertyName: string | undefined, items: JsonValue[]): JsonValue[] {
  const keys = propertyName ? ARRAY_SORT_KEYS[propertyName] : undefined
  if (!keys) return items

  return [...items].sort((left, right) => {
    const leftKey = sortKey(left, keys)
    const rightKey = sortKey(right, keys)
    return leftKey.localeCompare(rightKey)
  })
}

function sortKey(value: JsonValue, keys: readonly string[]): string {
  if (keys.length === 1 && keys[0] === "$") {
    return typeof value === "string" ? value : JSON.stringify(value)
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return JSON.stringify(value)
  }
  return keys.map((key) => String(value[key] ?? "")).join("\u0000")
}
