// kernel/taxonomy.ts - Purpose taxonomy mirroring weops-enterprise/pkg/taxonomy/taxonomy.go

// ---------------------------------------------------------------------------
// Purpose type - union of all valid DOMAIN.ACTION strings
// ---------------------------------------------------------------------------
export type Purpose =
  | "TREATMENT.CARE_COORDINATION"
  | "TREATMENT.DISCHARGE_COORDINATION"
  | "TREATMENT.CARE_DELIVERY"
  | "TREATMENT.CLINICAL_TASKING"
  | "TREATMENT.CONSULTATION"
  | "PAYMENT.CLAIMS_SUBMISSION"
  | "PAYMENT.CLAIMS_ADJUDICATION"
  | "PAYMENT.BILLING"
  | "PAYMENT.CODING_REVIEW"
  | "PAYMENT.DENIAL_MANAGEMENT"
  | "PAYMENT.PRIOR_AUTH"
  | "OPERATIONS.VENDOR_ONBOARDING"
  | "OPERATIONS.WORKFORCE_MANAGEMENT"
  | "OPERATIONS.QUALITY_REPORTING"
  | "OPERATIONS.QUALITY_SAFETY"
  | "OPERATIONS.UTILIZATION_MANAGEMENT"
  | "OPERATIONS.SECURITY_ADMIN"
  | "LEGAL.DISCLOSURE_REVIEW"
  | "LEGAL.CONTRACT_REVIEW"
  | "LEGAL.INCIDENT_RESPONSE"
  | "LEGAL.CONTRACT_INTERPRETATION"
  | "LEGAL.LITIGATION_HOLD"
  | "LEGAL.DEFENSE_SUPPORT"
  | "PROCUREMENT.VENDOR_ONBOARDING"
  | "PROCUREMENT.PURCHASE_APPROVAL";

// ---------------------------------------------------------------------------
// Taxonomy tree: domain -> action -> description
// ---------------------------------------------------------------------------
export const TAXONOMY: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  TREATMENT: {
    CARE_COORDINATION: "Coordinating patient care across providers",
    DISCHARGE_COORDINATION: "Managing patient discharge process",
    CARE_DELIVERY: "Direct clinical care activities",
    CLINICAL_TASKING: "Clinical task assignment and tracking",
    CONSULTATION: "Provider consultation and referral",
  },
  PAYMENT: {
    CLAIMS_SUBMISSION: "Submitting claims to payers",
    CLAIMS_ADJUDICATION: "Processing and resolving claims",
    BILLING: "Patient billing operations",
    CODING_REVIEW: "Medical coding review and validation",
    DENIAL_MANAGEMENT: "Claims denial management and appeals",
    PRIOR_AUTH: "Prior authorization processing",
  },
  OPERATIONS: {
    VENDOR_ONBOARDING: "Adding new vendors to systems",
    WORKFORCE_MANAGEMENT: "Staff scheduling and management",
    QUALITY_REPORTING: "Quality metrics and compliance reporting",
    QUALITY_SAFETY: "Quality and safety monitoring",
    UTILIZATION_MANAGEMENT: "Resource utilization tracking",
    SECURITY_ADMIN: "Security administration and access control",
  },
  LEGAL: {
    DISCLOSURE_REVIEW: "Reviewing records for legal disclosure",
    CONTRACT_REVIEW: "Reviewing and managing contracts",
    INCIDENT_RESPONSE: "Responding to legal incidents",
    CONTRACT_INTERPRETATION: "Interpreting contract terms and clauses",
    LITIGATION_HOLD: "Managing litigation hold requirements",
    DEFENSE_SUPPORT: "Supporting legal defense activities",
  },
  PROCUREMENT: {
    VENDOR_ONBOARDING: "Procuring new vendor relationships",
    PURCHASE_APPROVAL: "Approving purchase orders",
  },
} as const;

// ---------------------------------------------------------------------------
// Validation and query functions
// ---------------------------------------------------------------------------
export function validate_purpose(p: string): p is Purpose {
  const parts = p.split(".");
  if (parts.length !== 2) return false;
  const [domain, action] = parts;
  if (domain === undefined || action === undefined) return false;
  const actions = TAXONOMY[domain];
  if (actions === undefined) return false;
  return action in actions;
}

export function list_domains(): string[] {
  return Object.keys(TAXONOMY);
}

export function list_actions(domain: string): string[] | undefined {
  const actions = TAXONOMY[domain];
  if (actions === undefined) return undefined;
  return Object.keys(actions);
}

export function get_description(purpose: string): string | undefined {
  const parts = purpose.split(".");
  if (parts.length !== 2) return undefined;
  const [domain, action] = parts;
  if (domain === undefined || action === undefined) return undefined;
  const actions = TAXONOMY[domain];
  if (actions === undefined) return undefined;
  return actions[action];
}
