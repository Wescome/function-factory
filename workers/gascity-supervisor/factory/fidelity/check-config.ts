// Fidelity check-config loader.
//
// Loads the per-step-type check table that lives in CITY CONFIGURATION
// (IS-GC-FIDELITY-VALIDATION Q2, ADR-010 §3 ZFC) from fidelity-checks.toml. The
// validator carries no per-step-type judgment of its own; this is where that
// judgment lives, as data.
//
// Runtime-portable: the production Gas City container ships bun (see Dockerfile),
// whose Bun.TOML.parse is used when present. For the node-fallback dev path a
// minimal built-in parser covers the bounded [[check]] schema — no external
// dependency (the supervisor has zero runtime deps).
//
// Fail-closed: a malformed table, a bad gate_class, or a missing required field
// throws. The caller (cli.ts) treats a load failure as a molecule.failed event —
// it never proceeds to validate with an unusable check table.

import { readFileSync } from "node:fs"
import type { CheckConfig, CheckSpec, GateClass } from "./types.ts"

const GATE_CLASSES: readonly GateClass[] = ["preflight", "revision", "escalation", "abort"]

/** Load + parse + validate fidelity-checks.toml from a path. */
export function loadCheckConfig(path: string): CheckConfig {
  const raw = readFileSync(path, "utf8")
  return parseCheckConfig(raw)
}

/** Parse + validate a fidelity-checks.toml document string into a typed CheckConfig. */
export function parseCheckConfig(toml: string): CheckConfig {
  const parsed = parseToml(toml)
  const rawChecks = (parsed as { check?: unknown }).check
  if (rawChecks === undefined) return { check: [] }
  if (!Array.isArray(rawChecks)) {
    throw new Error("fidelity-checks: `check` must be an array of tables")
  }
  return { check: rawChecks.map((c, i) => validateCheck(c, i)) }
}

function validateCheck(value: unknown, index: number): CheckSpec {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`fidelity-checks: [[check]] #${index} is not a table`)
  }
  const c = value as Record<string, unknown>
  const step_pattern = requireString(c.step_pattern, index, "step_pattern")
  const check_id = requireString(c.check_id, index, "check_id")
  const remediation = requireString(c.remediation, index, "remediation")

  const gateRaw = requireString(c.gate_class, index, "gate_class")
  if (!GATE_CLASSES.includes(gateRaw as GateClass)) {
    throw new Error(
      `fidelity-checks: [[check]] #${index} (${check_id}) has invalid gate_class "${gateRaw}"; expected one of ${GATE_CLASSES.join(", ")}`,
    )
  }
  const gate_class = gateRaw as GateClass

  const cond = c.condition
  if (!cond || typeof cond !== "object" || Array.isArray(cond)) {
    throw new Error(`fidelity-checks: [[check]] #${index} (${check_id}) is missing a condition table`)
  }
  const condRec = cond as Record<string, unknown>
  const field = requireString(condRec.field, index, "condition.field")
  const predicate = requireString(condRec.predicate, index, "condition.predicate")

  return { step_pattern, check_id, gate_class, condition: { field, predicate }, remediation }
}

function requireString(value: unknown, index: number, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`fidelity-checks: [[check]] #${index} is missing required string field "${name}"`)
  }
  return value
}

// ---- TOML parsing ----

/** Parse a TOML document using the runtime's native parser when available. */
function parseToml(toml: string): Record<string, unknown> {
  const bunToml = (globalThis as { Bun?: { TOML?: { parse?: (s: string) => unknown } } }).Bun?.TOML
  if (bunToml?.parse) {
    return bunToml.parse(toml) as Record<string, unknown>
  }
  return parseMinimalToml(toml)
}

/**
 * Minimal TOML reader for the bounded fidelity-checks schema:
 *   - `[[check]]` array-of-tables headers
 *   - `key = "string"` assignments
 *   - one inline table: `condition = { field = "...", predicate = "..." }`
 *   - `#` line comments, blank lines
 * It deliberately supports nothing else; the schema is fixed and validated above.
 * Used only on the node-fallback dev path (production ships bun).
 */
function parseMinimalToml(toml: string): Record<string, unknown> {
  const checks: Record<string, unknown>[] = []
  let current: Record<string, unknown> | null = null

  for (const rawLine of toml.split("\n")) {
    const line = stripComment(rawLine).trim()
    if (line.length === 0) continue

    if (line === "[[check]]") {
      current = {}
      checks.push(current)
      continue
    }
    if (line.startsWith("[")) {
      throw new Error(`fidelity-checks: unsupported TOML table header "${line}"`)
    }

    const eq = line.indexOf("=")
    if (eq === -1) throw new Error(`fidelity-checks: malformed TOML line "${line}"`)
    if (!current) throw new Error(`fidelity-checks: assignment outside any [[check]] table: "${line}"`)

    const key = line.slice(0, eq).trim()
    const valueText = line.slice(eq + 1).trim()
    current[key] = parseValue(valueText)
  }

  return { check: checks }
}

function parseValue(text: string): unknown {
  if (text.startsWith("{") && text.endsWith("}")) {
    return parseInlineTable(text.slice(1, -1))
  }
  return parseScalar(text)
}

function parseInlineTable(inner: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const part of splitTopLevel(inner, ",")) {
    const trimmed = part.trim()
    if (trimmed.length === 0) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) throw new Error(`fidelity-checks: malformed inline-table entry "${trimmed}"`)
    out[trimmed.slice(0, eq).trim()] = parseScalar(trimmed.slice(eq + 1).trim())
  }
  return out
}

function parseScalar(text: string): unknown {
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return unescapeBasicString(text.slice(1, -1))
  }
  if (text === "true") return true
  if (text === "false") return false
  if (/^-?\d+$/.test(text)) return Number(text)
  // Bare/unsupported scalar — keep as a string so validation can reject it cleanly.
  return text
}

function unescapeBasicString(s: string): string {
  return s
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
}

/** Split on a delimiter, ignoring delimiters inside quoted strings. */
function splitTopLevel(text: string, delim: string): string[] {
  const parts: string[] = []
  let buf = ""
  let quote: string | null = null
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quote) {
      buf += ch
      if (ch === quote && text[i - 1] !== "\\") quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      buf += ch
      continue
    }
    if (ch === delim) {
      parts.push(buf)
      buf = ""
      continue
    }
    buf += ch
  }
  parts.push(buf)
  return parts
}

/** Strip a `#` line comment that is not inside a quoted string. */
function stripComment(line: string): string {
  let quote: string | null = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (quote) {
      if (ch === quote && line[i - 1] !== "\\") quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === "#") return line.slice(0, i)
  }
  return line
}
