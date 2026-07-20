import { computeBeadId } from './bead-id.js';
import type { BeadGraphDOBase } from './do.js';
import type {
  AnyBead,
  AuditBead,
  AmendmentBead,
  AmendmentBeadContent,
  Autonomy,
} from './schemas.js';

// ── Error classes ──────────────────────────────────────────────────────────

export class SessionNotInitialized extends Error {
  constructor(sessionId: string) {
    super(`Session ${sessionId}: retrieveKnowingState() must be called before writeExecutionBead()`);
    this.name = 'SessionNotInitialized';
  }
}

export class AutonomyDegradedError extends Error {
  constructor(floor: Autonomy, requested: Autonomy) {
    super(`AutonomyDegraded: floor=${floor}, requested=${requested}. Session is degraded to SUGGEST.`);
    this.name = 'AutonomyDegradedError';
  }
}

export class BeadImmutabilityError extends Error {
  constructor(beadId: string) {
    super(`BeadImmutabilityError: bead ${beadId} cannot be modified (INV-BG-001)`);
    this.name = 'BeadImmutabilityError';
  }
}

export class BeadIntegrityError extends Error {
  constructor(expected: string, actual: string) {
    super(`BeadIntegrityError: expected bead_id=${expected}, computed=${actual} (INV-BG-002)`);
    this.name = 'BeadIntegrityError';
  }
}

// ── Session interface ──────────────────────────────────────────────────────

export interface Session {
  sessionId: string;
  orgId: string;
  roleId: string;
  agentId: string;
  autonomyFloor: Autonomy;
  ksRetrievedAt?: number;
}

// ── KnowingState interface ─────────────────────────────────────────────────

export interface KnowingState<TrustContent, PolicyContent> {
  policy: PolicyContent | null;
  trustedSubjects: TrustContent[];
  consent: { grants: string[] } | null;
  retrievedAt: number;
}

// ── TrustEvaluation interface ──────────────────────────────────────────────

export interface TrustEvaluation<TrustContent> {
  trusted: boolean;
  trustBead: TrustContent | null;
  autonomy: Autonomy;
}

// ── KnowingStateSDK interface ──────────────────────────────────────────────

export interface KnowingStateSDK<PolicyContent, TrustContent, ExecutionContent, OutcomeContent> {
  openSession(orgId: string, roleId: string, agentId: string): Promise<Session>;
  closeSession(sessionId: string): Promise<void>;
  retrieveKnowingState(sessionId: string, category?: string): Promise<KnowingState<TrustContent, PolicyContent>>;
  evaluateTrust(sessionId: string, subjectId: string): Promise<TrustEvaluation<TrustContent>>;
  writeExecutionBead(sessionId: string, payload: ExecutionContent): Promise<string>;
  writeOutcomeBead(sessionId: string, executionBeadId: string, outcome: OutcomeContent): Promise<string>;
  getOpenAmendments(orgId: string): Promise<AmendmentBeadContent[]>;
  checkConsent(sessionId: string, action: string): Promise<boolean>;
}

// ── DO stub type ───────────────────────────────────────────────────────────

type DOStub = Pick<
  BeadGraphDOBase<unknown>,
  | 'writeBead'
  | 'getBead'
  | 'getCurrentTrustBead'
  | 'getActiveConsent'
  | 'getTrustLineage'
  | 'getOpenAmendments'
  | 'retrieveKnowingState'
  | 'computeBeadId'
>;

// ── KV key helpers ─────────────────────────────────────────────────────────

function sessionKey(sessionId: string): string {
  return `session:${sessionId}`;
}

function ksKey(orgId: string, roleId: string, category?: string): string {
  return `ks:${orgId}:${roleId}:${category ?? '*'}`;
}

// ── Crypto UUID fallback ───────────────────────────────────────────────────

function generateSessionId(): string {
  // Use crypto.randomUUID if available (CF Workers runtime)
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Node.js fallback for tests
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ── SDK Implementation ─────────────────────────────────────────────────────

export class KnowingStateSDKImpl<
  PolicyContent extends Record<string, unknown>,
  TrustContent extends Record<string, unknown>,
  ExecutionContent extends {
    subject_id: string;
    action: string;
    autonomy_level: Autonomy;
    trust_bead_id: string;
    policy_bead_id: string;
    rationale: string;
    artifact_graph_execution_id?: string;
  },
  OutcomeContent extends {
    execution_bead_id: string;
    status: 'SUCCESS' | 'PARTIAL' | 'FAILURE' | 'DISPUTED';
    summary: string;
    metrics?: Record<string, unknown>;
    triggers_amendment: boolean;
    artifact_graph_divergence_id?: string;
  },
> implements KnowingStateSDK<PolicyContent, TrustContent, ExecutionContent, OutcomeContent> {
  private do: DOStub;
  private kv: KVNamespace;

  constructor(doStub: DOStub, kv: KVNamespace) {
    this.do = doStub;
    this.kv = kv;
  }

  async openSession(orgId: string, roleId: string, agentId: string): Promise<Session> {
    const sessionId = generateSessionId();
    const session: Session = {
      sessionId,
      orgId,
      roleId,
      agentId,
      autonomyFloor: 'EXECUTE_FULL',
    };
    await this.kv.put(sessionKey(sessionId), JSON.stringify(session), { expirationTtl: 86400 });
    return session;
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.kv.delete(sessionKey(sessionId));
  }

  async retrieveKnowingState(
    sessionId: string,
    category?: string
  ): Promise<KnowingState<TrustContent, PolicyContent>> {
    const sessionRaw = await this.kv.get(sessionKey(sessionId));
    if (!sessionRaw) throw new SessionNotInitialized(sessionId);
    const session = JSON.parse(sessionRaw) as Session;

    // Check KV hot cache
    const cacheKey = ksKey(session.orgId, session.roleId, category);
    const cached = await this.kv.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as KnowingState<TrustContent, PolicyContent>;
    }

    // Cold path: call DO
    try {
      const ks = await this.do.retrieveKnowingState(session.orgId, session.roleId, category);
      const result: KnowingState<TrustContent, PolicyContent> = {
        policy: ks.policy ? (ks.policy.content as PolicyContent) : null,
        trustedSubjects: ks.trustedSubjects.map(b => b.content as TrustContent),
        consent: ks.consent ? { grants: (ks.consent.content as { grants: string[] }).grants } : null,
        retrievedAt: Date.now(),
      };
      // Cache result
      await this.kv.put(cacheKey, JSON.stringify(result), { expirationTtl: 3600 });
      // Update session ksRetrievedAt
      session.ksRetrievedAt = result.retrievedAt;
      await this.kv.put(sessionKey(sessionId), JSON.stringify(session), { expirationTtl: 86400 });
      return result;
    } catch (err) {
      // Fail-closed: degrade autonomy floor
      session.autonomyFloor = 'SUGGEST';
      await this.kv.put(sessionKey(sessionId), JSON.stringify(session), { expirationTtl: 86400 });
      throw err;
    }
  }

  async evaluateTrust(
    sessionId: string,
    subjectId: string
  ): Promise<TrustEvaluation<TrustContent>> {
    const sessionRaw = await this.kv.get(sessionKey(sessionId));
    if (!sessionRaw) throw new SessionNotInitialized(sessionId);
    const session = JSON.parse(sessionRaw) as Session;

    const trustBead = await this.do.getCurrentTrustBead(session.orgId, subjectId);
    if (!trustBead) {
      return { trusted: false, trustBead: null, autonomy: 'SUGGEST' };
    }

    const content = trustBead.content as { status: string; trust_score: number };
    const trusted = content.status === 'APPROVED' && content.trust_score > 0;
    let autonomy: Autonomy = 'SUGGEST';
    if (trusted) {
      if (content.trust_score >= 0.9) autonomy = 'EXECUTE_FULL';
      else if (content.trust_score >= 0.7) autonomy = 'EXECUTE_BOUNDED';
      else if (content.trust_score >= 0.5) autonomy = 'PROPOSE';
      else autonomy = 'SUGGEST';
    }

    return {
      trusted,
      trustBead: trustBead.content as TrustContent,
      autonomy,
    };
  }

  async writeExecutionBead(sessionId: string, payload: ExecutionContent): Promise<string> {
    const sessionRaw = await this.kv.get(sessionKey(sessionId));
    if (!sessionRaw) throw new SessionNotInitialized(sessionId);
    const session = JSON.parse(sessionRaw) as Session;

    // INV-BG-003: must have retrieved knowing state
    if (session.ksRetrievedAt === undefined || session.ksRetrievedAt === null) {
      throw new SessionNotInitialized(sessionId);
    }

    // INV-BG-008: autonomy floor check
    if (session.autonomyFloor === 'SUGGEST' && payload.autonomy_level !== 'SUGGEST') {
      throw new AutonomyDegradedError(session.autonomyFloor, payload.autonomy_level);
    }

    const beadId = computeBeadId('execution', payload as unknown as Record<string, unknown>, []);
    const now = Date.now();

    const executionBead: AnyBead = {
      bead_id: beadId,
      org_id: session.orgId,
      type: 'execution',
      parent_ids: [],
      written_by: session.agentId,
      ts: now,
      content: payload as unknown as AnyBead extends { type: 'execution'; content: infer C } ? C : never,
    } as AnyBead;

    const auditContent = {
      audited_bead_id: beadId,
      audited_type: 'execution',
      action: 'CREATE' as const,
      actor_id: session.agentId,
      session_id: sessionId,
      ts: now,
    };
    const auditBeadId = computeBeadId('audit', auditContent as unknown as Record<string, unknown>, [beadId]);
    const auditBead: AuditBead = {
      bead_id: auditBeadId,
      org_id: session.orgId,
      type: 'audit',
      parent_ids: [beadId],
      written_by: session.agentId,
      ts: now,
      content: auditContent,
    };

    await this.do.writeBead(executionBead, auditBead);
    await this.invalidateKV(session.orgId, 'execution', payload as unknown as Record<string, unknown>);

    return beadId;
  }

  async writeOutcomeBead(
    sessionId: string,
    executionBeadId: string,
    outcome: OutcomeContent
  ): Promise<string> {
    const sessionRaw = await this.kv.get(sessionKey(sessionId));
    if (!sessionRaw) throw new SessionNotInitialized(sessionId);
    const session = JSON.parse(sessionRaw) as Session;

    const beadId = computeBeadId('outcome', outcome as unknown as Record<string, unknown>, [executionBeadId]);
    const now = Date.now();

    const outcomeBead: AnyBead = {
      bead_id: beadId,
      org_id: session.orgId,
      type: 'outcome',
      parent_ids: [executionBeadId],
      written_by: session.agentId,
      ts: now,
      content: outcome as unknown as AnyBead extends { type: 'outcome'; content: infer C } ? C : never,
    } as AnyBead;

    const auditContent = {
      audited_bead_id: beadId,
      audited_type: 'outcome',
      action: 'CREATE' as const,
      actor_id: session.agentId,
      session_id: sessionId,
      ts: now,
    };
    const auditBeadId = computeBeadId('audit', auditContent as unknown as Record<string, unknown>, [beadId]);
    const auditBead: AuditBead = {
      bead_id: auditBeadId,
      org_id: session.orgId,
      type: 'audit',
      parent_ids: [beadId],
      written_by: session.agentId,
      ts: now,
      content: auditContent,
    };

    await this.do.writeBead(outcomeBead, auditBead);

    // I3: if outcome triggers amendment, auto-create PENDING AmendmentBead
    if (outcome.triggers_amendment) {
      const amendmentContent: AmendmentBeadContent = {
        target_bead_id: executionBeadId,
        target_type: 'trust',
        proposed_change: {},
        rationale: `Auto-generated from outcome bead ${beadId}`,
        triggered_by: beadId,
        status: 'PENDING',
      };
      const amendmentBeadId = computeBeadId(
        'amendment',
        amendmentContent as unknown as Record<string, unknown>,
        [beadId]
      );
      const amendmentBead: AmendmentBead = {
        bead_id: amendmentBeadId,
        org_id: session.orgId,
        type: 'amendment',
        parent_ids: [beadId],
        written_by: session.agentId,
        ts: now + 1,
        content: amendmentContent,
      };

      const amendAuditContent = {
        audited_bead_id: amendmentBeadId,
        audited_type: 'amendment',
        action: 'CREATE' as const,
        actor_id: session.agentId,
        session_id: sessionId,
        ts: now + 1,
      };
      const amendAuditBeadId = computeBeadId(
        'audit',
        amendAuditContent as unknown as Record<string, unknown>,
        [amendmentBeadId]
      );
      const amendAuditBead: AuditBead = {
        bead_id: amendAuditBeadId,
        org_id: session.orgId,
        type: 'audit',
        parent_ids: [amendmentBeadId],
        written_by: session.agentId,
        ts: now + 1,
        content: amendAuditContent,
      };

      await this.do.writeBead(amendmentBead, amendAuditBead);
    }

    // Invalidate maintenance KV
    await this.kv.delete(`maintenance:${session.orgId}`);

    return beadId;
  }

  async getOpenAmendments(orgId: string): Promise<AmendmentBeadContent[]> {
    const beads = await this.do.getOpenAmendments(orgId);
    return beads.map(b => b.content as AmendmentBeadContent);
  }

  async checkConsent(sessionId: string, action: string): Promise<boolean> {
    const sessionRaw = await this.kv.get(sessionKey(sessionId));
    if (!sessionRaw) throw new SessionNotInitialized(sessionId);
    const session = JSON.parse(sessionRaw) as Session;

    const consentBead = await this.do.getActiveConsent(session.orgId, session.roleId);
    if (!consentBead) return false;

    const grants = (consentBead.content as { grants: string[] }).grants;
    return grants.includes(action);
  }

  private async invalidateKV(
    orgId: string,
    type: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    // Invalidate knowing-state caches based on what changed
    if (type === 'execution' || type === 'trust' || type === 'policy' || type === 'consent') {
      // Broad invalidation: delete the org-level keys
      const roleId = (payload['role_id'] as string | undefined) ?? '';
      if (roleId) {
        await this.kv.delete(ksKey(orgId, roleId));
        await this.kv.delete(ksKey(orgId, roleId, undefined));
      }
    }
  }
}
