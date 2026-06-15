/**
 * @factory/commissioning-agent — P4 Health Document Builder
 *
 * Renders the "Factory Health — P4" Linear document from live session state,
 * cycle context, and advisory metrics.
 *
 * Implements SPEC-FF-CYCLE-HEALTH-001 §3 (health document schema).
 *
 * The document is pushed to Linear via POST {LINEAR_SYNC_URL}/health/push.
 * Rendering happens inside CommissioningAgentDO so it has direct access to
 * the DO's SQLite session_context without a remote call.
 */

import type { CycleContext, SessionContext, HypothesisNode } from './schemas.js'

// ── Advisory metrics ──────────────────────────────────────────────────────────

export interface AdvisoryMetrics {
  /** Advisory hypotheses that have not yet been surfaced to Linear. */
  queued: number
  /** Advisory hypotheses surfaced in the current cycle. */
  surfacedThisCycle: number
  /** Advisory hypotheses carried over from previous cycles (surfacedCycleCount > 1). */
  carriedOver: number
}

/**
 * Derive advisory metrics from a list of HypothesisNodes.
 */
export function deriveAdvisoryMetrics(hypotheses: HypothesisNode[]): AdvisoryMetrics {
  const advisory = hypotheses.filter((h) => h.severity === 'advisory')
  return {
    queued: advisory.filter((h) => !h.surfaced).length,
    surfacedThisCycle: advisory.filter((h) => h.surfaced && h.surfacedCycleCount === 1).length,
    carriedOver: advisory.filter((h) => h.surfaced && h.surfacedCycleCount > 1).length,
  }
}

// ── Health document request ───────────────────────────────────────────────────

export interface HealthSyncRequest {
  orgId: string
  renderedAt: string
  markdownContent: string
  cycleId: string | null
  cycleName: string | null
  advisoryMetrics: AdvisoryMetrics
  /** Session phase at time of render — used for health snapshot history. */
  currentPhase: string
}

// ── Document renderer ─────────────────────────────────────────────────────────

/**
 * Render the P4 health document markdown from current session state.
 *
 * The rendered markdown is pushed to Linear as a document update via the
 * LinearSyncService. This function is pure — it produces a string with no
 * side effects.
 */
export function renderHealthDocument(
  orgId: string,
  session: SessionContext,
  cycle: CycleContext | null,
  metrics: AdvisoryMetrics,
): string {
  const now = new Date().toISOString()

  const cycleSection = cycle
    ? [
        `## Current Cycle`,
        `**${cycle.cycleName}** — ${cycle.daysRemaining.toFixed(1)} days remaining`,
        cycle.isLastTwoDays
          ? `> Advisory items will be surfaced — cycle boundary approaching`
          : '',
        ``,
        `Advisory items queued (not yet surfaced): ${metrics.queued}`,
        `Advisory items surfaced this cycle: ${metrics.surfacedThisCycle}`,
        `Carried over from last cycle: ${metrics.carriedOver}`,
      ]
        .filter((l) => l !== '')
        .join('\n')
    : [
        `## Current Cycle`,
        `No active cycle detected.`,
        ``,
        `Advisory items queued (not yet surfaced): ${metrics.queued}`,
        `Advisory items surfaced this cycle: ${metrics.surfacedThisCycle}`,
        `Carried over from last cycle: ${metrics.carriedOver}`,
      ].join('\n')

  const sessionSection = [
    `## Session State`,
    `**Phase:** ${session.currentPhase}`,
    `**Vertical:** ${session.domainProfile.vertical}`,
    session.lastSignalAt ? `**Last Signal:** ${session.lastSignalAt}` : '',
    session.lastDivergenceAt ? `**Last Divergence:** ${session.lastDivergenceAt}` : '',
  ]
    .filter((l) => l !== '')
    .join('\n')

  const constraintSection =
    session.domainProfile.constraints.length > 0
      ? [
          `## Active Constraints`,
          ...session.domainProfile.constraints.map(
            (c) => `- **[${c.severity.toUpperCase()}]** ${c.id}: ${c.description}`,
          ),
        ].join('\n')
      : ''

  const parts = [
    `# Factory Health — ${orgId}`,
    `_Updated: ${now}_`,
    ``,
    cycleSection,
    ``,
    sessionSection,
    constraintSection ? `\n${constraintSection}` : '',
  ]

  return parts.filter((p) => p !== '').join('\n')
}

/**
 * Build a HealthSyncRequest ready to POST to LinearSyncService.
 */
export function buildHealthSyncRequest(
  orgId: string,
  session: SessionContext,
  cycle: CycleContext | null,
  metrics: AdvisoryMetrics,
): HealthSyncRequest {
  return {
    orgId,
    renderedAt: new Date().toISOString(),
    markdownContent: renderHealthDocument(orgId, session, cycle, metrics),
    cycleId: cycle?.cycleId ?? null,
    cycleName: cycle?.cycleName ?? null,
    advisoryMetrics: metrics,
    currentPhase: session.currentPhase,
  }
}

// ── Health push ───────────────────────────────────────────────────────────────

/**
 * Push the health document to LinearSyncService.
 * Non-fatal — failures are logged but do not affect the alarm flow.
 */
export async function pushHealthDocument(
  linearSyncUrl: string,
  request: HealthSyncRequest,
): Promise<void> {
  try {
    const resp = await fetch(`${linearSyncUrl}/health/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
    if (!resp.ok) {
      console.warn(`[HealthDocument] push failed: HTTP ${resp.status}`)
    }
  } catch (err) {
    console.warn('[HealthDocument] push error:', err)
  }
}
