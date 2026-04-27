// coordination/product-assembly.ts - Product assembly schema types (WP-0.14)

import type { GovernanceLevel, DomainContextID } from "../kernel/enums";
import type { AssemblyID } from "../kernel/ids";

// ---------------------------------------------------------------------------
// Pricing Tier
// ---------------------------------------------------------------------------
export type PricingTier = "FREE" | "PRO" | "TEAM" | "ENTERPRISE";
export const PRICING_TIER_VALUES = ["FREE", "PRO", "TEAM", "ENTERPRISE"] as const;

// ---------------------------------------------------------------------------
// Product Assembly (WP-0.14)
// ---------------------------------------------------------------------------
export interface ProductAssembly {
  readonly assembly_id: AssemblyID;
  readonly product_name: string;
  readonly product_description?: string;
  readonly templates: readonly string[];
  readonly domain_contexts: readonly DomainContextID[];
  readonly governance_range: {
    readonly min: GovernanceLevel;
    readonly max: GovernanceLevel;
  };
  readonly pricing_tier?: PricingTier;
  readonly version: string;
  readonly schema_version: "1.0.0";
}
