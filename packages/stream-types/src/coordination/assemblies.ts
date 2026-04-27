// coordination/assemblies.ts - Product assembly definitions and workspace templates (WP-1.10)

import type { ProductAssembly } from "./product-assembly";
import type { WorkspaceTemplate } from "./template";
import type { AssemblyID, TemplateID } from "../kernel/ids";

// ---------------------------------------------------------------------------
// Product Assemblies (WP-1.10 initial data)
// ---------------------------------------------------------------------------

export const CANVAS_ASSEMBLY: ProductAssembly = {
  assembly_id: "asm_canvas" as AssemblyID,
  product_name: "Canvas.ceo",
  product_description: "Design & Creative Intelligence",
  templates: ["tpl_canvas_personal", "tpl_canvas_team"],
  domain_contexts: ["DA", "DI", "SM", "RE"],
  governance_range: { min: "G0", max: "G1" },
  pricing_tier: "FREE",
  version: "1.0.0",
  schema_version: "1.0.0",
};

export const COGNIFIQ_ASSEMBLY: ProductAssembly = {
  assembly_id: "asm_cognifiq" as AssemblyID,
  product_name: "Cognifiq",
  product_description: "Enterprise Cognitive Platform",
  templates: ["tpl_cognifiq_team", "tpl_cognifiq_enterprise"],
  domain_contexts: ["DA", "DI", "CC", "RA", "RE"],
  governance_range: { min: "G2", max: "G3" },
  pricing_tier: "ENTERPRISE",
  version: "1.0.0",
  schema_version: "1.0.0",
};

export const COMMON_GROUND_ASSEMBLY: ProductAssembly = {
  assembly_id: "asm_common_ground" as AssemblyID,
  product_name: "Common Ground",
  product_description: "Coordination Substrate",
  templates: ["tpl_cg_team", "tpl_cg_crossteam"],
  domain_contexts: ["IC", "OR", "ME", "RE"],
  governance_range: { min: "G1", max: "G2" },
  pricing_tier: "TEAM",
  version: "1.0.0",
  schema_version: "1.0.0",
};

export const WELLWISH_ASSEMBLY: ProductAssembly = {
  assembly_id: "asm_wellwish" as AssemblyID,
  product_name: "WellWish",
  product_description: "Care Coordination",
  templates: ["tpl_wellwish_care", "tpl_wellwish_enterprise"],
  domain_contexts: ["IC", "OR", "ME", "RE"],
  governance_range: { min: "G2", max: "G3" },
  pricing_tier: "ENTERPRISE",
  version: "1.0.0",
  schema_version: "1.0.0",
};

export const ALL_ASSEMBLIES: readonly ProductAssembly[] = [
  CANVAS_ASSEMBLY,
  COGNIFIQ_ASSEMBLY,
  COMMON_GROUND_ASSEMBLY,
  WELLWISH_ASSEMBLY,
];

// ---------------------------------------------------------------------------
// Workspace Templates
// ---------------------------------------------------------------------------

export const TPL_CANVAS_PERSONAL: WorkspaceTemplate = {
  template_id: "tpl_canvas_personal" as unknown as TemplateID,
  template_name: "Canvas.ceo Personal Workspace",
  product_assembly: "asm_canvas",
  governance_level: "G0",
  governance_level_range: { min: "G0", max: "G1" },
  domain_contexts: ["DA", "DI", "SM", "RE"],
  purpose_scope: [],
  default_policy_bundles: [],
  resource_defaults: { storage_bytes: 1_073_741_824, api_rate_per_minute: 60 },
  infrastructure_profile: "LOCAL_SQLITE",
  ui_skin: "canvas",
  version: "1.0.0",
  schema_version: "1.0.0",
};

export const TPL_CANVAS_TEAM: WorkspaceTemplate = {
  template_id: "tpl_canvas_team" as unknown as TemplateID,
  template_name: "Canvas.ceo Team Workspace",
  product_assembly: "asm_canvas",
  governance_level: "G1",
  governance_level_range: { min: "G1", max: "G1" },
  domain_contexts: ["DA", "DI", "SM", "RE"],
  purpose_scope: [],
  default_policy_bundles: [],
  resource_defaults: { storage_bytes: 10_737_418_240, api_rate_per_minute: 120 },
  infrastructure_profile: "MANAGED_PG",
  ui_skin: "canvas",
  version: "1.0.0",
  schema_version: "1.0.0",
};

export const TPL_COGNIFIQ_TEAM: WorkspaceTemplate = {
  template_id: "tpl_cognifiq_team" as unknown as TemplateID,
  template_name: "Cognifiq Team Workspace",
  product_assembly: "asm_cognifiq",
  governance_level: "G2",
  governance_level_range: { min: "G2", max: "G3" },
  domain_contexts: ["DA", "DI", "CC", "RA", "RE"],
  purpose_scope: [],
  default_policy_bundles: [],
  resource_defaults: { storage_bytes: 53_687_091_200, api_rate_per_minute: 300 },
  infrastructure_profile: "MANAGED_PG",
  ui_skin: "cognifiq",
  version: "1.0.0",
  schema_version: "1.0.0",
};

export const TPL_COGNIFIQ_ENTERPRISE: WorkspaceTemplate = {
  template_id: "tpl_cognifiq_enterprise" as unknown as TemplateID,
  template_name: "Cognifiq Enterprise Workspace",
  product_assembly: "asm_cognifiq",
  governance_level: "G3",
  governance_level_range: { min: "G3", max: "G3" },
  domain_contexts: ["DA", "DI", "CC", "RA", "RE"],
  purpose_scope: [],
  default_policy_bundles: [],
  resource_defaults: { storage_bytes: 107_374_182_400, api_rate_per_minute: 600 },
  infrastructure_profile: "FEDRAMP_HSM",
  ui_skin: "cognifiq",
  version: "1.0.0",
  schema_version: "1.0.0",
};

export const TPL_CG_TEAM: WorkspaceTemplate = {
  template_id: "tpl_cg_team" as unknown as TemplateID,
  template_name: "Common Ground Team Workspace",
  product_assembly: "asm_common_ground",
  governance_level: "G1",
  governance_level_range: { min: "G1", max: "G2" },
  domain_contexts: ["IC", "OR", "ME", "RE"],
  purpose_scope: [],
  default_policy_bundles: [],
  resource_defaults: { storage_bytes: 10_737_418_240, api_rate_per_minute: 120 },
  infrastructure_profile: "MANAGED_PG",
  ui_skin: "common-ground",
  version: "1.0.0",
  schema_version: "1.0.0",
};

export const TPL_CG_CROSSTEAM: WorkspaceTemplate = {
  template_id: "tpl_cg_crossteam" as unknown as TemplateID,
  template_name: "Common Ground Cross-Team Workspace",
  product_assembly: "asm_common_ground",
  governance_level: "G2",
  governance_level_range: { min: "G2", max: "G2" },
  domain_contexts: ["IC", "OR", "ME", "RE"],
  purpose_scope: [],
  default_policy_bundles: [],
  resource_defaults: { storage_bytes: 53_687_091_200, api_rate_per_minute: 300 },
  infrastructure_profile: "MANAGED_PG",
  ui_skin: "common-ground",
  version: "1.0.0",
  schema_version: "1.0.0",
};

export const TPL_WELLWISH_CARE: WorkspaceTemplate = {
  template_id: "tpl_wellwish_care" as unknown as TemplateID,
  template_name: "WellWish Care Workspace",
  product_assembly: "asm_wellwish",
  governance_level: "G2",
  governance_level_range: { min: "G2", max: "G3" },
  domain_contexts: ["IC", "OR", "ME", "RE"],
  purpose_scope: [],
  default_policy_bundles: ["urn:weops:policy:phi-governance:1.0.0"],
  resource_defaults: { storage_bytes: 53_687_091_200, api_rate_per_minute: 300 },
  infrastructure_profile: "ISOLATED_VPC",
  ui_skin: "wellwish",
  version: "1.0.0",
  schema_version: "1.0.0",
};

export const TPL_WELLWISH_ENTERPRISE: WorkspaceTemplate = {
  template_id: "tpl_wellwish_enterprise" as unknown as TemplateID,
  template_name: "WellWish Enterprise Workspace",
  product_assembly: "asm_wellwish",
  governance_level: "G3",
  governance_level_range: { min: "G3", max: "G3" },
  domain_contexts: ["IC", "OR", "ME", "RE"],
  purpose_scope: [],
  default_policy_bundles: ["urn:weops:policy:phi-governance:1.0.0", "urn:weops:policy:hipaa-minimum-necessary:1.0.0"],
  resource_defaults: { storage_bytes: 107_374_182_400, api_rate_per_minute: 600 },
  infrastructure_profile: "FEDRAMP_HSM",
  ui_skin: "wellwish",
  version: "1.0.0",
  schema_version: "1.0.0",
};

export const ALL_TEMPLATES: readonly WorkspaceTemplate[] = [
  TPL_CANVAS_PERSONAL,
  TPL_CANVAS_TEAM,
  TPL_COGNIFIQ_TEAM,
  TPL_COGNIFIQ_ENTERPRISE,
  TPL_CG_TEAM,
  TPL_CG_CROSSTEAM,
  TPL_WELLWISH_CARE,
  TPL_WELLWISH_ENTERPRISE,
];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

export function find_assembly(assembly_id: string): ProductAssembly | undefined {
  return ALL_ASSEMBLIES.find(a => a.assembly_id === assembly_id);
}

export function find_template(template_id: string): WorkspaceTemplate | undefined {
  return ALL_TEMPLATES.find(t => t.template_id === template_id);
}

export function templates_for_assembly(assembly_id: string): readonly WorkspaceTemplate[] {
  const assembly = find_assembly(assembly_id);
  if (!assembly) return [];
  return ALL_TEMPLATES.filter(t => assembly.templates.includes(t.template_id as string));
}
