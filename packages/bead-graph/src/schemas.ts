import { z } from 'zod';

// ── Base ──────────────────────────────────────────────────────────────────

export const BaseBead = z.object({
  bead_id:    z.string(),           // content hash
  org_id:     z.string(),
  type:       z.string(),
  parent_ids: z.array(z.string()),  // sorted; empty for root beads
  written_by: z.string(),
  ts:         z.number(),           // epoch ms
});

export type BaseBead = z.infer<typeof BaseBead>;

// ── PolicyBead (domain instantiation maps this to e.g. OrgPreferenceBead) ─

export const PolicyBead = BaseBead.extend({
  type: z.literal('policy'),
  content: z.object({
    scope:       z.string(),                          // e.g. 'org' | 'role' | 'category'
    rules:       z.record(z.unknown()),               // domain-specific policy content
    autonomy:    z.enum(['SUGGEST', 'PROPOSE', 'EXECUTE_BOUNDED', 'EXECUTE_FULL']),
    effective_at: z.string(),                         // ISO8601
    expires_at:   z.string().optional(),
  }),
});

export type PolicyBead = z.infer<typeof PolicyBead>;

// ── TrustBead (domain: VendorTrustBead, ClinicalGuidelineBead, etc.) ──────

export const TrustStatus = z.enum(['PENDING', 'APPROVED', 'SUSPENDED', 'REVOKED']);
export type TrustStatus = z.infer<typeof TrustStatus>;

export const TrustBead = BaseBead.extend({
  type: z.literal('trust'),
  content: z.object({
    subject_id:   z.string(),         // vendor_id | guideline_id | dependency_id
    subject_type: z.string(),         // domain-specific subject category
    status:       TrustStatus,
    trust_score:  z.number().min(0).max(1),
    rationale:    z.string(),
    evidence_refs: z.array(z.string()),  // bead_ids or external refs
    expiry:       z.string().optional(), // ISO8601
  }),
});

export type TrustBead = z.infer<typeof TrustBead>;

// ── ExecutionBead (domain: PurchaseBead, CommitBead, etc.) ────────────────

export const ExecutionBead = BaseBead.extend({
  type: z.literal('execution'),
  content: z.object({
    subject_id:     z.string(),       // what was acted upon
    action:         z.string(),       // domain-specific action type
    autonomy_level: z.enum(['SUGGEST', 'PROPOSE', 'EXECUTE_BOUNDED', 'EXECUTE_FULL']),
    trust_bead_id:  z.string(),       // TrustBead referenced at time of execution
    policy_bead_id: z.string(),       // PolicyBead governing this execution
    rationale:      z.string(),
    artifact_graph_execution_id: z.string().optional(), // loop closure: links to ArtifactGraph Execution node
  }),
});

export type ExecutionBead = z.infer<typeof ExecutionBead>;

// ── OutcomeBead ───────────────────────────────────────────────────────────

export const OutcomeStatus = z.enum(['SUCCESS', 'PARTIAL', 'FAILURE', 'DISPUTED']);
export type OutcomeStatus = z.infer<typeof OutcomeStatus>;

export const OutcomeBead = BaseBead.extend({
  type: z.literal('outcome'),
  content: z.object({
    execution_bead_id: z.string(),    // ExecutionBead this closes
    status:            OutcomeStatus,
    summary:           z.string(),
    metrics:           z.record(z.unknown()).optional(),
    triggers_amendment: z.boolean(),  // if true, AmendmentBead should follow
    artifact_graph_divergence_id: z.string().optional(), // loop closure: links to Divergence node
  }),
});

export type OutcomeBead = z.infer<typeof OutcomeBead>;

// ── AmendmentBead ─────────────────────────────────────────────────────────

export const AmendmentStatus = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED']);
export type AmendmentStatus = z.infer<typeof AmendmentStatus>;

export const AmendmentBead = BaseBead.extend({
  type: z.literal('amendment'),
  content: z.object({
    target_bead_id:    z.string(),    // TrustBead or PolicyBead being amended
    target_type:       z.enum(['trust', 'policy']),
    proposed_change:   z.record(z.unknown()), // JSON patch of content fields
    rationale:         z.string(),
    triggered_by:      z.string(),    // OutcomeBead._id or 'human'
    status:            AmendmentStatus,
    reviewed_by:       z.string().optional(),
    reviewed_at:       z.string().optional(),
    if_approved_produces: z.string().optional(), // new TrustBead bead_id
    artifact_graph_amendment_id: z.string().optional(), // loop closure: links to Amendment node
  }),
});

export type AmendmentBead = z.infer<typeof AmendmentBead>;

// ── ConsentBead ───────────────────────────────────────────────────────────

export const ConsentBead = BaseBead.extend({
  type: z.literal('consent'),
  content: z.object({
    role_id:     z.string(),
    grants:      z.array(z.string()),  // permitted action types / tool names
    status:      z.enum(['ACTIVE', 'REVOKED']),
    granted_by:  z.string(),
    granted_at:  z.string(),
    expires_at:  z.string().optional(),
    revokes:     z.string().optional(), // bead_id of ConsentBead being superseded
  }),
});

export type ConsentBead = z.infer<typeof ConsentBead>;

// ── EscalationBead ────────────────────────────────────────────────────────

export const EscalationBead = BaseBead.extend({
  type: z.literal('escalation'),
  content: z.object({
    trigger_bead_id:  z.string(),    // ExecutionBead or OutcomeBead that triggered this
    reason:           z.string(),
    escalated_to:     z.string(),    // user_id or role_id
    resolved_at:      z.string().optional(),
    resolution:       z.string().optional(),
    resolution_bead_id: z.string().optional(), // AmendmentBead._id if triggered
  }),
});

export type EscalationBead = z.infer<typeof EscalationBead>;

// ── AuditBead (written in every transaction — INV-BG-007) ─────────────────

export const AuditBead = BaseBead.extend({
  type: z.literal('audit'),
  content: z.object({
    audited_bead_id: z.string(),     // the Bead this audits
    audited_type:    z.string(),
    action:          z.enum(['CREATE', 'SUPERSEDE', 'ESCALATE', 'CONSENT_GRANT', 'CONSENT_REVOKE']),
    actor_id:        z.string(),
    session_id:      z.string(),
    ts:              z.number(),
  }),
});

export type AuditBead = z.infer<typeof AuditBead>;

// ── Union type ─────────────────────────────────────────────────────────────

export const AnyBead = z.discriminatedUnion('type', [
  PolicyBead, TrustBead, ExecutionBead, OutcomeBead,
  AmendmentBead, ConsentBead, EscalationBead, AuditBead,
]);

export type AnyBead = z.infer<typeof AnyBead>;

// ── Content types exported for SDK use ───────────────────────────────────

export type PolicyBeadContent = PolicyBead['content'];
export type TrustBeadContent = TrustBead['content'];
export type ExecutionBeadContent = ExecutionBead['content'];
export type OutcomeBeadContent = OutcomeBead['content'];
export type AmendmentBeadContent = AmendmentBead['content'];
export type ConsentBeadContent = ConsentBead['content'];
export type EscalationBeadContent = EscalationBead['content'];
export type AuditBeadContent = AuditBead['content'];

export type Autonomy = 'SUGGEST' | 'PROPOSE' | 'EXECUTE_BOUNDED' | 'EXECUTE_FULL';
