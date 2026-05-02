/**
 * ReconciliationGate Phase 2: Deterministic gate for inter-pass probing.
 *
 * PURE BOOLEAN LOGIC — no LLM calls, no judgment. A state machine.
 *
 * Decision matrix:
 *   No violations             -> PASS
 *   Log-only violations       -> PASS (record in drift ledger)
 *   Warn violations (no blocks) -> WARN (pass with advisory)
 *   Block violations, attempt < max -> REMEDIATE
 *   Block violations, attempt >= max -> ESCALATE
 *
 * Adapted from IntrospectiveHarness gate.ts.
 * Traces to: DESIGN-CRYSTALLIZER.md Section 3, Review Resolutions C1+SE-1
 */

import type { IntentAnchor } from './crystallize-intent'

// ── Types ──────────────────────────────────────────────────────

export interface ProbeResult {
  anchor_id: string
  answer: 'yes' | 'no'
  is_violation: boolean
  explanation?: string
  pass_name: string
  timestamp: string
}

export interface GateDecision {
  verdict: 'pass' | 'warn' | 'remediate' | 'escalate'
  violated_anchors: string[]
  probe_results: ProbeResult[]
  remediation_attempt: number
  advisory_text?: string
}

// ── Gate Function ──────────────────────────────────────────────

/**
 * Pure deterministic reconciliation gate.
 *
 * Takes probe results + anchor severity metadata and produces
 * a verdict. No LLM, no external calls, no side effects.
 */
export function reconcile(
  probeResults: ProbeResult[],
  anchors: IntentAnchor[],
  remediationAttempt: number,
  maxRemediationAttempts: number,
): GateDecision {
  const violations = probeResults.filter(r => r.is_violation)

  // ── No violations ──
  if (violations.length === 0) {
    return {
      verdict: 'pass',
      violated_anchors: [],
      probe_results: probeResults,
      remediation_attempt: remediationAttempt,
    }
  }

  // ── Classify violations by severity ──
  const anchorMap = new Map(anchors.map(a => [a.id, a]))
  const blockViolations: ProbeResult[] = []
  const warnViolations: ProbeResult[] = []
  const logViolations: ProbeResult[] = []

  for (const v of violations) {
    const anchor = anchorMap.get(v.anchor_id)
    if (!anchor) continue // Ignore violations for unknown anchors

    switch (anchor.severity) {
      case 'block':
        blockViolations.push(v)
        break
      case 'warn':
        warnViolations.push(v)
        break
      case 'log':
        logViolations.push(v)
        break
    }
  }

  // Collect all matched violated anchor IDs
  const allMatchedViolations = [...blockViolations, ...warnViolations, ...logViolations]
  const violatedAnchorIds = allMatchedViolations.map(v => v.anchor_id)

  // ── Log-only violations -> pass (record) ──
  if (blockViolations.length === 0 && warnViolations.length === 0) {
    return {
      verdict: 'pass',
      violated_anchors: violatedAnchorIds,
      probe_results: probeResults,
      remediation_attempt: remediationAttempt,
    }
  }

  // ── Warn violations (no blocks) -> warn ──
  if (blockViolations.length === 0) {
    const advisoryParts = warnViolations.map(v => {
      const anchor = anchorMap.get(v.anchor_id)
      return anchor ? anchor.claim : v.anchor_id
    })

    return {
      verdict: 'warn',
      violated_anchors: violatedAnchorIds,
      probe_results: probeResults,
      remediation_attempt: remediationAttempt,
      advisory_text: `Intent drift detected in: ${advisoryParts.join('; ')}.`,
    }
  }

  // ── Block violations, attempt < max -> remediate ──
  if (remediationAttempt < maxRemediationAttempts) {
    return {
      verdict: 'remediate',
      violated_anchors: violatedAnchorIds,
      probe_results: probeResults,
      remediation_attempt: remediationAttempt,
    }
  }

  // ── Block violations, attempt >= max -> escalate ──
  return {
    verdict: 'escalate',
    violated_anchors: violatedAnchorIds,
    probe_results: probeResults,
    remediation_attempt: remediationAttempt,
    advisory_text:
      `INTENT VIOLATION ESCALATION: Block-severity anchors violated after ` +
      `${remediationAttempt} remediation attempts. Compilation cannot proceed.`,
  }
}
