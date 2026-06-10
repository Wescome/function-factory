import { z } from 'zod';
import { CORE_NODE_TYPES, CORE_REL_TYPES } from '@factory/artifact-graph';
import { BaseBead } from '@factory/bead-graph';
import { AmendmentStatus } from '@factory/bead-graph';

// ── Node types ────────────────────────────────────────────────────────────

export const FACTORY_NODE_TYPES = [
  ...CORE_NODE_TYPES,

  // Pipeline artifact stages
  'Signal',            // Stage 1 — external signal (SIG-*)
  'Pressure',          // Stage 2 — PRS-* forcing function
  'Capability',        // Stage 3 — BC-* capability spec
  'FunctionProposal',  // Stage 4 — FP-* function proposal
  'PRD',               // Stage 5 input — PRD-*
  'WorkGraph',         // Stage 5 output — WG-* compiled executable spec
  'Invariant',         // INV-* detector spec
  'CoverageReport',    // CR-* gate output (Gate 1/2/3)

  // Runtime governance
  'AtomDirective',     // compiled substrate-ready directive (per WorkGraph atom)
  'TraceFragment',     // per-atom execution result
] as const;

export type FactoryNodeType = (typeof FACTORY_NODE_TYPES)[number];

// ── Relation types ─────────────────────────────────────────────────────────

export const FACTORY_REL_TYPES = [
  ...CORE_REL_TYPES,

  // Pipeline lineage
  'source_ref',       // any artifact → upstream artifact (MECH-FF-3 lineage edge)
  'compiles_to',      // PRD → WorkGraph
  'instantiates',     // FunctionProposal → Capability
  'addresses',        // Capability → Pressure
  'derived_from',     // Pressure → Signal

  // Runtime
  'dispatched_as',    // WorkGraph atom → AtomDirective
  'produced_trace',   // AtomDirective → TraceFragment
  'gate_result',      // WorkGraph → CoverageReport (Gate 1/2/3)
] as const;

export type FactoryRelType = (typeof FACTORY_REL_TYPES)[number];

// ── Supporting Zod schemas (used inside Bead schemas) ─────────────────────

const AtomDirective = z.object({
  atom_id:     z.string(),
  description: z.string().optional(),
  tool_set:    z.array(z.string()).optional(),
  constraints: z.record(z.unknown()).optional(),
});

const DetectorSpec = z.object({
  inv_id:   z.string(),
  rule:     z.string(),
  severity: z.string(),
});

const DetectorFiring = z.object({
  inv_id:   z.string(),
  severity: z.string(),
  message:  z.string(),
});

// ── BuildOutcomeStatus ────────────────────────────────────────────────────

export const BuildOutcomeStatus = z.enum(['success', 'failure', 'timeout', 'partial']);
export type BuildOutcomeStatus = z.infer<typeof BuildOutcomeStatus>;

// ── Factory Bead Schemas ──────────────────────────────────────────────────

// 6.1 ArchitectureDecisionBead (PolicyBead)
export const ArchitectureDecisionBead = BaseBead.extend({
  type: z.literal('arch_decision'),
  content: z.object({
    repo_id:              z.string(),
    work_graph_id:        z.string(),
    work_graph_version:   z.string(),
    atoms:                z.array(AtomDirective),
    detector_specs:       z.array(DetectorSpec),
    agents_md:            z.string(),
    source_refs:          z.array(z.string()),
    autonomy:             z.enum(['SUGGEST', 'PROPOSE', 'EXECUTE_BOUNDED', 'EXECUTE_FULL']),
    committed_at:         z.string(),
    artifact_graph_specification_id: z.string().optional(),
  }),
});
export type ArchitectureDecisionBead = z.infer<typeof ArchitectureDecisionBead>;

// 6.2 PatternTrustBead (TrustBead)
export const PatternTrustBead = BaseBead.extend({
  type: z.literal('pattern_trust'),
  content: z.object({
    repo_id:              z.string(),
    work_graph_id:        z.string(),
    coherence_verdict:    z.enum(['favorable', 'unfavorable', 'pending']),
    fidelity_verdict:     z.enum(['favorable', 'unfavorable', 'pending']),
    coherence_score:      z.number().min(0).max(1).optional(),
    fidelity_score:       z.number().min(0).max(1).optional(),
    open_divergences:     z.array(z.string()),
    last_verified_at:     z.string(),
    artifact_graph_specification_id: z.string().optional(),
  }),
});
export type PatternTrustBead = z.infer<typeof PatternTrustBead>;

// 6.3 CommitBead (ExecutionBead)
export const CommitBead = BaseBead.extend({
  type: z.literal('commit'),
  content: z.object({
    repo_id:              z.string(),
    atom_id:              z.string(),
    atom_directive:       AtomDirective,
    session_id:           z.string(),
    attempt:              z.number(),
    dispatched_at:        z.string(),
    autonomy_level:       z.enum(['SUGGEST', 'PROPOSE', 'EXECUTE_BOUNDED', 'EXECUTE_FULL']),
    arch_decision_bead_id: z.string(),
    artifact_graph_execution_id: z.string().optional(),
  }),
});
export type CommitBead = z.infer<typeof CommitBead>;

// 6.4 BuildOutcomeBead (OutcomeBead)
export const BuildOutcomeBead = BaseBead.extend({
  type: z.literal('build_outcome'),
  content: z.object({
    repo_id:              z.string(),
    commit_bead_id:       z.string(),
    atom_id:              z.string(),
    status:               BuildOutcomeStatus,
    duration_ms:          z.number(),
    exit_code:            z.number().optional(),
    detector_firings:     z.array(DetectorFiring),
    triggers_amendment:   z.boolean(),
    divergence_severity:  z.enum(['blocking', 'advisory', 'informational']).optional(),
    artifact_graph_divergence_id: z.string().optional(),
  }),
});
export type BuildOutcomeBead = z.infer<typeof BuildOutcomeBead>;

// 6.5 ArchAmendmentBead (AmendmentBead)
export const ArchAmendmentBead = BaseBead.extend({
  type: z.literal('arch_amendment'),
  content: z.object({
    repo_id:              z.string(),
    target_bead_id:       z.string(),
    target_type:          z.enum(['arch_decision', 'pattern_trust']),
    proposed_change:      z.record(z.unknown()),
    rationale:            z.string(),
    triggered_by:         z.string(),
    status:               AmendmentStatus,
    reviewed_by:          z.string().optional(),
    reviewed_at:          z.string().optional(),
    if_approved_produces: z.string().optional(),
    escalated_to_we_layer: z.boolean().default(false),
    artifact_graph_amendment_id: z.string().optional(),
  }),
});
export type ArchAmendmentBead = z.infer<typeof ArchAmendmentBead>;

// ── TraceFragmentData (internal helper type for factoryDivergenceDetector) ─

export interface DetectorFiringData {
  inv_id:   string;
  severity: string;
  message:  string;
}

export interface TraceFragmentData {
  atom_id:            string;
  outcome:            string;
  attempts_exhausted: boolean;
  detector_firings:   DetectorFiringData[];
}
