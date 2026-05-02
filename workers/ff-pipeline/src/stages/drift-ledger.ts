/**
 * DriftLedger Phase 3: Append-only protocol adherence observatory.
 *
 * Not a gate — an observatory. Tracks every probe result,
 * every gate verdict, every remediation across all compilations.
 *
 * Enables:
 * - Erosion detection (gradual protocol decay over compilations)
 * - Anchor quality assessment (false positive/negative rates)
 * - Pass targeting (which passes need probing most)
 * - Governor visibility (drift data feeds operational health)
 *
 * CRITICAL: appendDriftEntry is BEST-EFFORT. It NEVER blocks the pipeline.
 * Database write failures are swallowed. The pipeline's job is compilation;
 * telemetry must not interfere.
 *
 * Adapted from IntrospectiveHarness drift-ledger.ts.
 * Traces to: DESIGN-CRYSTALLIZER.md Section 4 (Phase 3)
 */

import type { ArangoClient } from '@factory/arango-client'
import type { ProbeResult } from './reconciliation-gate'

// ── Types ──────────────────────────────────────────────────────

export interface DriftEntry {
  pipeline_id: string         // workflow instance ID
  signal_id: string
  pass_name: string
  anchors_probed: string[]    // anchor IDs
  probe_results: ProbeResult[]
  gate_verdict: 'pass' | 'warn' | 'remediate' | 'escalate'
  remediation_count: number
  probe_model: string
  latency_ms: number
  timestamp: string
}

export interface DriftAnalysis {
  total_entries: number
  total_probes: number
  total_violations: number
  violation_rate: number
  per_pass_stats: Record<string, { probes: number; violations: number }>
  most_violated_anchors: Array<{ id: string; violations: number; total: number }>
}

export interface ErosionReport {
  eroding: boolean
  early_violation_rate: number
  late_violation_rate: number
  delta: number
}

// ── Append (best-effort) ──────────────────────────────────────

/**
 * Write a drift entry to ArangoDB. Best-effort — NEVER throws.
 * Database failures are swallowed with a console.warn.
 */
export async function appendDriftEntry(
  entry: DriftEntry,
  db: ArangoClient,
): Promise<void> {
  try {
    await db.save('compilation_drift_ledger', entry as unknown as Record<string, unknown>)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[drift-ledger] best-effort write failed: ${msg}`)
  }
}

// ── Analyze ───────────────────────────────────────────────────

/**
 * Compute aggregate drift statistics from a set of entries.
 *
 * Returns violation rate, per-pass stats, per-anchor stats.
 * Pure function — no I/O, no side effects.
 */
export function analyzeDrift(entries: DriftEntry[]): DriftAnalysis {
  if (entries.length === 0) {
    return {
      total_entries: 0,
      total_probes: 0,
      total_violations: 0,
      violation_rate: 0,
      per_pass_stats: {},
      most_violated_anchors: [],
    }
  }

  // ── Per-pass statistics ──
  const passStats: Record<string, { probes: number; violations: number }> = {}
  for (const entry of entries) {
    const stat = passStats[entry.pass_name] ?? { probes: 0, violations: 0 }
    stat.probes += entry.probe_results.length
    stat.violations += entry.probe_results.filter(r => r.is_violation).length
    passStats[entry.pass_name] = stat
  }

  // ── Per-anchor statistics ──
  const anchorStats = new Map<string, { violations: number; total: number }>()
  for (const entry of entries) {
    for (const result of entry.probe_results) {
      const stat = anchorStats.get(result.anchor_id) ?? { violations: 0, total: 0 }
      stat.total++
      if (result.is_violation) stat.violations++
      anchorStats.set(result.anchor_id, stat)
    }
  }

  const totalProbes = entries.reduce(
    (sum, e) => sum + e.probe_results.length,
    0,
  )
  const totalViolations = entries.reduce(
    (sum, e) => sum + e.probe_results.filter(r => r.is_violation).length,
    0,
  )

  return {
    total_entries: entries.length,
    total_probes: totalProbes,
    total_violations: totalViolations,
    violation_rate: totalProbes > 0 ? totalViolations / totalProbes : 0,
    per_pass_stats: passStats,
    most_violated_anchors: [...anchorStats.entries()]
      .map(([id, stat]) => ({ id, ...stat }))
      .sort((a, b) => b.violations - a.violations),
  }
}

// ── Erosion Detection ─────────────────────────────────────────

/**
 * Compare early vs late window violation rates.
 *
 * "Erosion" means the late window has a significantly higher
 * violation rate than the early window (50% increase threshold,
 * matching the reference implementation).
 *
 * Requires at least 2 * windowSize entries; returns safe defaults
 * if there is insufficient data.
 */
export function detectErosion(
  entries: DriftEntry[],
  windowSize: number = 5,
): ErosionReport {
  if (entries.length < windowSize * 2) {
    return {
      eroding: false,
      early_violation_rate: 0,
      late_violation_rate: 0,
      delta: 0,
    }
  }

  const early = entries.slice(0, windowSize)
  const late = entries.slice(-windowSize)

  const earlyViolations = early.reduce(
    (sum, e) => sum + e.probe_results.filter(r => r.is_violation).length,
    0,
  )
  const earlyTotal = early.reduce(
    (sum, e) => sum + e.probe_results.length,
    0,
  )
  const lateViolations = late.reduce(
    (sum, e) => sum + e.probe_results.filter(r => r.is_violation).length,
    0,
  )
  const lateTotal = late.reduce(
    (sum, e) => sum + e.probe_results.length,
    0,
  )

  const earlyRate = earlyTotal > 0 ? earlyViolations / earlyTotal : 0
  const lateRate = lateTotal > 0 ? lateViolations / lateTotal : 0

  return {
    eroding: earlyRate === 0 ? lateRate > 0 : lateRate > earlyRate * 1.5,
    early_violation_rate: earlyRate,
    late_violation_rate: lateRate,
    delta: lateRate - earlyRate,
  }
}
