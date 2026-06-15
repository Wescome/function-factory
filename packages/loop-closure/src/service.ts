import type {
  LoopClosureConfig,
  Session,
  Autonomy,
  ExecutionContent,
  OutcomeContent,
  VerificationResult,
} from './types.js';
import {
  addExecutionBridge,
  addDivergenceBridge,
  addAmendmentBridge,
  addSpecificationBridge,
} from './bridge-fields.js';
import type { AnyBead } from '@factory/bead-graph';

// ── ID generation ─────────────────────────────────────────────────────────

function generateId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

// ── Audit bead helper ─────────────────────────────────────────────────────

function buildAuditBead(
  audited: AnyBead,
  sessionId: string,
  action: 'CREATE' | 'SUPERSEDE' | 'ESCALATE' | 'CONSENT_GRANT' | 'CONSENT_REVOKE' = 'CREATE'
): AnyBead {
  const content = {
    audited_bead_id: audited.bead_id,
    audited_type:    audited.type,
    action,
    actor_id:        audited.written_by,
    session_id:      sessionId,
    ts:              Date.now(),
  };
  const auditBead: AnyBead = {
    bead_id:    crypto.randomUUID(),
    org_id:     audited.org_id,
    type:       'audit',
    parent_ids: [audited.bead_id],
    written_by: audited.written_by,
    ts:         Date.now(),
    content,
  } as unknown as AnyBead;
  return auditBead;
}

// ── LoopClosureService ────────────────────────────────────────────────────

export class LoopClosureService {
  constructor(private readonly config: LoopClosureConfig) {}

  // ── Bridge Point 1: openSession ─────────────────────────────────────────

  async openSession(
    orgId:   string,
    roleId:  string,
    agentId: string,
    ns:      string
  ): Promise<Session> {
    // 1. Retrieve knowing-state (fail-closed: catch → autonomyFloor='SUGGEST')
    let autonomyFloor: Autonomy = 'SUGGEST';
    let policyBeadId: string | undefined;
    let trustBeadId: string | undefined;

    try {
      const ks = await this.config.beadGraphDO.retrieveKnowingState(orgId, roleId);
      const policy = ks.policy;
      if (policy) {
        policyBeadId = policy.bead_id;
        const policyContent = policy.content as { autonomy?: Autonomy };
        if (policyContent.autonomy) {
          autonomyFloor = policyContent.autonomy;
        }
      }
      const trust = ks.trustedSubjects[0];
      if (trust) {
        trustBeadId = trust.bead_id;
      }
    } catch {
      autonomyFloor = 'SUGGEST';
    }

    // 2. Get active specification
    const activeSpecificationId = await this.config.artifactGraphDO.getActiveSpecification(ns, roleId);

    // 3. Create session
    const sessionId = crypto.randomUUID();
    const session: Session = {
      sessionId,
      orgId,
      roleId,
      agentId,
      ksRetrievedAt:         Date.now(),
      activeSpecificationId,
      autonomyFloor,
      ...(policyBeadId !== undefined ? { policyBeadId } : {}),
      ...(trustBeadId  !== undefined ? { trustBeadId  } : {}),
    };

    // 4. Persist to KV
    await this.config.kvStore.put(
      `session:${sessionId}`,
      JSON.stringify(session),
      { expirationTtl: 86400 }
    );

    return session;
  }

  // ── Bridge Point 2: recordExecution ─────────────────────────────────────

  async recordExecution(
    sessionId: string,
    payload:   ExecutionContent
  ): Promise<{ executionBeadId: string; executionNodeId: string }> {
    // 1. Read session from KV
    const raw = await this.config.kvStore.get(`session:${sessionId}`);
    if (!raw) throw new Error(`session not found: ${sessionId}`);
    const session = JSON.parse(raw) as Session;

    // 2. Write Execution node to artifact graph — FIRST (INV-LC-003)
    const executionNodeId = generateId('execution');
    await this.config.artifactGraphDO.upsertNode(executionNodeId, 'Execution', {
      session_id: sessionId,
      agent_id:   session.agentId,
      started:    Date.now(),
      domain:     payload.domain,
    });

    // 3. Write governs edge
    await this.config.artifactGraphDO.upsertEdge(
      session.activeSpecificationId,
      executionNodeId,
      'governs'
    );

    // 4. Annotate bead content with bridge field
    const beadContent = addExecutionBridge(
      {
        subject_id:     executionNodeId,
        action:         payload.action,
        autonomy_level: session.autonomyFloor,
        trust_bead_id:  session.trustBeadId ?? '',
        policy_bead_id: session.policyBeadId ?? '',
        rationale:      payload.summary,
      },
      executionNodeId
    );

    // 5. Write ExecutionBead — SECOND (after artifact graph)
    const parentIds = [
      ...(session.policyBeadId ? [session.policyBeadId] : []),
      ...(session.trustBeadId  ? [session.trustBeadId]  : []),
    ];
    const beadId = await this.config.beadGraphDO.computeBeadId('execution', beadContent, parentIds);
    const execBead: AnyBead = {
      bead_id:    beadId,
      org_id:     session.orgId,
      type:       'execution',
      parent_ids: parentIds,
      written_by: session.agentId,
      ts:         Date.now(),
      content:    beadContent,
    } as unknown as AnyBead;

    await this.config.beadGraphDO.writeBead(execBead, buildAuditBead(execBead, sessionId));

    return { executionBeadId: beadId, executionNodeId };
  }

  // ── Bridge Point 3: recordOutcome ────────────────────────────────────────

  async recordOutcome(
    sessionId:       string,
    executionBeadId: string,
    outcome:         OutcomeContent
  ): Promise<{ divergenceId?: string; outcomeBeadId: string }> {
    // 1. Read session
    const raw = await this.config.kvStore.get(`session:${sessionId}`);
    if (!raw) throw new Error(`session not found: ${sessionId}`);
    const session = JSON.parse(raw) as Session;

    // Get executionNodeId from the execution bead content.
    // When called via CoordinatorDO proxy (beadId as sessionId), no prior recordExecution
    // bead exists — write the Execution node inline and use it as the anchor.
    const execBead = await this.config.beadGraphDO.getBead(executionBeadId);
    const execContent = execBead?.content as { artifact_graph_execution_id?: string } | undefined;
    let executionNodeId = execContent?.artifact_graph_execution_id;
    if (!executionNodeId) {
      executionNodeId = generateId('execution');
      await this.config.artifactGraphDO.upsertNode(executionNodeId, 'Execution', {
        session_id: sessionId,
        agent_id:   session.agentId,
        started:    Date.now(),
        domain:     'gears',
      });
      await this.config.artifactGraphDO.upsertEdge(
        session.activeSpecificationId,
        executionNodeId,
        'governs'
      );
    }

    // Write ExecutionTrace node + produces edge
    const traceId = generateId('trace');
    await this.config.artifactGraphDO.upsertNode(traceId, 'ExecutionTrace', {
      session_id:  sessionId,
      tool_calls:  outcome.toolCallCount,
      outcome:     outcome.status,
      summary:     outcome.summary,
    });
    await this.config.artifactGraphDO.upsertEdge(executionNodeId, traceId, 'produces');

    // 2. Detect divergences
    const divergences = await this.config.detectDivergences(
      traceId,
      session.activeSpecificationId,
      this.config.artifactGraphDO
    );

    // 3. If divergences: write Divergence node + edges
    let divergenceId: string | undefined;
    if (divergences.length > 0) {
      const div = divergences[0]!;
      divergenceId = generateId('divergence');
      await this.config.artifactGraphDO.upsertNode(divergenceId, 'Divergence', {
        claim_id:    div.claimId,
        description: div.description,
        severity:    div.severity,
        detected_at: Date.now(),
      });
      await this.config.artifactGraphDO.upsertEdge(traceId, divergenceId, 'evidences');
      await this.config.artifactGraphDO.upsertEdge(traceId, session.activeSpecificationId, 'diverges_from');

      // Push DivergenceNotification to CommissioningAgentDO (non-fatal)
      if (this.config.commissioningAgentDO) {
        void this._pushDivergenceToCA(
          this.config.commissioningAgentDO,
          session.orgId,
          divergenceId,
          session.activeSpecificationId,
          sessionId,
        );
      }
    }

    // 4. Annotate outcome content with divergence bridge field
    const outcomeContent = addDivergenceBridge(
      {
        execution_bead_id:  executionBeadId,
        status:             outcome.status as 'SUCCESS' | 'PARTIAL' | 'FAILURE' | 'DISPUTED',
        summary:            outcome.summary,
        triggers_amendment: divergences.length > 0,
      },
      divergenceId ?? null
    );

    // 5. Write OutcomeBead to bead graph
    const parentIds = [executionBeadId];
    const outcomeBeadId = await this.config.beadGraphDO.computeBeadId('outcome', outcomeContent, parentIds);
    const outcomeBead: AnyBead = {
      bead_id:    outcomeBeadId,
      org_id:     session.orgId,
      type:       'outcome',
      parent_ids: parentIds,
      written_by: session.agentId,
      ts:         Date.now(),
      content:    outcomeContent,
    } as unknown as AnyBead;

    await this.config.beadGraphDO.writeBead(outcomeBead, buildAuditBead(outcomeBead, sessionId));

    return {
      ...(divergenceId !== undefined ? { divergenceId } : {}),
      outcomeBeadId,
    };
  }

  // ── Bridge Point 4: proposeAmendment ─────────────────────────────────────

  async proposeAmendment(
    divergenceId:  string,
    outcomeBeadId: string,
    orgId:         string
  ): Promise<{ amendmentId: string; amendmentBeadId: string }> {
    // 1. Build hypothesis
    const hypothesis = await this.config.buildHypothesis(
      divergenceId,
      this.config.artifactGraphDO
    );

    // 2. Write Hypothesis node + evidence_for edge
    const hypothesisNodeId = generateId('hypothesis');
    await this.config.artifactGraphDO.upsertNode(hypothesisNodeId, 'Hypothesis', {
      fault_attribution: hypothesis.attribution,
      explanation:       hypothesis.explanation,
      confidence:        hypothesis.confidence,
    });
    await this.config.artifactGraphDO.upsertEdge(divergenceId, hypothesisNodeId, 'evidence_for');

    // 3. Write Amendment node (status 'candidate') + motivates + proposes_modification_of edges
    const amendmentNodeId = generateId('amendment');
    await this.config.artifactGraphDO.upsertNode(amendmentNodeId, 'Amendment', {
      proposed_change: hypothesis.proposedChange,
      status:          'candidate',
    });
    await this.config.artifactGraphDO.upsertEdge(hypothesisNodeId, amendmentNodeId, 'motivates');

    // Get activeSpecificationId from divergence context via artifact graph
    // We write proposes_modification_of to the target bead's specification node
    // For domain-agnostic service, we use targetBeadId from hypothesis
    await this.config.artifactGraphDO.upsertEdge(
      amendmentNodeId,
      hypothesis.targetBeadId,
      'proposes_modification_of'
    );

    // 4. Annotate amendment bead content with bridge field
    const amendmentBeadContent = addAmendmentBridge(
      {
        target_bead_id:  hypothesis.targetBeadId,
        target_type:     hypothesis.targetType,
        proposed_change: hypothesis.proposedChange as Record<string, unknown>,
        rationale:       hypothesis.explanation,
        triggered_by:    outcomeBeadId,
        status:          'PENDING' as const,
      },
      amendmentNodeId
    );

    // 5. Write AmendmentBead to bead graph
    const parentIds = [outcomeBeadId];
    const amendmentBeadId = await this.config.beadGraphDO.computeBeadId('amendment', amendmentBeadContent, parentIds);
    const amendmentBead: AnyBead = {
      bead_id:    amendmentBeadId,
      org_id:     orgId,
      type:       'amendment',
      parent_ids: parentIds,
      written_by: 'loop-closure-service',
      ts:         Date.now(),
      content:    amendmentBeadContent,
    } as unknown as AnyBead;

    await this.config.beadGraphDO.writeBead(
      amendmentBead,
      buildAuditBead(amendmentBead, `system-${orgId}`)
    );

    return { amendmentId: amendmentNodeId, amendmentBeadId };
  }

  // ── Bridge Point 5: adoptAmendment ───────────────────────────────────────

  async adoptAmendment(
    amendmentId:        string,
    amendmentBeadId:    string,
    reviewer:           string,
    verificationResult: VerificationResult
  ): Promise<{ newSpecId: string; newBeadId: string } | { rejected: true }> {
    // Step 1: Write VerificationProcess + Verdict nodes and edges
    const vpId      = generateId('verification-process');
    const verdictId = generateId('verdict');

    await this.config.artifactGraphDO.upsertNode(vpId, 'VerificationProcess', {
      gate:         verificationResult.gate,
      evaluated_at: Date.now(),
    });
    await this.config.artifactGraphDO.upsertNode(verdictId, 'Verdict', {
      outcome: verificationResult.passed ? 'favorable' : 'unfavorable',
      gate:    verificationResult.gate,
      score:   verificationResult.score,
    });
    await this.config.artifactGraphDO.upsertEdge(vpId, verdictId, 'produces_verdict');
    await this.config.artifactGraphDO.upsertEdge(amendmentId, vpId, 'subject_to');

    if (!verificationResult.passed) {
      return { rejected: true };
    }

    // Retrieve amendment bead to get target bead info
    const amendBead = await this.config.beadGraphDO.getBead(amendmentBeadId);
    const amendContent = (amendBead?.content ?? {}) as {
      target_bead_id?:   string;
      target_type?:      'trust' | 'policy';
      proposed_change?:  Record<string, unknown>;
      org_id?:           string;
    };

    const orgId = amendBead?.org_id ?? 'unknown';
    const priorBeadId = amendContent.target_bead_id ?? amendmentBeadId;
    const targetType  = amendContent.target_type ?? 'trust';

    // Step 2: Write new Specification node + edges
    const newSpecId = generateId('specification');
    await this.config.artifactGraphDO.upsertNode(newSpecId, 'Specification', {
      artifact_id:  priorBeadId,
      version:      `v-${Date.now()}`,
      content_hash: crypto.randomUUID(),
      explicitness: 'derived',
      source_refs:  [amendmentId],
    });
    await this.config.artifactGraphDO.upsertEdge(newSpecId, priorBeadId, 'version_of');
    await this.config.artifactGraphDO.upsertEdge(amendmentId, newSpecId, 'if_adopted_produces');

    // Step 3a: Write DispositionEvent node (Q-13 resolution — must precede ElucidationArtifact)
    const dispositionEventId = generateId('disposition-event');
    await this.config.artifactGraphDO.upsertNode(dispositionEventId, 'DispositionEvent', {
      occurred_at:  Date.now(),
      context:      'amendment_adoption',
      amendment_id: amendmentId,
    });

    // Step 3b: Write ElucidationArtifact node + produced_at edge — UNCONDITIONAL
    const eaId = generateId('elucidation-artifact');
    const eaContent = addAmendmentBridge(
      {
        selected_option:  amendContent.proposed_change ?? {},
        rejected_options: [],
        assumptions:      [],
        risks_accepted:   [],
      },
      amendmentId
    );
    await this.config.artifactGraphDO.upsertNode(eaId, 'ElucidationArtifact', eaContent);
    await this.config.artifactGraphDO.upsertEdge(eaId, dispositionEventId, 'produced_at');

    // Step 4: Write new TrustBead or PolicyBead + supersedes edge in bead graph
    const newBeadContent = addSpecificationBridge(
      {
        ...(amendContent.proposed_change ?? {}),
        // Required fields for trust beads
        subject_id:   priorBeadId,
        subject_type: targetType,
        status:       'APPROVED' as const,
        trust_score:  1.0,
        rationale:    'adopted via loop closure',
        evidence_refs: [amendmentBeadId],
      },
      newSpecId
    );

    const newBeadParentIds = [priorBeadId];
    const newBeadId = await this.config.beadGraphDO.computeBeadId(targetType, newBeadContent, newBeadParentIds);
    const newBead: AnyBead = {
      bead_id:    newBeadId,
      org_id:     orgId,
      type:       targetType,
      parent_ids: newBeadParentIds,
      written_by: reviewer,
      ts:         Date.now(),
      content:    newBeadContent,
    } as unknown as AnyBead;

    await this.config.beadGraphDO.writeBead(
      newBead,
      buildAuditBead(newBead, `adoption-${amendmentId}`)
    );

    // Step 5: KV invalidation — MUST complete before returning
    const kvPrefix = `ks:${orgId}:`;
    // We list and delete all matching keys for the org
    const kvList = await this.config.kvStore.list({ prefix: kvPrefix });
    await Promise.all(kvList.keys.map(k => this.config.kvStore.delete(k.name)));

    const headPrefix = `head:${orgId}:`;
    const headList = await this.config.kvStore.list({ prefix: headPrefix });
    await Promise.all(headList.keys.map(k => this.config.kvStore.delete(k.name)));

    await this.config.kvStore.delete(`maintenance:${orgId}`);

    // Step 6: Write approved AmendmentBead (status 'APPROVED')
    const approvedAmendContent = {
      ...(amendContent as Record<string, unknown>),
      status:              'APPROVED' as const,
      reviewed_by:         reviewer,
      reviewed_at:         new Date().toISOString(),
      if_approved_produces: newBeadId,
    };
    const approvedAmendBeadId = await this.config.beadGraphDO.computeBeadId('amendment', approvedAmendContent, [amendmentBeadId]);
    const approvedAmendBead: AnyBead = {
      bead_id:    approvedAmendBeadId,
      org_id:     orgId,
      type:       'amendment',
      parent_ids: [amendmentBeadId],
      written_by: reviewer,
      ts:         Date.now(),
      content:    approvedAmendContent,
    } as unknown as AnyBead;

    await this.config.beadGraphDO.writeBead(
      approvedAmendBead,
      buildAuditBead(approvedAmendBead, `adoption-${amendmentId}`)
    );

    return { newSpecId, newBeadId };
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  /**
   * Push a DivergenceNotification to CommissioningAgentDO POST /divergence.
   * Non-fatal — failures are logged but never surfaced to the caller.
   * The DO is addressed by name: `commissioning-agent:{orgId}`.
   */
  private async _pushDivergenceToCA(
    caNamespace:      DurableObjectNamespace,
    orgId:            string,
    divergenceId:     string,
    specificationId:  string,
    runId:            string,
  ): Promise<void> {
    try {
      const id   = caNamespace.idFromName(`commissioning-agent:${orgId}`);
      const stub = caNamespace.get(id);
      const resp = await stub.fetch(
        new Request('https://commissioning-agent/divergence', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ divergenceId, specificationId, runId }),
        }),
      );
      if (!resp.ok) {
        console.warn(
          `[LoopClosureService] CA /divergence push failed: HTTP ${resp.status} for org ${orgId}`,
        );
      }
    } catch (err) {
      console.warn(`[LoopClosureService] CA /divergence push error for org ${orgId}:`, err);
    }
  }
}
