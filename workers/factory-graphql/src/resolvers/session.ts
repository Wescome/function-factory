import type { GqlContext } from '../context.js'
import type { SessionRow, ArtifactRow, VerificationReportRow } from '../data-sources/d1.js'

// ── Query resolvers ───────────────────────────────────────────────────────────

const Query = {
  session: (_: unknown, args: { id: string }, ctx: GqlContext): Promise<SessionRow | null> => {
    return ctx.d1.getSession(args.id)
  },

  sessions: async (
    _: unknown,
    args: { assemblyId: string; status?: string; limit?: number; cursor?: string },
    ctx: GqlContext,
  ): Promise<{ sessions: SessionRow[]; cursor: string | null }> => {
    return ctx.d1.getSessions(
      args.assemblyId,
      args.status ?? null,
      args.limit ?? 20,
      args.cursor ?? null,
    )
  },

  sessionsByWorkOrder: (
    _: unknown,
    args: { workOrderId: string },
    ctx: GqlContext,
  ): Promise<SessionRow[]> => {
    return ctx.d1.getSessionsByWorkOrder(args.workOrderId)
  },
}

// ── FactorySession field resolvers ────────────────────────────────────────────

const FactorySession = {
  id: (session: SessionRow): string => session.session_id,
  assemblyId: (session: SessionRow): string => session.assembly_id,
  workOrderId: (session: SessionRow): string | null => session.work_order_id ?? null,
  status: (session: SessionRow): string => session.status,
  createdAt: (session: SessionRow): string => session.created_at,
  updatedAt: (session: SessionRow): string => session.updated_at,
  runId: (session: SessionRow): string | null => session.run_id ?? null,
  orgId: (session: SessionRow): string | null => session.org_id ?? null,

  intentSpecRef: (session: SessionRow): { specId: string; version: string; domain: string } | null => {
    if (
      session.intent_spec_id === null ||
      session.intent_spec_version === null ||
      session.intent_spec_domain === null
    ) return null
    return {
      specId:   session.intent_spec_id,
      version:  session.intent_spec_version,
      domain:   session.intent_spec_domain,
    }
  },

  // epistemicSurface and reviewPrompts come from the session JSON fields (not yet wired to
  // a dedicated table — return null/[] until the schema is extended).
  epistemicSurface: (_session: SessionRow): null => null,
  reviewPrompts: (_session: SessionRow): unknown[] => [],

  beads: (session: SessionRow, _args: unknown, ctx: GqlContext) => {
    const runId = session.run_id ?? session.session_id
    return ctx.coordinator.getBeads(runId)
  },

  amendments: (session: SessionRow, _args: unknown, ctx: GqlContext) => {
    const runId = session.run_id ?? session.session_id
    return ctx.coordinator.getAmendments(runId)
  },

  artifacts: (
    session: SessionRow,
    args: { kinds?: string[] | null },
    ctx: GqlContext,
  ): Promise<ArtifactRow[]> => {
    return ctx.d1.getArtifactsForSession(session.session_id, args.kinds ?? null)
  },

  verificationReports: (
    session: SessionRow,
    _args: unknown,
    ctx: GqlContext,
  ): Promise<VerificationReportRow[]> => {
    return ctx.d1.getVerificationReports(session.session_id)
  },

  evidenceChain: (session: SessionRow): {
    sessionId: string;
    root: string;
    tip: string;
    bundleCount: number;
    bundles: unknown[];
  } => {
    // Stub: full durable replay (D1 bead_audit + ArtifactGraph DO) wired in Phase 4 (ADR-0016).
    return {
      sessionId: session.session_id,
      root: '',
      tip: '',
      bundleCount: 0,
      bundles: [],
    }
  },
}

export const sessionResolvers = { Query, FactorySession }
