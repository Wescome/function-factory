// Core spec-execution ontology types (§3.1–§3.15)
export const CORE_NODE_TYPES = [
  'Specification',       // §3.2 — formalizes a knowing-state
  'Claim',               // §3.3 — atomic assertion within a Specification
  'Execution',           // §3.4 — actual unfolding of activity
  'ExecutionTrace',      // §3.5 — record of aspects of an Execution
  'VerificationProcess', // §3.7 — realization of a VerificationFunction
  'Verdict',             // §3.8 — outcome of a VerificationProcess
  'Divergence',          // §3.9 — trace-spec non-conformance
  'Hypothesis',          // §3.10 — explanation for a Divergence
  'Amendment',           // §3.11 — proposed modification to a Specification
  'Agent',               // §3.12 — executing or maintaining agent
  'KnowingState',        // §3.1 — mental quality borne by an agent
  'DispositionEvent',    // §4B.4 — moment of possibility-space collapse
  'CandidateSet',        // §3.14 — pre-collapse option collection
  'ElucidationArtifact', // §3.15 — anti-collapse record
] as const;

export type CoreNodeType = typeof CORE_NODE_TYPES[number];

// Domain instantiations extend: type DomainNodeType = CoreNodeType | 'MyDomainType'
export type NodeType = string;

export const CORE_REL_TYPES = [
  // Specification lifecycle
  'version_of',               // Specification → Specification (successor → predecessor)
  'composed_of',              // Specification → Claim
  'formalizes',               // Specification → KnowingState
  'governs',                  // Specification → Execution (conditional)

  // Execution chain
  'produces',                 // Execution → ExecutionTrace
  'governed_by',              // Execution → Specification

  // Divergence chain
  'evidences',                // ExecutionTrace → Divergence
  'diverges_from',            // ExecutionTrace → Specification
  'concerns',                 // Divergence → Claim

  // Amendment loop
  'evidence_for',             // Divergence → Hypothesis
  'explains',                 // Hypothesis → Divergence
  'motivates',                // Hypothesis → Amendment
  'if_adopted_produces',      // Amendment → Specification
  'proposes_modification_of', // Amendment → Specification
  'subject_to',               // Amendment → VerificationProcess

  // Verification
  'produces_verdict',         // VerificationProcess → Verdict
  'borne_by',                 // Verdict → entity

  // Elucidation
  'produced_at',              // ElucidationArtifact → DispositionEvent
  'records_candidate_set',    // ElucidationArtifact → CandidateSet
  'records_selected_option',  // ElucidationArtifact → node
  'informs',                  // ElucidationArtifact → Hypothesis

  // Provenance
  'created_by',               // any node → Agent
  'corrects',                 // new node → prior node (correction lineage)
] as const;

export type CoreRelType = typeof CORE_REL_TYPES[number];
export type RelType = string;

export interface ArtifactNode {
  id: string;
  type: NodeType;
  data: Record<string, unknown>;
  ns: string;
  created: number;
  updated: number;
}

export interface ArtifactEdge {
  id: string;
  source: string;
  target: string;
  rel: RelType;
  props: Record<string, unknown>;
  created: number;
}

// Traversal result contracts
export interface LineageChain {
  nodes: ArtifactNode[]; // ordered: from start node → root ancestor
  depth: number;
}

export interface PathResult {
  path: ArtifactNode[];
  edges: ArtifactEdge[];
}

export interface PathStep {
  rel: RelType;
  targetType?: string; // optional type filter on the target node
}

// Generic domain extension points
export interface DomainConfig {
  namespace: string;                       // e.g. 'factory:org-abc:pipeline-1'
  nodeTypes: readonly string[];            // domain-specific additions to core
  relTypes: readonly string[];             // domain-specific additions to core
  contentHashedTypes?: readonly string[];  // types that use content-addressed IDs
}
