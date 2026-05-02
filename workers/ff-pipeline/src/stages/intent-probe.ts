/**
 * IntentProbe Phase 2: Isolated post-generation verification.
 *
 * CRITICAL DESIGN DECISIONS (from IntrospectiveHarness):
 *
 * 1. ISOLATION: The probe is a SEPARATE LLM call from generation.
 *    Different CONTEXT is mandatory. If the probe runs in the same
 *    context as generation, it will be cued by the same circuit.
 *
 * 2. NO COMPILATION CONTEXT: The probe sees ONLY the pass output
 *    and the probe questions. NOT the compilation prompt, NOT the
 *    signal, NOT accumulated state.
 *
 * 3. BINARY QUESTIONS ONLY: yes/no. State-tracking task (high
 *    reliability), not conceptual reasoning (low reliability).
 *
 * 4. BATCHED: All anchors go in one call for efficiency.
 *
 * Routes through callModel with TaskKind 'probe' for extractJSON
 * fallback, hot-config model override, and ORL telemetry.
 *
 * Adapted from IntrospectiveHarness probe-engine.ts.
 * Traces to: DESIGN-CRYSTALLIZER.md Section 2, Review Resolutions C2+C3+SE-4
 */

import type { IntentAnchor } from './crystallize-intent'
import type { PipelineEnv } from '../types'
import { callModel } from '../model-bridge'

// Re-export ProbeResult from the gate module (single source of truth)
export type { ProbeResult } from './reconciliation-gate'
import type { ProbeResult } from './reconciliation-gate'

// ── Constants ──────────────────────────────────────────────────

/**
 * SE-4: Maximum token estimate for pass output before truncation.
 * llama-70b has 8K context. 4K tokens for output leaves room for
 * system prompt + questions. Rough estimate: 1 token ~ 4 chars.
 */
const MAX_OUTPUT_TOKENS = 4000
const CHARS_PER_TOKEN = 4
const MAX_OUTPUT_CHARS = MAX_OUTPUT_TOKENS * CHARS_PER_TOKEN // 16,000

const PROBE_SYSTEM_PROMPT = `You are a specification fidelity evaluator. You will receive a text and a set of yes/no questions about that text. For each question, answer ONLY "yes" or "no". Respond as JSON: {"1": "yes"|"no", "2": "yes"|"no", ...}`

// ── Main Function ──────────────────────────────────────────────

/**
 * Probe a compilation pass's output against a set of intent anchors.
 *
 * The call is ARCHITECTURALLY ISOLATED:
 * - Separate LLM invocation via callModel('probe', ...)
 * - Different system prompt ("you are an evaluator")
 * - NO compilation prompt, signal, or accumulated state — only output + questions
 *
 * @param passOutput - JSON stringified DELTA from this pass only (C2)
 * @param anchors - IntentAnchors from Phase 1 crystallization
 * @param env - Pipeline environment
 * @param dryRun - If true, return all-pass results without LLM call
 * @returns ProbeResult[] — one per anchor
 */
export async function probeAnchors(
  passOutput: string,
  anchors: IntentAnchor[],
  env: PipelineEnv,
  dryRun: boolean,
): Promise<ProbeResult[]> {
  if (anchors.length === 0) return []

  // Dry-run: return all-pass results without LLM call
  if (dryRun) {
    return anchors.map(anchor => ({
      anchor_id: anchor.id,
      answer: anchor.violation_signal === 'yes' ? 'no' : 'yes' as 'yes' | 'no',
      is_violation: false,
      pass_name: 'dry-run',
      timestamp: new Date().toISOString(),
    }))
  }

  // SE-4: Truncate pass output if too large
  let truncatedOutput = passOutput
  if (passOutput.length > MAX_OUTPUT_CHARS) {
    truncatedOutput = truncatePassOutput(passOutput, MAX_OUTPUT_CHARS)
    console.warn(
      `[SIGNAL] pipeline:probe-input-truncated: ` +
      `pass output ${passOutput.length} chars truncated to ${truncatedOutput.length} chars ` +
      `(${MAX_OUTPUT_TOKENS} token limit)`,
    )
  }

  // Build the batched probe prompt
  const questionLines = anchors.map(
    (anchor, idx) => `${idx + 1}. ${anchor.probe_question}`,
  )

  const userMessage = [
    `TEXT TO EVALUATE:`,
    `"""`,
    truncatedOutput,
    `"""`,
    ``,
    `QUESTIONS:`,
    ...questionLines,
    ``,
    `Respond as JSON: {"1": "yes"|"no", ...}`,
  ].join('\n')

  try {
    const rawResponse = await callModel('probe', PROBE_SYSTEM_PROMPT, userMessage, env)

    // Parse the response
    const parsed = parseProbeResponse(rawResponse, anchors.length)

    // Convert to ProbeResults
    return anchors.map((anchor, idx) => {
      const key = String(idx + 1)
      const answer = normalizeAnswer(parsed[key])

      return {
        anchor_id: anchor.id,
        answer,
        is_violation:
          (anchor.violation_signal === 'yes' && answer === 'yes') ||
          (anchor.violation_signal === 'no' && answer === 'no'),
        pass_name: 'probe',
        timestamp: new Date().toISOString(),
      }
    })
  } catch (error) {
    // Fail-safe: on error, treat block-severity anchors as violated.
    // This ensures probe failures don't silently pass bad outputs.
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[SIGNAL] pipeline:probe-failure: ${msg}`)

    return anchors
      .filter(a => a.severity === 'block')
      .map(anchor => ({
        anchor_id: anchor.id,
        answer: anchor.violation_signal as 'yes' | 'no',
        is_violation: true,
        explanation: `Probe failed: ${msg}`,
        pass_name: 'probe-failsafe',
        timestamp: new Date().toISOString(),
      }))
  }
}

// ── Parse Helpers ──────────────────────────────────────────────

/**
 * Parse the probe response into a key-value map of answers.
 *
 * Tries JSON.parse first, then strips code fences, then falls back
 * to regex-based free-text extraction.
 */
function parseProbeResponse(
  raw: string,
  expectedCount: number,
): Record<string, string> {
  const cleaned = raw
    .replace(/```json\s*/g, '')
    .replace(/```/g, '')
    .trim()

  // Try direct JSON parse
  try {
    const parsed = JSON.parse(cleaned)
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as Record<string, string>
    }
  } catch {
    // Not valid JSON, fall through to fallback
  }

  // Fallback: extract yes/no answers from free text
  return fallbackParse(cleaned, expectedCount)
}

/**
 * Normalize a probe answer to "yes" or "no".
 * Handles common LLM output variations.
 */
function normalizeAnswer(raw: string | undefined): 'yes' | 'no' {
  if (!raw) return 'yes' // Fail safe: assume violation-possible answer
  const cleaned = raw.toLowerCase().trim()
  if (cleaned.startsWith('no')) return 'no'
  if (cleaned.startsWith('yes')) return 'yes'
  if (cleaned === 'true' || cleaned === '1') return 'yes'
  if (cleaned === 'false' || cleaned === '0') return 'no'
  return 'yes' // Default to the answer more likely to trigger review
}

/**
 * Fallback parser when the model doesn't produce clean JSON.
 * Tries to extract yes/no answers from free text.
 */
function fallbackParse(
  raw: string,
  expectedCount: number,
): Record<string, string> {
  const result: Record<string, string> = {}

  for (let i = 1; i <= expectedCount; i++) {
    const patterns = [
      new RegExp(`"${i}"\\s*:\\s*"(yes|no)"`, 'i'),
      new RegExp(`${i}[.):;]\\s*(yes|no)`, 'i'),
      new RegExp(`question\\s*${i}[.:;]?\\s*(yes|no)`, 'i'),
    ]

    for (const pattern of patterns) {
      const match = raw.match(pattern)
      if (match) {
        result[String(i)] = match[1]!.toLowerCase()
        break
      }
    }
  }

  return result
}

/**
 * SE-4: Deterministic truncation strategy for oversized pass output.
 *
 * If the output is JSON with an array, take first N items.
 * Otherwise, truncate to maxChars with a truncation marker.
 */
function truncatePassOutput(output: string, maxChars: number): string {
  // Try to parse as JSON and truncate array elements
  try {
    const parsed = JSON.parse(output) as Record<string, unknown>
    if (typeof parsed === 'object' && parsed !== null) {
      // Find the first array field and truncate it
      for (const [key, value] of Object.entries(parsed)) {
        if (Array.isArray(value) && JSON.stringify(value).length > maxChars * 0.8) {
          // Binary search for max items that fit
          let lo = 1
          let hi = value.length
          while (lo < hi) {
            const mid = Math.ceil((lo + hi) / 2)
            const candidate = { ...parsed, [key]: value.slice(0, mid) }
            if (JSON.stringify(candidate).length <= maxChars) {
              lo = mid
            } else {
              hi = mid - 1
            }
          }
          const truncated = { ...parsed, [key]: value.slice(0, lo) }
          return JSON.stringify(truncated)
        }
      }
    }
  } catch {
    // Not valid JSON — fall through to raw truncation
  }

  // Raw character truncation
  return output.slice(0, maxChars) + '\n[TRUNCATED]'
}
