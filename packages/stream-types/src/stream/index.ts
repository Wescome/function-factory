// stream/index.ts - Barrel re-export of WGSP stream types

// Data part types and discriminated union
// Note: EscalationRung is omitted here — the kernel/commonground version is canonical
export type {
  CompensationSubState,
  PendingApproval,
  WorkOrderDataPart,
  PolicyReason,
  PolicyObligation,
  GovernanceDataPart,
  PlanDimensionName,
  PlanDimension,
  PlanValidationDataPart,
  ExecutionPhase,
  ExecutionStep,
  TemporalState,
  ExecutionDataPart,
  EscalationAction,
  EscalationDataPart,
  ToolConsideration,
  ReasoningDataPart,
  DriftSignalCategory,
  DriftDataPart,
  KnowledgeSearchHit,
  KnowledgeSearchDataPart,
  GraphEntity,
  GraphRelationship,
  KnowledgeGraphDataPart,
  CanonicalTermResult,
  TermAliasResult,
  RelatedTermResult,
  KnowledgeOntologyDataPart,
  DecisionStratum,
  DecisionLifecycleStatus,
  DecisionPrincipal,
  DecisionConstraintSummary,
  DecisionSubRef,
  DecisionOutcomeSummary,
  DecisionLifecycleDataPart,
  ModelCostTier,
  ModelLatencyTier,
  BindingBasis,
  ModelEliminationEntry,
  ModelScoringEntry,
  ModelResolutionDataPart,
  WeOpsDataPart,
} from "./data-parts";

// Message types
export type {
  WeOpsMessageMetadata,
  WeOpsMessage,
} from "./message";

// Stream configuration
export type {
  StreamPartMode,
  WeGradientStreamConfig,
} from "./config";

export { default_stream_config } from "./config";
