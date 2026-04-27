// coordination/index.ts - Barrel re-export of all coordination modules

// Workspace (WP-0.11)
export type {
  OwnerType,
  CoordWorkspaceStatus,
  WorkspaceOwner,
  WorkspaceMember,
  ResourceLimits,
  Workspace,
} from "./workspace";
export {
  OWNER_TYPE_VALUES,
  COORD_WORKSPACE_STATUS_VALUES,
  COORD_WORKSPACE_TRANSITIONS,
  validate_coord_workspace_transition,
  validate_governance_upgrade,
} from "./workspace";

// Template (WP-0.12)
export type {
  InfrastructureProfile,
  GovernanceLevelRange,
  ResourceDefaults,
  WorkspaceTemplate,
} from "./template";
export { INFRASTRUCTURE_PROFILE_VALUES } from "./template";

// Product Assembly (WP-0.14)
export type { PricingTier, ProductAssembly } from "./product-assembly";
export { PRICING_TIER_VALUES } from "./product-assembly";

// Domain Context Manifest (WP-0.15)
export type {
  CompensationType,
  CompensationDeclaration,
  Capability,
  EventDeclaration,
  EventSubscription,
  ResourceRequirements,
  DomainContextManifest,
} from "./domain-context";
export { COMPENSATION_TYPE_VALUES } from "./domain-context";

// Bridge (WP-1.09)
export type {
  BridgeRequestStatus,
  RequesterClaims,
  BridgeRequest,
} from "./bridge";
export { BRIDGE_REQUEST_STATUS_VALUES } from "./bridge";

// Router (WP-1.07)
export type {
  ImpactRule,
  RouteDecision,
  RouteResult,
} from "./router";
export {
  DEFAULT_IMPACT_RULES,
  ROUTE_DECISION_VALUES,
  max_governance_level,
  governance_level_gte,
  governance_level_gt,
} from "./router";

// Validators
export {
  validate_workspace,
  validate_template,
  validate_product_assembly,
  validate_domain_context_manifest,
  validate_bridge_request,
} from "./validators";

// Assemblies (WP-1.10)
export {
  CANVAS_ASSEMBLY,
  COGNIFIQ_ASSEMBLY,
  COMMON_GROUND_ASSEMBLY,
  WELLWISH_ASSEMBLY,
  ALL_ASSEMBLIES,
  TPL_CANVAS_PERSONAL,
  TPL_CANVAS_TEAM,
  TPL_COGNIFIQ_TEAM,
  TPL_COGNIFIQ_ENTERPRISE,
  TPL_CG_TEAM,
  TPL_CG_CROSSTEAM,
  TPL_WELLWISH_CARE,
  TPL_WELLWISH_ENTERPRISE,
  ALL_TEMPLATES,
  find_assembly,
  find_template,
  templates_for_assembly,
} from "./assemblies";
