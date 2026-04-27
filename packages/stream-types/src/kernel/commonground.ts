// kernel/commonground.ts - Common Ground domain assembly types
// Mirrors weops-enterprise/pkg/commonground/commonground.go

import type { GovernanceLevel, RiskTier } from "./enums";

// ---------------------------------------------------------------------------
// Assembly identity
// ---------------------------------------------------------------------------
export const CG_ASSEMBLY_ID = "common-ground" as const;
export const CG_ASSEMBLY_VERSION = "1.0.0" as const;
export const CG_KERNEL_MIN_VERSION = "1.3.1" as const;

// ---------------------------------------------------------------------------
// Governance tiers (Common Ground uses G1/G2 only)
// ---------------------------------------------------------------------------
export type CGGovernanceTier = "G1" | "G2";
export const CG_GOVERNANCE_TIER_VALUES = ["G1", "G2"] as const;

// ---------------------------------------------------------------------------
// Workspace status + state machine
// ---------------------------------------------------------------------------
export type WorkspaceStatus = "PROVISIONING" | "ACTIVE" | "SUSPENDED" | "ARCHIVED";
export const WORKSPACE_STATUS_VALUES = ["PROVISIONING", "ACTIVE", "SUSPENDED", "ARCHIVED"] as const;

export const WORKSPACE_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  PROVISIONING: ["ACTIVE"],
  ACTIVE: ["SUSPENDED", "ARCHIVED"],
  SUSPENDED: ["ACTIVE", "ARCHIVED"],
} as const;

export function validate_workspace_transition(from: string, to: string): boolean {
  const allowed = WORKSPACE_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

// ---------------------------------------------------------------------------
// Team roles
// ---------------------------------------------------------------------------
export type TeamRole = "OWNER" | "PARTICIPANT" | "OBSERVER";
export const TEAM_ROLE_VALUES = ["OWNER", "PARTICIPANT", "OBSERVER"] as const;

// ---------------------------------------------------------------------------
// Boundary object status
// ---------------------------------------------------------------------------
export type BOStatus = "DRAFT" | "UNDER_REVIEW" | "APPROVED" | "SUPERSEDED";
export const BO_STATUS_VALUES = ["DRAFT", "UNDER_REVIEW", "APPROVED", "SUPERSEDED"] as const;

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------
export type CGClassification = "PUBLIC" | "INTERNAL" | "RESTRICTED";
export const CG_CLASSIFICATION_VALUES = ["PUBLIC", "INTERNAL", "RESTRICTED"] as const;

// ---------------------------------------------------------------------------
// 3-lane memory
// ---------------------------------------------------------------------------
export type MemoryLane = "COMMON_GROUND" | "TEAM_SCOPED" | "EVIDENCE";
export const MEMORY_LANE_VALUES = ["COMMON_GROUND", "TEAM_SCOPED", "EVIDENCE"] as const;

// ---------------------------------------------------------------------------
// Escalation rungs
// ---------------------------------------------------------------------------
export type EscalationRung = "RUNG_0" | "RUNG_1" | "RUNG_2" | "RUNG_3";
export const ESCALATION_RUNG_VALUES = ["RUNG_0", "RUNG_1", "RUNG_2", "RUNG_3"] as const;

/** RUNG_0 = auto-deny, RUNG_1 = request clarification, RUNG_2 = require Decision Memo, RUNG_3 = route to governance authority */
export const RISK_TO_RUNG_MAPPING: Readonly<Record<string, EscalationRung>> = {
  R0: "RUNG_1",
  R1: "RUNG_2",
  R2: "RUNG_3",
  R3: "RUNG_0",
} as const;

export function assign_escalation_rung(risk_tier: string): EscalationRung | undefined {
  return RISK_TO_RUNG_MAPPING[risk_tier];
}

// ---------------------------------------------------------------------------
// Conflict status
// ---------------------------------------------------------------------------
export type ConflictStatus = "OPEN" | "ESCALATED" | "RESOLVED" | "DENIED";
export const CONFLICT_STATUS_VALUES = ["OPEN", "ESCALATED", "RESOLVED", "DENIED"] as const;

// ---------------------------------------------------------------------------
// Purpose taxonomy — 27 leaf nodes, 3-level naming
// ---------------------------------------------------------------------------
export type CGPurpose =
  // COORD.PM (Project Management) — 3 leaves
  | "COORD.PM.STATUS_REVIEW"
  | "COORD.PM.MILESTONE_PLANNING"
  | "COORD.PM.RISK_TRACKING"
  // COORD.DEC (Decision) — 3 leaves
  | "COORD.DEC.OPTIONS_ANALYSIS"
  | "COORD.DEC.POLICY_REVIEW"
  | "COORD.DEC.ESCALATION_HANDLING"
  // COORD.KM (Knowledge Management) — 3 leaves
  | "COORD.KM.RUNBOOK_AUTHORING"
  | "COORD.KM.POLICY_BUNDLE_UPDATE"
  | "COORD.KM.CASE_DOCUMENTATION"
  // COORD.COMP (Compliance) — 3 leaves
  | "COORD.COMP.AUDIT_PREP"
  | "COORD.COMP.EVIDENCE_REVIEW"
  | "COORD.COMP.CONTROL_ASSESSMENT"
  // OPS.INC (Incident) — 3 leaves
  | "OPS.INC.TRIAGE"
  | "OPS.INC.REMEDIATION"
  | "OPS.INC.POST_MORTEM"
  // OPS.ONB (Onboarding) — 3 leaves
  | "OPS.ONB.VENDOR_ONBOARDING"
  | "OPS.ONB.TEAM_ENROLLMENT"
  | "OPS.ONB.WORKSPACE_PROVISIONING"
  // OPS.RPT (Reporting) — 3 leaves
  | "OPS.RPT.STAKEHOLDER_UPDATE"
  | "OPS.RPT.GOVERNANCE_SUMMARY"
  | "OPS.RPT.EVIDENCE_EXPORT"
  // ANLYS.ASMT (Assessment) — 3 leaves
  | "ANLYS.ASMT.RISK_ASSESSMENT"
  | "ANLYS.ASMT.READINESS_REVIEW"
  | "ANLYS.ASMT.TRADEOFF_ANALYSIS"
  // ANLYS.PLN (Planning) — 3 leaves
  | "ANLYS.PLN.CAPACITY_PLANNING"
  | "ANLYS.PLN.ROADMAP_REVIEW"
  | "ANLYS.PLN.CONSTRAINT_MODELING";

export const CG_PURPOSE_VALUES: readonly CGPurpose[] = [
  "COORD.PM.STATUS_REVIEW",
  "COORD.PM.MILESTONE_PLANNING",
  "COORD.PM.RISK_TRACKING",
  "COORD.DEC.OPTIONS_ANALYSIS",
  "COORD.DEC.POLICY_REVIEW",
  "COORD.DEC.ESCALATION_HANDLING",
  "COORD.KM.RUNBOOK_AUTHORING",
  "COORD.KM.POLICY_BUNDLE_UPDATE",
  "COORD.KM.CASE_DOCUMENTATION",
  "COORD.COMP.AUDIT_PREP",
  "COORD.COMP.EVIDENCE_REVIEW",
  "COORD.COMP.CONTROL_ASSESSMENT",
  "OPS.INC.TRIAGE",
  "OPS.INC.REMEDIATION",
  "OPS.INC.POST_MORTEM",
  "OPS.ONB.VENDOR_ONBOARDING",
  "OPS.ONB.TEAM_ENROLLMENT",
  "OPS.ONB.WORKSPACE_PROVISIONING",
  "OPS.RPT.STAKEHOLDER_UPDATE",
  "OPS.RPT.GOVERNANCE_SUMMARY",
  "OPS.RPT.EVIDENCE_EXPORT",
  "ANLYS.ASMT.RISK_ASSESSMENT",
  "ANLYS.ASMT.READINESS_REVIEW",
  "ANLYS.ASMT.TRADEOFF_ANALYSIS",
  "ANLYS.PLN.CAPACITY_PLANNING",
  "ANLYS.PLN.ROADMAP_REVIEW",
  "ANLYS.PLN.CONSTRAINT_MODELING",
] as const;

/** 3-level taxonomy tree: trunk -> branch -> { leaf -> description } */
export const CG_TAXONOMY: Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, string>>>>>> = {
  COORD: {
    PM: {
      STATUS_REVIEW: "Project status review and reporting",
      MILESTONE_PLANNING: "Milestone definition and planning",
      RISK_TRACKING: "Risk identification and tracking",
    },
    DEC: {
      OPTIONS_ANALYSIS: "Analysis of decision options and tradeoffs",
      POLICY_REVIEW: "Review of policy compliance and alignment",
      ESCALATION_HANDLING: "Escalation routing and resolution",
    },
    KM: {
      RUNBOOK_AUTHORING: "Runbook creation and maintenance",
      POLICY_BUNDLE_UPDATE: "Policy bundle creation and updates",
      CASE_DOCUMENTATION: "Case documentation and summaries",
    },
    COMP: {
      AUDIT_PREP: "Audit preparation and evidence assembly",
      EVIDENCE_REVIEW: "Evidence bundle review and validation",
      CONTROL_ASSESSMENT: "Control effectiveness assessment",
    },
  },
  OPS: {
    INC: {
      TRIAGE: "Incident triage and classification",
      REMEDIATION: "Incident remediation execution",
      POST_MORTEM: "Post-mortem analysis and learning",
    },
    ONB: {
      VENDOR_ONBOARDING: "Vendor onboarding process",
      TEAM_ENROLLMENT: "Team enrollment into workspaces",
      WORKSPACE_PROVISIONING: "Workspace provisioning and setup",
    },
    RPT: {
      STAKEHOLDER_UPDATE: "Stakeholder status updates and communication",
      GOVERNANCE_SUMMARY: "Governance posture summary reporting",
      EVIDENCE_EXPORT: "Evidence export for external audit",
    },
  },
  ANLYS: {
    ASMT: {
      RISK_ASSESSMENT: "Risk assessment and scoring",
      READINESS_REVIEW: "Readiness evaluation for milestones",
      TRADEOFF_ANALYSIS: "Tradeoff analysis across options",
    },
    PLN: {
      CAPACITY_PLANNING: "Resource capacity planning",
      ROADMAP_REVIEW: "Roadmap review and alignment",
      CONSTRAINT_MODELING: "Constraint modeling and simulation",
    },
  },
} as const;

const _validCGPurposes = new Set<string>(CG_PURPOSE_VALUES);

export function validate_cg_purpose(p: string): p is CGPurpose {
  return _validCGPurposes.has(p);
}

export function list_cg_trunks(): string[] {
  return Object.keys(CG_TAXONOMY);
}

export function list_cg_branches(trunk: string): string[] | undefined {
  const branches = CG_TAXONOMY[trunk];
  if (!branches) return undefined;
  return Object.keys(branches);
}

export function list_cg_leaves(trunk: string, branch: string): string[] | undefined {
  const branches = CG_TAXONOMY[trunk];
  if (!branches) return undefined;
  const leaves = branches[branch];
  if (!leaves) return undefined;
  return Object.keys(leaves);
}

export function get_cg_description(purpose: string): string | undefined {
  const parts = purpose.split(".");
  if (parts.length !== 3) return undefined;
  const [trunk, branch, leaf] = parts;
  if (!trunk || !branch || !leaf) return undefined;
  return CG_TAXONOMY[trunk]?.[branch]?.[leaf];
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TeamEnrollment {
  readonly team_id: string;
  readonly role: TeamRole;
  readonly enrolled_at: string;
  readonly policy_bundle_ref?: string;
}

export interface CGWorkspace {
  readonly workspace_id: string;
  readonly display_name: string;
  readonly primary_purpose: CGPurpose;
  readonly governance_tier: CGGovernanceTier;
  readonly status: WorkspaceStatus;
  readonly owner_team: string;
  readonly enrolled_teams: readonly TeamEnrollment[];
  readonly purpose_taxonomy_version: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly evidence_refs?: readonly string[];
}

export interface ConflictConstraint {
  readonly constraint_id: string;
  readonly issuing_team: string;
  readonly policy_bundle_ref: string;
  readonly human_readable_text: string;
  readonly affected_action_classes: readonly string[];
}

export interface ConflictRecord {
  readonly collision_id: string;
  readonly work_order_id: string;
  readonly detection_timestamp: string;
  readonly conflicting_constraints: readonly ConflictConstraint[];
  readonly escalation_rung: EscalationRung;
  readonly resolution_ref?: string;
  readonly status: ConflictStatus;
  readonly evidence_ref: string;
}

export interface ModuleManifest {
  readonly module_id: string;
  readonly responsibility: string;
  readonly tools: readonly string[];
  readonly compensation_strategy: string;
}

/** The 8 AOMA modules that compose the Common Ground assembly */
export const CG_ASSEMBLY_MANIFEST: readonly ModuleManifest[] = [
  {
    module_id: "cg-workspace-mgr",
    responsibility: "Workspace lifecycle management (create, provision, suspend, archive)",
    tools: ["workspace_create", "workspace_provision", "workspace_suspend", "workspace_archive"],
    compensation_strategy: "revert_to_previous_status",
  },
  {
    module_id: "cg-team-enrollment",
    responsibility: "Team enrollment and role management within workspaces",
    tools: ["team_enroll", "team_unenroll", "team_role_update"],
    compensation_strategy: "unenroll_team",
  },
  {
    module_id: "cg-boundary-obj-mgr",
    responsibility: "Boundary object CRUD and versioning (CB-01 through CB-04)",
    tools: ["bo_create", "bo_update", "bo_approve", "bo_supersede"],
    compensation_strategy: "revert_to_predecessor_version",
  },
  {
    module_id: "cg-conflict-detector",
    responsibility: "Constraint conflict detection across policy bundles",
    tools: ["conflict_detect", "conflict_analyze"],
    compensation_strategy: "log_and_escalate",
  },
  {
    module_id: "cg-escalation-engine",
    responsibility: "Escalation ladder management and rung routing",
    tools: ["escalation_route", "escalation_resolve", "escalation_deny"],
    compensation_strategy: "reset_to_previous_rung",
  },
  {
    module_id: "cg-memory-lane-mgr",
    responsibility: "3-lane memory management (common ground, team-scoped, evidence)",
    tools: ["memory_write", "memory_read", "memory_promote", "memory_classify"],
    compensation_strategy: "soft_delete_entry",
  },
  {
    module_id: "cg-purpose-binder",
    responsibility: "Purpose taxonomy validation and access binding",
    tools: ["purpose_validate", "purpose_bind", "purpose_audit"],
    compensation_strategy: "revoke_binding",
  },
  {
    module_id: "cg-evidence-collector",
    responsibility: "Evidence collection and reference management for audit trails",
    tools: ["evidence_collect", "evidence_link", "evidence_export"],
    compensation_strategy: "mark_evidence_invalidated",
  },
] as const;
