/**
 * ADR-007 Phase 1: Output Reliability Layer (ORL)
 *
 * Unified module that replaces 7 duplicated extractAndParseJSON functions
 * and 6 hand-coded validators with a single schema-driven pipeline:
 *
 *   Guard -> Parse -> Detect Tool Calls -> Validate -> Coerce -> Repair
 *
 * Handles all 7 failure classes from ADR-007:
 *   F1: Prose instead of JSON
 *   F2: Truncated JSON
 *   F3: Wrong field names
 *   F4: Wrong field types
 *   F5: JSON in markdown fences
 *   F6: Tool calls as text
 *   F7: Null/undefined response
 */

import { coerceToString, coerceToArray, coerceToNumber, coerceToBoolean } from './coerce'
import { detectTextToolCalls } from './workers-ai-stream'

// ── Types ──────────────────────────────────────────────────────

export interface ORLResult<T> {
  success: boolean
  data: T | null
  failureMode: string | null  // F1-F7 classification
  rawResponse: string
  repairAttempts: number
  coercions: string[]  // list of coerced field names
}

export interface OutputSchema<T> {
  name: string  // e.g., 'BriefingScript', 'Verdict', 'Plan'
  requiredFields: string[]
  fieldTypes: Record<string, 'string' | 'number' | 'boolean' | 'array' | 'object'>
  fieldAliases?: Record<string, string[]>  // e.g., { title: ['name', 'function_name'] }
  enumFields?: Record<string, string[]>  // e.g., { decision: ['pass','fail','patch'] }
  defaults?: Record<string, unknown>  // e.g., { executorRecommendation: 'gdk-agent' }
  coerce?: boolean  // default true
  /**
   * Custom post-coercion hook for schema-specific logic that cannot be
   * expressed through the declarative schema (e.g., CodeArtifact action aliases,
   * Verdict confidence clamping). Mutates data in place.
   */
  postCoerce?: (data: Record<string, unknown>, coercions: string[]) => void
}

// ── extractJSON (5-tier, replaces 7 copies) ────────────────────

/**
 * 5-tier JSON extraction from raw LLM text.
 *
 * Tier 1: Direct JSON.parse
 * Tier 2: Strip markdown fences (```json...```)
 * Tier 3: Brace extraction (first { to last })
 * Tier 4: Array extraction (first [ to last ])
 * Tier 5: (reserved for truncation repair — not implemented in Phase 1)
 *
 * Returns { json, tier } or null if nothing parseable found.
 */
export function extractJSON(text: string): { json: unknown; tier: number } | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  // Tier 1: Direct parse
  try { return { json: JSON.parse(trimmed), tier: 1 } } catch { /* continue */ }

  // Tier 2: Strip markdown fences
  const fenceMatch = /```\w*\s*?\n?([\s\S]*?)(?:\n\s*)?```/.exec(trimmed)
  if (fenceMatch) {
    try { return { json: JSON.parse(fenceMatch[1]!.trim()), tier: 2 } } catch { /* continue */ }
  }

  // Tier 3: First { to last }
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try { return { json: JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)), tier: 3 } } catch { /* continue */ }
  }

  // Tier 4: First [ to last ]
  const firstBracket = trimmed.indexOf('[')
  const lastBracket = trimmed.lastIndexOf(']')
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    try { return { json: JSON.parse(trimmed.slice(firstBracket, lastBracket + 1)), tier: 4 } } catch { /* continue */ }
  }

  return null
}

// ── Validate ───────────────────────────────────────────────────

/**
 * Check that parsed JSON matches the schema's required fields.
 * When coerce is disabled, also checks that field types match.
 * Returns list of field names with validation errors.
 */
function validateRequiredFields(
  data: Record<string, unknown>,
  schema: OutputSchema<any>,
): string[] {
  const errors: string[] = []
  const shouldCoerce = schema.coerce !== false

  for (const field of schema.requiredFields) {
    if (!(field in data) || data[field] === undefined) {
      errors.push(field)
      continue
    }
    // When coerce is disabled, check types strictly
    if (!shouldCoerce && field in schema.fieldTypes) {
      const expectedType = schema.fieldTypes[field]
      const value = data[field]
      let typeMatch = true
      switch (expectedType) {
        case 'string': typeMatch = typeof value === 'string'; break
        case 'number': typeMatch = typeof value === 'number'; break
        case 'boolean': typeMatch = typeof value === 'boolean'; break
        case 'array': typeMatch = Array.isArray(value); break
        case 'object': typeMatch = typeof value === 'object' && value !== null && !Array.isArray(value); break
      }
      if (!typeMatch) {
        errors.push(field)
      }
    }
  }
  return errors
}

// ── Coerce ─────────────────────────────────────────────────────

/**
 * Apply type coercion based on schema field types.
 * Returns list of field names that were coerced.
 */
function coerceFields(
  data: Record<string, unknown>,
  schema: OutputSchema<any>,
): string[] {
  const coerced: string[] = []

  for (const [field, expectedType] of Object.entries(schema.fieldTypes)) {
    if (!(field in data)) continue
    const value = data[field]

    switch (expectedType) {
      case 'string':
        if (typeof value !== 'string') {
          data[field] = coerceToString(value)
          coerced.push(field)
        }
        break
      case 'array':
        if (!Array.isArray(value)) {
          data[field] = coerceToArray(value)
          coerced.push(field)
        }
        break
      case 'number':
        if (typeof value !== 'number') {
          data[field] = coerceToNumber(value)
          coerced.push(field)
        }
        break
      case 'boolean':
        if (typeof value !== 'boolean') {
          data[field] = coerceToBoolean(value)
          coerced.push(field)
        }
        break
      // 'object' — no coercion, just pass through
    }
  }

  return coerced
}

/**
 * Resolve field aliases: if a required field is missing but an alias exists,
 * copy the alias value to the canonical field name.
 */
function resolveAliases(
  data: Record<string, unknown>,
  schema: OutputSchema<any>,
): void {
  if (!schema.fieldAliases) return

  for (const [canonical, aliases] of Object.entries(schema.fieldAliases)) {
    if (canonical in data && data[canonical] !== undefined) continue
    for (const alias of aliases) {
      if (alias in data && data[alias] !== undefined) {
        data[canonical] = data[alias]
        break
      }
    }
  }
}

/**
 * Apply enum validation: if a field value is not in the allowed enum list,
 * replace it with the default (if provided) or leave it.
 */
function enforceEnums(
  data: Record<string, unknown>,
  schema: OutputSchema<any>,
): void {
  if (!schema.enumFields) return

  for (const [field, allowed] of Object.entries(schema.enumFields)) {
    if (!(field in data)) continue
    const value = data[field]
    if (typeof value === 'string' && !allowed.includes(value)) {
      if (schema.defaults && field in schema.defaults) {
        data[field] = schema.defaults[field]
      }
    }
  }
}

/**
 * Apply defaults for empty string fields.
 */
function applyDefaults(
  data: Record<string, unknown>,
  schema: OutputSchema<any>,
): void {
  if (!schema.defaults) return

  for (const [field, defaultValue] of Object.entries(schema.defaults)) {
    if (!(field in data)) continue
    const value = data[field]
    // Apply default when value is empty string (common LLM output)
    if (value === '' || value === undefined || value === null) {
      data[field] = defaultValue
    }
  }
}

// ── Classify Failure ───────────────────────────────────────────

/**
 * Classify the failure mode from a raw response that could not be parsed.
 */
function classifyParseFailure(raw: string): string {
  const trimmed = raw.trim()
  // F2: looks like it starts with JSON but is truncated
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return 'F2'  // truncated JSON
  }
  // F1: prose response with no JSON structure
  return 'F1'
}

// ── Pipeline Entry Point ───────────────────────────────────────

/**
 * Process raw LLM output through the 6-stage ORL pipeline.
 *
 * Pure function (no side effects except repairFn calls).
 *
 * @param rawResponse - Raw text from the LLM
 * @param schema - Declarative schema describing expected output shape
 * @param opts - Optional: availableTools, maxRepairAttempts, repairFn
 */
export async function processAgentOutput<T>(
  rawResponse: string,
  schema: OutputSchema<T>,
  opts?: {
    availableTools?: string[]
    maxRepairAttempts?: number
    repairFn?: (error: string, schemaDescription: string) => Promise<string>
    /** ADR-008: Hot-reloadable alias overrides from ArangoDB. Merged with schema defaults (overrides win). */
    aliasOverrides?: Record<string, string[]>
  },
): Promise<ORLResult<T>> {
  const raw = rawResponse ?? ''
  const maxRepairAttempts = opts?.maxRepairAttempts ?? 2
  let repairAttempts = 0

  // ADR-008: Merge hot-loaded alias overrides with schema defaults
  const effectiveSchema: OutputSchema<T> = opts?.aliasOverrides
    ? {
        ...schema,
        fieldAliases: {
          ...schema.fieldAliases,
          ...opts.aliasOverrides,  // DB overrides win
        },
      }
    : schema

  // ── Stage 1: Guard (F7) ──────────────────────────────────
  if (!raw || !raw.trim()) {
    // F7: null/empty response
    if (opts?.repairFn) {
      // Attempt repair for empty response
      const repairResult = await attemptRepair(
        raw,
        effectiveSchema,
        ['Response was null or empty'],
        opts.repairFn,
        maxRepairAttempts,
      )
      if (repairResult.success) {
        return {
          success: true,
          data: repairResult.data as T,
          failureMode: null,
          rawResponse: raw,
          repairAttempts: repairResult.repairAttempts,
          coercions: repairResult.coercions,
        }
      }
      return {
        success: false,
        data: null,
        failureMode: 'F7',
        rawResponse: raw,
        repairAttempts: repairResult.repairAttempts,
        coercions: [],
      }
    }
    return {
      success: false,
      data: null,
      failureMode: 'F7',
      rawResponse: raw,
      repairAttempts: 0,
      coercions: [],
    }
  }

  // ── Stage 2: Parse ───────────────────────────────────────
  const parseResult = extractJSON(raw)

  if (!parseResult) {
    // Parse failed — attempt repair or classify failure
    const failureMode = classifyParseFailure(raw)
    if (opts?.repairFn) {
      const repairResult = await attemptRepair(
        raw,
        effectiveSchema,
        [`Could not extract JSON from response (${failureMode})`],
        opts.repairFn,
        maxRepairAttempts,
      )
      if (repairResult.success) {
        return {
          success: true,
          data: repairResult.data as T,
          failureMode: null,
          rawResponse: raw,
          repairAttempts: repairResult.repairAttempts,
          coercions: repairResult.coercions,
        }
      }
      return {
        success: false,
        data: null,
        failureMode,
        rawResponse: raw,
        repairAttempts: repairResult.repairAttempts,
        coercions: [],
      }
    }
    return {
      success: false,
      data: null,
      failureMode,
      rawResponse: raw,
      repairAttempts: 0,
      coercions: [],
    }
  }

  const parsed = parseResult.json

  // ── Stage 3: Detect Tool Calls (F6) ──────────────────────
  if (opts?.availableTools && opts.availableTools.length > 0 && typeof parsed === 'object' && parsed !== null) {
    const toolCalls = detectTextToolCalls(
      typeof parsed === 'string' ? parsed : JSON.stringify(parsed),
      opts.availableTools,
    )
    // Also try on the raw text directly
    const rawToolCalls = detectTextToolCalls(raw, opts.availableTools)
    const foundToolCalls = toolCalls ?? rawToolCalls
    if (foundToolCalls && foundToolCalls.length > 0) {
      return {
        success: true,
        data: { toolCalls: foundToolCalls } as unknown as T,
        failureMode: 'F6',
        rawResponse: raw,
        repairAttempts: 0,
        coercions: [],
      }
    }
  }

  // ── Stage 4 & 5: Validate + Coerce ──────────────────────
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    // Parsed something but it's not an object — wrong shape
    if (opts?.repairFn) {
      const repairResult = await attemptRepair(
        raw,
        effectiveSchema,
        ['Parsed response is not a JSON object'],
        opts.repairFn,
        maxRepairAttempts,
      )
      if (repairResult.success) {
        return {
          success: true,
          data: repairResult.data as T,
          failureMode: null,
          rawResponse: raw,
          repairAttempts: repairResult.repairAttempts,
          coercions: repairResult.coercions,
        }
      }
    }
    return {
      success: false,
      data: null,
      failureMode: 'F3',
      rawResponse: raw,
      repairAttempts,
      coercions: [],
    }
  }

  const data = { ...parsed } as Record<string, unknown>
  return validateAndCoerce(data, effectiveSchema, raw, opts)
}

/**
 * Validate and coerce a parsed object against the schema.
 * Shared by both the initial pipeline and repair attempts.
 */
async function validateAndCoerce<T>(
  data: Record<string, unknown>,
  schema: OutputSchema<T>,
  rawResponse: string,
  opts?: {
    availableTools?: string[]
    maxRepairAttempts?: number
    repairFn?: (error: string, schemaDescription: string) => Promise<string>
  },
): Promise<ORLResult<T>> {
  const shouldCoerce = schema.coerce !== false
  const maxRepairAttempts = opts?.maxRepairAttempts ?? 2

  // Resolve field aliases before validation
  resolveAliases(data, schema)

  // Coerce types if enabled (before validation, so coerced fields pass)
  const coercions: string[] = shouldCoerce ? coerceFields(data, schema) : []

  // Apply enum constraints
  enforceEnums(data, schema)

  // Apply defaults for empty values
  applyDefaults(data, schema)

  // Run custom post-coercion hook if present
  if (schema.postCoerce) {
    schema.postCoerce(data, coercions)
  }

  // Validate required fields
  const missing = validateRequiredFields(data, schema)

  if (missing.length > 0) {
    // Validation failed — try repair
    if (opts?.repairFn) {
      const errors = missing.map(f => `Missing required field: "${f}"`)
      const repairResult = await attemptRepair(
        rawResponse,
        schema,
        errors,
        opts.repairFn,
        maxRepairAttempts,
      )
      if (repairResult.success) {
        return {
          success: true,
          data: repairResult.data as T,
          failureMode: null,
          rawResponse,
          repairAttempts: repairResult.repairAttempts,
          coercions: repairResult.coercions,
        }
      }
      return {
        success: false,
        data: null,
        failureMode: 'F3',
        rawResponse,
        repairAttempts: repairResult.repairAttempts,
        coercions,
      }
    }
    return {
      success: false,
      data: null,
      failureMode: 'F3',
      rawResponse,
      repairAttempts: 0,
      coercions,
    }
  }

  // Success
  return {
    success: true,
    data: data as unknown as T,
    failureMode: null,
    rawResponse,
    repairAttempts: 0,
    coercions,
  }
}

// ── Repair Loop ────────────────────────────────────────────────

interface RepairResult {
  success: boolean
  data: unknown
  repairAttempts: number
  coercions: string[]
}

/**
 * Attempt to repair a failed parse/validation by calling repairFn.
 * Pipes repair responses back through stages 2-5.
 */
async function attemptRepair<T>(
  originalRaw: string,
  schema: OutputSchema<T>,
  errors: string[],
  repairFn: (error: string, schemaDescription: string) => Promise<string>,
  maxAttempts: number,
): Promise<RepairResult> {
  const schemaDescription = buildSchemaDescription(schema)

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const errorMsg = `[${schema.name}] Errors: ${errors.join('; ')}\nOriginal response (first 500 chars): ${originalRaw.slice(0, 500)}`

    try {
      const repairResponse = await repairFn(errorMsg, schemaDescription)

      // Parse the repair response through stages 2-5
      const parseResult = extractJSON(repairResponse)
      if (!parseResult) continue

      const parsed = parseResult.json
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue

      const data = { ...parsed } as Record<string, unknown>
      const shouldCoerce = schema.coerce !== false

      resolveAliases(data, schema)
      const coercions: string[] = shouldCoerce ? coerceFields(data, schema) : []
      enforceEnums(data, schema)
      applyDefaults(data, schema)
      if (schema.postCoerce) {
        schema.postCoerce(data, coercions)
      }

      const missing = validateRequiredFields(data, schema)
      if (missing.length === 0) {
        return {
          success: true,
          data,
          repairAttempts: attempt,
          coercions,
        }
      }
      // Update errors for next attempt
      errors = missing.map(f => `Missing required field: "${f}"`)
    } catch {
      // repairFn threw — count the attempt and continue
    }
  }

  return {
    success: false,
    data: null,
    repairAttempts: maxAttempts,
    coercions: [],
  }
}

function buildSchemaDescription<T>(schema: OutputSchema<T>): string {
  const lines = [`Schema: ${schema.name}`]
  lines.push(`Required fields: ${schema.requiredFields.join(', ')}`)
  lines.push(`Field types: ${JSON.stringify(schema.fieldTypes)}`)
  if (schema.enumFields) {
    lines.push(`Enum fields: ${JSON.stringify(schema.enumFields)}`)
  }
  return lines.join('\n')
}

// ── Agent Schemas ──────────────────────────────────────────────

import type { BriefingScript } from './architect-agent'
import type { Plan, CodeArtifact, CritiqueReport, TestReport, Verdict } from '../coordinator/state'
import type { SemanticReviewResult } from '../types'

export const BRIEFING_SCRIPT_SCHEMA: OutputSchema<BriefingScript> = {
  name: 'BriefingScript',
  requiredFields: ['goal', 'successCriteria', 'architecturalContext', 'strategicAdvice', 'knownGotchas', 'validationLoop'],
  fieldTypes: {
    goal: 'string',
    successCriteria: 'array',
    architecturalContext: 'string',
    strategicAdvice: 'string',
    knownGotchas: 'array',
    validationLoop: 'string',
  },
  fieldAliases: {
    goal: ['objective', 'target', 'aim', 'purpose', 'primary_objective', 'main_goal'],
    successCriteria: ['criteria', 'success_criteria', 'acceptance_criteria', 'conditions', 'success_conditions'],
    architecturalContext: ['context', 'arch_context', 'background', 'architectural_context', 'architecture'],
    strategicAdvice: ['advice', 'strategy', 'recommendations', 'strategic_advice', 'guidance', 'strategic_guidance'],
    knownGotchas: ['gotchas', 'risks', 'pitfalls', 'known_issues', 'known_gotchas', 'warnings', 'caveats'],
    validationLoop: ['validation', 'test_plan', 'verification', 'validation_loop', 'how_to_validate'],
  },
  coerce: true,
}

export const PLAN_SCHEMA: OutputSchema<Plan> = {
  name: 'Plan',
  requiredFields: ['approach', 'atoms', 'executorRecommendation', 'estimatedComplexity'],
  fieldTypes: {
    approach: 'string',
    atoms: 'array',
    executorRecommendation: 'string',
    estimatedComplexity: 'string',
  },
  fieldAliases: {
    approach: ['strategy', 'plan', 'implementation_plan', 'implementation_approach', 'overview'],
    atoms: ['steps', 'tasks', 'work_items', 'items', 'components'],
    executorRecommendation: ['executor', 'executor_recommendation', 'recommended_executor', 'runtime'],
    estimatedComplexity: ['complexity', 'estimated_complexity', 'difficulty', 'effort'],
  },
  defaults: {
    executorRecommendation: 'gdk-agent',
    estimatedComplexity: 'medium',
  },
  coerce: true,
}

/** Action aliases used by LLMs instead of the canonical create/modify/delete */
const CODE_ACTION_MAP: Record<string, string> = {
  add: 'create', new: 'create', write: 'create',
  update: 'modify', edit: 'modify', change: 'modify', patch: 'modify',
  remove: 'delete', del: 'delete',
}

export const CODE_ARTIFACT_SCHEMA: OutputSchema<CodeArtifact> = {
  name: 'CodeArtifact',
  requiredFields: ['files', 'summary', 'testsIncluded'],
  fieldTypes: {
    files: 'array',
    summary: 'string',
    testsIncluded: 'boolean',
  },
  coerce: true,
  postCoerce(data, coercions) {
    // Coerce individual file entries
    const files = data.files
    if (Array.isArray(files)) {
      for (const file of files as Record<string, unknown>[]) {
        if (typeof file !== 'object' || file === null) continue
        if (typeof file.path !== 'string') file.path = coerceToString(file.path)
        if (typeof file.content !== 'string') file.content = coerceToString(file.content)
        const rawAction = coerceToString(file.action).toLowerCase()
        file.action = CODE_ACTION_MAP[rawAction] ?? (rawAction || 'create')
      }
    }
  },
}

export const SEMANTIC_REVIEW_SCHEMA: OutputSchema<SemanticReviewResult> = {
  name: 'SemanticReview',
  requiredFields: ['alignment', 'confidence', 'citations', 'rationale', 'timestamp'],
  fieldTypes: {
    alignment: 'string',
    confidence: 'number',
    citations: 'array',
    rationale: 'string',
    timestamp: 'string',
  },
  fieldAliases: {
    alignment: ['result', 'assessment', 'status', 'verdict'],
    confidence: ['score', 'confidence_score', 'certainty'],
    citations: ['references', 'sources', 'evidence', 'refs'],
    rationale: ['reasoning', 'explanation', 'justification', 'reason'],
    timestamp: ['time', 'date', 'created_at', 'createdAt'],
  },
  enumFields: { alignment: ['aligned', 'miscast', 'uncertain'] },
  defaults: { alignment: 'uncertain', timestamp: new Date().toISOString() },
  coerce: true,
  postCoerce(data) {
    // Clamp confidence to [0, 1]
    if (typeof data.confidence === 'number') {
      if (data.confidence < 0 || data.confidence > 1) data.confidence = 0.5
    }
    // Provide timestamp default if empty
    if (!data.timestamp) data.timestamp = new Date().toISOString()
  },
}

export const CRITIQUE_REPORT_SCHEMA: OutputSchema<CritiqueReport> = {
  name: 'CritiqueReport',
  requiredFields: ['passed', 'issues', 'mentorRuleCompliance', 'overallAssessment'],
  fieldTypes: {
    passed: 'boolean',
    issues: 'array',
    mentorRuleCompliance: 'array',
    overallAssessment: 'string',
  },
  fieldAliases: {
    passed: ['pass', 'approved', 'ok', 'is_passed'],
    issues: ['problems', 'findings', 'defects', 'bugs'],
    mentorRuleCompliance: ['mentor_rule_compliance', 'ruleCompliance', 'rule_compliance', 'rules'],
    overallAssessment: ['overall_assessment', 'assessment', 'summary', 'conclusion'],
  },
  coerce: true,
  postCoerce(data) {
    // Coerce individual issue entries
    const issues = data.issues
    if (Array.isArray(issues)) {
      for (const issue of issues as Record<string, unknown>[]) {
        if (typeof issue !== 'object' || issue === null) continue
        if (typeof issue.severity !== 'string') issue.severity = coerceToString(issue.severity)
        if (!['critical', 'major', 'minor'].includes(issue.severity as string)) issue.severity = 'minor'
        if (typeof issue.description !== 'string') issue.description = coerceToString(issue.description)
      }
    }
  },
}

export const TEST_REPORT_SCHEMA: OutputSchema<TestReport> = {
  name: 'TestReport',
  requiredFields: ['passed', 'testsRun', 'testsPassed', 'testsFailed', 'failures', 'summary'],
  fieldTypes: {
    passed: 'boolean',
    testsRun: 'number',
    testsPassed: 'number',
    testsFailed: 'number',
    failures: 'array',
    summary: 'string',
  },
  fieldAliases: {
    passed: ['pass', 'success', 'ok', 'all_passed'],
    testsRun: ['tests_run', 'total', 'total_tests', 'test_count'],
    testsPassed: ['tests_passed', 'passed_count', 'successes'],
    testsFailed: ['tests_failed', 'failed_count', 'failure_count'],
    failures: ['failed_tests', 'errors', 'test_failures'],
    summary: ['assessment', 'overview', 'conclusion', 'report'],
  },
  coerce: true,
}

export const VERDICT_SCHEMA: OutputSchema<Verdict> = {
  name: 'Verdict',
  requiredFields: ['decision', 'confidence', 'reason'],
  fieldTypes: {
    decision: 'string',
    confidence: 'number',
    reason: 'string',
    notes: 'string',
  },
  fieldAliases: {
    decision: ['verdict', 'result', 'status', 'outcome'],
    confidence: ['score', 'confidence_score', 'certainty'],
    reason: ['reasoning', 'explanation', 'justification', 'rationale'],
    notes: ['repair_notes', 'feedback', 'details', 'guidance'],
  },
  enumFields: { decision: ['pass', 'fail', 'patch', 'resample', 'interrupt'] },
  defaults: { decision: 'interrupt' },
  coerce: true,
  postCoerce(data) {
    // Clamp confidence to [0, 1]
    if (typeof data.confidence === 'number') {
      if (data.confidence < 0 || data.confidence > 1) data.confidence = 0.5
    }
  },
}
