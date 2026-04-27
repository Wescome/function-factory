/**
 * @module artifact-validator
 *
 * SHACL-equivalent artifact validation for Function Factory.
 *
 * Enforces ontology constraints (factory-shapes.ttl) as pure TypeScript
 * validation functions. Runs before every ArangoDB persist — no network
 * calls, no side effects, pure in-memory validation.
 *
 * Constraints implemented:
 *   C1  — Lineage completeness (non-signal artifacts MUST have source_refs)
 *   C7  — CRP on low confidence (warning + crpRequired flag)
 *   C9  — Gate fail-closed (coverage reports MUST have boolean passed)
 *   C15 — No secrets (recursive scan of all string fields)
 */

// ── Public types ────────────────────────────────────────────────────

export interface Violation {
  constraint: string   // e.g., "C1-lineage", "C7-confidence", "C15-secrets"
  severity: 'violation' | 'warning' | 'info'
  message: string
  field?: string
}

export interface ValidationResult {
  valid: boolean
  violations: Violation[]
}

// ── Collections subject to lineage constraint (C1) ──────────────────

const LINEAGE_COLLECTIONS = new Set([
  'specs_pressures',
  'specs_capabilities',
  'specs_functions',
  'specs_workgraphs',
  'specs_coverage_reports',
])

// ── Secret patterns (C15) ───────────────────────────────────────────

const SECRET_PATTERNS: readonly string[] = [
  'sk-ant-',
  'sk-proj-',
  'GOCSPX-',
  'Bearer ey',
  'AKIA',
  '-----BEGIN RSA PRIVATE KEY',
  '-----BEGIN OPENSSH PRIVATE KEY',
  'ghp_',
  'glpat-',
  'xoxb-',
  'ya29.',
] as const

// ── Validator functions ─────────────────────────────────────────────

/**
 * C1 — Lineage completeness.
 *
 * Non-signal artifacts MUST have a non-empty source_refs or sourceRefs array.
 * Exempt collections: specs_signals, execution_artifacts, memory_*,
 * gate_status, agent_designs, lineage_edges, mentorscript_rules.
 */
function checkLineage(
  collection: string,
  doc: Record<string, unknown>,
): Violation[] {
  if (!LINEAGE_COLLECTIONS.has(collection)) return []

  // Accept either snake_case or camelCase — the codebase uses both
  const sourceRefs = doc.source_refs ?? doc.sourceRefs

  if (!Array.isArray(sourceRefs) || sourceRefs.length === 0) {
    return [{
      constraint: 'C1-lineage',
      severity: 'violation',
      message: `LINEAGE BREAK: ${collection} artifact must have non-empty source_refs. Every non-Signal artifact MUST derive from at least one upstream artifact.`,
      field: 'source_refs',
    }]
  }

  return []
}

/**
 * C7 — CRP escalation on low confidence.
 *
 * If the artifact has a confidence field < 0.7, emit a warning and
 * signal crpRequired. Does not block persist — the caller decides
 * whether to create a CRP.
 */
function checkConfidence(
  _collection: string,
  doc: Record<string, unknown>,
): { violations: Violation[]; crpRequired: boolean } {
  if (typeof doc.confidence !== 'number') {
    return { violations: [], crpRequired: false }
  }

  if (doc.confidence < 0.7) {
    return {
      violations: [{
        constraint: 'C7-confidence',
        severity: 'warning',
        message: `SILENT UNCERTAINTY: Artifact confidence ${doc.confidence} < 0.7. A Consultation Request Pack (CRP) should be created.`,
        field: 'confidence',
      }],
      crpRequired: true,
    }
  }

  return { violations: [], crpRequired: false }
}

/**
 * C9 — Gate fail-closed.
 *
 * CoverageReport artifacts MUST have a boolean `passed` field.
 * No ambiguity — explicit pass or fail required.
 */
function checkGateFailClosed(
  collection: string,
  doc: Record<string, unknown>,
): Violation[] {
  if (collection !== 'specs_coverage_reports') return []

  if (typeof doc.passed !== 'boolean') {
    return [{
      constraint: 'C9-gate-fail-closed',
      severity: 'violation',
      message: `AMBIGUOUS GATE: Coverage report must have an explicit boolean 'passed' field. Got: ${typeof doc.passed === 'undefined' ? 'missing' : typeof doc.passed}.`,
      field: 'passed',
    }]
  }

  return []
}

/**
 * C15 — No secrets.
 *
 * Recursively scan ALL string values in the document for known
 * secret patterns. Applies to every collection — secrets are never
 * acceptable in persistent artifacts.
 */
function checkNoSecrets(
  _collection: string,
  doc: Record<string, unknown>,
): Violation[] {
  const violations: Violation[] = []
  scanForSecrets(doc, '', violations)
  return violations
}

/**
 * Recursive depth-first scan of all string values in an object tree.
 * Handles nested objects, arrays, and mixed structures.
 */
function scanForSecrets(
  value: unknown,
  path: string,
  violations: Violation[],
): void {
  if (typeof value === 'string') {
    for (const pattern of SECRET_PATTERNS) {
      if (value.includes(pattern)) {
        violations.push({
          constraint: 'C15-secrets',
          severity: 'violation',
          message: `SECRET LEAK: Detected secret pattern "${pattern}" in field "${path || '<root>'}". Artifacts must not contain API keys, passwords, or tokens.`,
          field: path || undefined,
        })
        // One violation per field is enough — don't report every
        // pattern match in the same string
        return
      }
    }
  } else if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      scanForSecrets(value[i], path ? `${path}[${i}]` : `[${i}]`, violations)
    }
  } else if (value !== null && typeof value === 'object') {
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      scanForSecrets(val, path ? `${path}.${key}` : key, violations)
    }
  }
}

// ── Main export ─────────────────────────────────────────────────────

/**
 * Validate an artifact against all applicable SHACL-equivalent constraints.
 *
 * Runs the appropriate validators based on collection name. Pure function —
 * no network calls, no side effects.
 *
 * @param collection - ArangoDB collection name (e.g., "specs_pressures")
 * @param doc - The document to validate
 * @returns ValidationResult with optional crpRequired flag
 */
export function validateArtifact(
  collection: string,
  doc: Record<string, unknown>,
): ValidationResult & { crpRequired?: boolean } {
  const violations: Violation[] = []
  let crpRequired = false

  // C1 — Lineage
  violations.push(...checkLineage(collection, doc))

  // C7 — Confidence / CRP escalation
  const c7 = checkConfidence(collection, doc)
  violations.push(...c7.violations)
  if (c7.crpRequired) crpRequired = true

  // C9 — Gate fail-closed
  violations.push(...checkGateFailClosed(collection, doc))

  // C15 — No secrets (universal)
  violations.push(...checkNoSecrets(collection, doc))

  // valid = no violations with severity 'violation'
  const hasViolation = violations.some((v) => v.severity === 'violation')

  return {
    valid: !hasViolation,
    violations,
    ...(crpRequired ? { crpRequired } : {}),
  }
}
