/**
 * Crystallizer Phase 1: Intent crystallization.
 *
 * Decomposes a signal's intent into 3-6 binary IntentAnchor checkpoints
 * that persist across all compilation passes. Uses an isolated LLM call
 * (different model from kimi-k2.6 compilation) via task-routing 'crystallizer' kind.
 *
 * Adapted from IntrospectiveHarness crystallizer.ts.
 * Traces to: DESIGN-CRYSTALLIZER.md, specification-execution-ontology-draft-0.9.md (A7)
 */

import type { PipelineEnv } from '../types'
import { callModel } from '../model-bridge'
import { extractJSON } from '../agents/output-reliability'

// ── Types ──────────────────────────────────────────────────────

export interface IntentAnchor {
  id: string                       // e.g. "IA-SIG-TEST123-01"
  signal_id: string                // parent signal key
  claim: string                    // original conceptual claim from the signal
  probe_question: string           // binary yes/no question answerable from output text alone
  violation_signal: 'yes' | 'no'   // which answer indicates a violation
  severity: 'block' | 'warn' | 'log'
  times_probed: number             // updated by drift ledger (per-run)
  times_violated: number           // updated by drift ledger (per-run)
}

export interface CrystallizationResult {
  signal_id: string
  anchors: IntentAnchor[]
  model_used: string
  latency_ms: number
  timestamp: string
}

export interface CrystallizeInput {
  signalId: string
  title: string
  description: string
  specContent?: string
}

// ── System Prompt ──────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a specification fidelity analyst for a software compilation pipeline.

The pipeline decomposes a change request into JSON "atoms" — structured work units.
Each atom is a JSON object with fields: id, type, title, description, verifies.

Your job: produce binary yes/no checkpoint questions that verify whether the atoms
preserve the signal's original intent. The questions will be evaluated against the
JSON atoms output, NOT against source code.

Each checkpoint must:
1. Be answerable by reading the JSON atoms array alone
2. Reference specific names, types, or concepts from the signal
3. Ask whether an atom's title, description, or verifies field mentions the key concept
4. Have a clear yes/no answer

Example: if the signal says "export LifecycleState from index.ts", good probes are:
"Does any atom's title or description mention LifecycleState?" (checks the concept)
"Does any atom's description mention index.ts or entry point?" (checks the target — use short filenames, not full paths)
BAD probe: "Does the output contain export type { LifecycleState }?" (that's code, not atoms)
BAD probe: "Does any atom mention workers/ff-pipeline/src/index.ts?" (too literal — atoms use short names)

Your response is a JSON array:
[
  {
    "claim": "The original intent being checked",
    "probe_question": "Does any atom's title, description, or verifies field mention [specific concept from the signal]?",
    "violation_signal": "no",
    "severity": "block"
  }
]

Severity:
- "block": The atoms completely miss a key concept from the signal
- "warn": The atoms partially address the intent but drift from specifics
- "log": Minor naming deviation worth tracking

Generate 3-6 anchors. Each must check for a SPECIFIC concept from the signal.`

// ── Constants ──────────────────────────────────────────────────

const MIN_ANCHORS = 3
const MAX_ANCHORS = 6

// ── Main function ──────────────────────────────────────────────

/**
 * Crystallize a signal's intent into binary IntentAnchor checkpoints.
 *
 * @param input - Signal title, description, specContent
 * @param env - Pipeline environment (for AI binding)
 * @param dryRun - If true, return stub anchors without LLM call
 * @param enabled - Hot-config crystallizer.enabled flag
 * @returns CrystallizationResult with 0-6 anchors
 */
export async function crystallizeIntent(
  input: CrystallizeInput,
  env: PipelineEnv,
  dryRun: boolean,
  enabled: boolean,
): Promise<CrystallizationResult> {
  const startTime = Date.now()

  // Feature flag: disabled -> return empty anchors
  if (!enabled) {
    return {
      signal_id: input.signalId,
      anchors: [],
      model_used: 'disabled',
      latency_ms: 0,
      timestamp: new Date().toISOString(),
    }
  }

  // Dry-run: return stub anchors without LLM call
  if (dryRun) {
    return {
      signal_id: input.signalId,
      anchors: buildStubAnchors(input.signalId, input.title),
      model_used: 'dry-run',
      latency_ms: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    }
  }

  // Check AI binding availability
  if (!env.AI) {
    console.error('[INFRA SIGNAL] infra:crystallizer-binding-unavailable: Workers AI binding not configured')
    return emptyResult(input.signalId, startTime)
  }

  // Live: call LLM via task-routing 'crystallizer' kind
  try {
    const userMessage = buildUserMessage(input)
    const rawResponse = await callModel('crystallizer', SYSTEM_PROMPT, userMessage, env)
    const anchors = parseAnchors(rawResponse, input.signalId)
    return {
      signal_id: input.signalId,
      anchors,
      model_used: 'crystallizer',
      latency_ms: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[INFRA SIGNAL] infra:crystallizer-call-failure: ${msg}`)
    return emptyResult(input.signalId, startTime)
  }
}

// ── Helpers ────────────────────────────────────────────────────

function buildUserMessage(input: CrystallizeInput): string {
  const parts: string[] = [
    `Signal: ${input.title}`,
    `Description: ${input.description}`,
  ]
  if (input.specContent) {
    parts.push(`Specification content:\n${input.specContent}`)
  }
  return parts.join('\n\n')
}

/**
 * Parse LLM response into validated IntentAnchor array.
 * Uses extractJSON from ORL for 5-tier fallback.
 * Returns empty array on parse failure (fail-open for Phase 1).
 */
function parseAnchors(rawResponse: string, signalId: string): IntentAnchor[] {
  const extracted = extractJSON(rawResponse)
  if (!extracted) {
    console.error('[INFRA SIGNAL] infra:crystallizer-parse-failure: extractJSON returned null')
    return []
  }

  let rawAnchors: unknown[]
  if (Array.isArray(extracted.json)) {
    rawAnchors = extracted.json
  } else if (
    typeof extracted.json === 'object' &&
    extracted.json !== null &&
    'anchors' in (extracted.json as Record<string, unknown>) &&
    Array.isArray((extracted.json as Record<string, unknown>).anchors)
  ) {
    // Handle case where LLM wraps array in { "anchors": [...] }
    rawAnchors = (extracted.json as Record<string, unknown>).anchors as unknown[]
  } else {
    console.error('[INFRA SIGNAL] infra:crystallizer-parse-failure: response is not an array of anchors')
    return []
  }

  // Validate and transform each anchor, clamping to MAX_ANCHORS
  const anchors: IntentAnchor[] = []
  for (let i = 0; i < rawAnchors.length && anchors.length < MAX_ANCHORS; i++) {
    const raw = rawAnchors[i] as Record<string, unknown>
    if (!raw || typeof raw !== 'object') continue

    const claim = typeof raw.claim === 'string' ? raw.claim : ''
    const probeQuestion = typeof raw.probe_question === 'string' ? raw.probe_question : ''
    if (raw.violation_signal !== 'yes' && raw.violation_signal !== 'no') continue
    const violationSignal = raw.violation_signal as 'yes' | 'no'
    const severity = validateSeverity(raw.severity)

    if (!claim || !probeQuestion) continue

    anchors.push({
      id: `IA-${signalId}-${String(anchors.length + 1).padStart(2, '0')}`,
      signal_id: signalId,
      claim,
      probe_question: probeQuestion,
      violation_signal: violationSignal,
      severity,
      times_probed: 0,
      times_violated: 0,
    })
  }

  return anchors
}

function validateSeverity(value: unknown): 'block' | 'warn' | 'log' {
  if (value === 'block' || value === 'warn' || value === 'log') {
    return value
  }
  return 'log' // default to lowest severity
}

function buildStubAnchors(signalId: string, title: string): IntentAnchor[] {
  return [
    {
      id: `IA-${signalId}-01`,
      signal_id: signalId,
      claim: `Signal intent: ${title}`,
      probe_question: `Does this output address "${title}"?`,
      violation_signal: 'no',
      severity: 'block',
      times_probed: 0,
      times_violated: 0,
    },
    {
      id: `IA-${signalId}-02`,
      signal_id: signalId,
      claim: `Signal scope preserved`,
      probe_question: `Does this output stay within the scope of "${title}"?`,
      violation_signal: 'no',
      severity: 'warn',
      times_probed: 0,
      times_violated: 0,
    },
    {
      id: `IA-${signalId}-03`,
      signal_id: signalId,
      claim: `No extraneous additions`,
      probe_question: `Does this output introduce concepts not present in the original signal?`,
      violation_signal: 'yes',
      severity: 'log',
      times_probed: 0,
      times_violated: 0,
    },
  ]
}

function emptyResult(signalId: string, startTime: number): CrystallizationResult {
  return {
    signal_id: signalId,
    anchors: [],
    model_used: 'none',
    latency_ms: Date.now() - startTime,
    timestamp: new Date().toISOString(),
  }
}
