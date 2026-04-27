// coordination/validators.ts - Validation functions for coordination types

import type { Workspace } from "./workspace";
import type { WorkspaceTemplate } from "./template";
import type { ProductAssembly } from "./product-assembly";
import type { DomainContextManifest } from "./domain-context";
import type { BridgeRequest } from "./bridge";
import { OWNER_TYPE_VALUES, COORD_WORKSPACE_STATUS_VALUES, validate_governance_upgrade } from "./workspace";
import { INFRASTRUCTURE_PROFILE_VALUES } from "./template";
import { PRICING_TIER_VALUES } from "./product-assembly";
import { BRIDGE_REQUEST_STATUS_VALUES } from "./bridge";
import { GOVERNANCE_LEVEL_VALUES, DOMAIN_CONTEXT_ID_VALUES, ROLE_VALUES, ISOLATION_LEVEL_VALUES } from "../kernel/enums";
import { WORKSPACE_ID_PATTERN, BRIDGE_REQUEST_ID_PATTERN } from "../kernel/ids";

export function validate_workspace(w: Workspace): string[] {
  const errors: string[] = [];
  if (!w.workspace_id || !WORKSPACE_ID_PATTERN.test(w.workspace_id)) errors.push("workspace_id must match ^ws_[a-z0-9_]+$");
  if (!w.owner || !(OWNER_TYPE_VALUES as readonly string[]).includes(w.owner.owner_type)) errors.push("owner.owner_type must be USER, TEAM, or ORGANIZATION");
  if (!w.owner?.owner_id) errors.push("owner.owner_id is required");
  if (!(GOVERNANCE_LEVEL_VALUES as readonly string[]).includes(w.governance_level)) errors.push("governance_level must be G0-G3");
  if (!(ISOLATION_LEVEL_VALUES as readonly string[]).includes(w.isolation_level)) errors.push("isolation_level must be PROCESS, CONTAINER, NETWORK, or CRYPTOGRAPHIC");
  if (!(COORD_WORKSPACE_STATUS_VALUES as readonly string[]).includes(w.status)) errors.push("status must be PROVISIONING, ACTIVE, SUSPENDED, or ARCHIVED");
  if (!Array.isArray(w.domain_contexts) || w.domain_contexts.length === 0) errors.push("domain_contexts must have at least one entry");
  for (const dc of w.domain_contexts ?? []) {
    if (!(DOMAIN_CONTEXT_ID_VALUES as readonly string[]).includes(dc)) errors.push(`invalid domain_context: ${dc}`);
  }
  for (const m of w.members ?? []) {
    if (!m.member_id) errors.push("member.member_id is required");
    if (!(ROLE_VALUES as readonly string[]).includes(m.role)) errors.push(`invalid member role: ${m.role}`);
  }
  if (!w.created_at) errors.push("created_at is required");
  if (w.schema_version !== "1.0.0") errors.push("schema_version must be 1.0.0");
  return errors;
}

export function validate_template(t: WorkspaceTemplate): string[] {
  const errors: string[] = [];
  if (!t.template_id || !/^tpl_[a-z0-9_]+$/.test(t.template_id as string)) {
    errors.push("template_id must match ^tpl_[a-z0-9_]+$");
  }
  if (!t.template_name) errors.push("template_name is required");
  if (!(GOVERNANCE_LEVEL_VALUES as readonly string[]).includes(t.governance_level)) errors.push("governance_level must be G0-G3");
  if (!Array.isArray(t.domain_contexts) || t.domain_contexts.length === 0) errors.push("domain_contexts must have at least one entry");
  for (const dc of t.domain_contexts ?? []) {
    if (!(DOMAIN_CONTEXT_ID_VALUES as readonly string[]).includes(dc)) errors.push(`invalid domain_context: ${dc}`);
  }
  if (!(INFRASTRUCTURE_PROFILE_VALUES as readonly string[]).includes(t.infrastructure_profile)) errors.push("infrastructure_profile must be LOCAL_SQLITE, MANAGED_PG, ISOLATED_VPC, or FEDRAMP_HSM");
  if (!t.version || !/^\d+\.\d+\.\d+$/.test(t.version)) errors.push("version must be semver");
  if (t.schema_version !== "1.0.0") errors.push("schema_version must be 1.0.0");
  if (t.governance_level_range) {
    if (!validate_governance_upgrade(t.governance_level_range.min, t.governance_level_range.max)) {
      errors.push("governance_level_range.min must be <= max");
    }
  }
  return errors;
}

export function validate_product_assembly(a: ProductAssembly): string[] {
  const errors: string[] = [];
  if (!a.assembly_id || !/^asm_[a-z0-9_]+$/.test(a.assembly_id as string)) errors.push("assembly_id must match ^asm_[a-z0-9_]+$");
  if (!a.product_name) errors.push("product_name is required");
  if (!Array.isArray(a.templates) || a.templates.length === 0) errors.push("templates must have at least one entry");
  if (!Array.isArray(a.domain_contexts)) errors.push("domain_contexts is required");
  for (const dc of a.domain_contexts ?? []) {
    if (!(DOMAIN_CONTEXT_ID_VALUES as readonly string[]).includes(dc)) errors.push(`invalid domain_context: ${dc}`);
  }
  if (!a.governance_range) {
    errors.push("governance_range is required");
  } else if (!validate_governance_upgrade(a.governance_range.min, a.governance_range.max)) {
    errors.push("governance_range.min must be <= max");
  }
  if (a.pricing_tier && !(PRICING_TIER_VALUES as readonly string[]).includes(a.pricing_tier)) errors.push("invalid pricing_tier");
  if (!a.version || !/^\d+\.\d+\.\d+$/.test(a.version)) errors.push("version must be semver");
  if (a.schema_version !== "1.0.0") errors.push("schema_version must be 1.0.0");
  return errors;
}

export function validate_domain_context_manifest(m: DomainContextManifest): string[] {
  const errors: string[] = [];
  if (!m.context_id || !(DOMAIN_CONTEXT_ID_VALUES as readonly string[]).includes(m.context_id)) errors.push("context_id must be a valid two-letter domain context ID");
  if (!m.context_name) errors.push("context_name is required");
  if (!Array.isArray(m.capabilities)) errors.push("capabilities is required");
  for (const cap of m.capabilities ?? []) {
    if (!cap.capability_id) errors.push("capability.capability_id is required");
    if (!cap.tool_schema_ref) errors.push("capability.tool_schema_ref is required");
  }
  if (!Array.isArray(m.events_published)) errors.push("events_published is required");
  if (!Array.isArray(m.events_consumed)) errors.push("events_consumed is required");
  if (!m.version || !/^\d+\.\d+\.\d+$/.test(m.version)) errors.push("version must be semver");
  if (m.schema_version !== "1.0.0") errors.push("schema_version must be 1.0.0");
  return errors;
}

export function validate_bridge_request(b: BridgeRequest): string[] {
  const errors: string[] = [];
  if (!b.bridge_request_id || !BRIDGE_REQUEST_ID_PATTERN.test(b.bridge_request_id as string)) errors.push("bridge_request_id must match ^brq_[a-z0-9]{16}$");
  if (!b.source_workspace_id || !WORKSPACE_ID_PATTERN.test(b.source_workspace_id as string)) errors.push("source_workspace_id must match ^ws_[a-z0-9_]+$");
  if (!b.target_workspace_id || !WORKSPACE_ID_PATTERN.test(b.target_workspace_id as string)) errors.push("target_workspace_id must match ^ws_[a-z0-9_]+$");
  if (b.source_workspace_id === b.target_workspace_id) errors.push("source and target workspace must be different");
  if (!b.requested_object_type) errors.push("requested_object_type is required");
  if (!b.requested_object_id) errors.push("requested_object_id is required");
  if (!b.purpose) errors.push("purpose is required");
  if (!b.requester_claims?.actor) errors.push("requester_claims.actor is required");
  if (!(BRIDGE_REQUEST_STATUS_VALUES as readonly string[]).includes(b.status)) errors.push("status must be PENDING, APPROVED, DENIED, or EXPIRED");
  if (!b.created_at) errors.push("created_at is required");
  if (b.schema_version !== "1.0.0") errors.push("schema_version must be 1.0.0");
  return errors;
}
