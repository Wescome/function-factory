// gdk-ts/src/types.ts — Core GDK types for TypeScript
// Maps to SDD-GDK §4.3 and mirrors gdk-go types.go

import type { AutonomyTier, WorkOrderStatus } from "@weops/stream-types/kernel";

/**
 * Tier represents the autonomy tier for a governed action.
 * Maps to kernel T-tier values per SDD-GDK §3.3.
 */
export const Tier = {
  /** T0: Execute without human approval; evidence committed. */
  AUTONOMOUS: 0,
  /** T1: Execute and notify designated role. */
  ESCALATION: 1,
  /** T2: Execution suspended until explicit approval granted. */
  EXPERT_APPROVAL: 2,
  /** T99: Execution unconditionally denied; evidence committed with DENY. */
  BLOCKED: 99,
} as const;

export type Tier = (typeof Tier)[keyof typeof Tier];

/**
 * Maps GDK Tier constants to kernel autonomy tier strings.
 */
export function tierToKernel(t: Tier): AutonomyTier {
  switch (t) {
    case Tier.AUTONOMOUS:
      return "T0";
    case Tier.ESCALATION:
      return "T1";
    case Tier.EXPERT_APPROVAL:
      return "T2";
    case Tier.BLOCKED:
      return "T2"; // Blocked maps to T2 with DENY
    default:
      return "T1";
  }
}

/**
 * FidelityLevel represents the data freshness requirement for a field.
 */
export const FidelityLevel = {
  /** Real-time / must-be-fresh. */
  LEVEL_0: 0,
  /** Cached up to 5 minutes. */
  LEVEL_1: 1,
  /** Cached up to 30 minutes. */
  LEVEL_2: 2,
  /** Stale acceptable. */
  LEVEL_3: 3,
} as const;

export type FidelityLevel = (typeof FidelityLevel)[keyof typeof FidelityLevel];

/**
 * GovernedConfig — the configuration object for the @governed decorator.
 * Per SDD-GDK §4.3.2.
 */
export interface GovernedConfig {
  intentClass: string;
  tier: Tier;
  fidelityRequirements?: Record<string, FidelityLevel>;
  pisValidation?: PISValidationConfig;
  reversible?: boolean;
  reversibleForMs?: number;
  idempotencyKeyFn?: (...args: unknown[]) => string;
}

/**
 * PISValidationConfig configures Policy Information Set validation.
 */
export interface PISValidationConfig {
  policies: string[];
  allowDeviations: boolean;
}

/**
 * GovernedAction is the primary request type for a governed execution.
 * Callers must supply an idempotencyKey; GDK returns GDK_MISSING_IDEMPOTENCY_KEY
 * if it is empty (SDD-GDK §9.6).
 */
export interface GovernedAction {
  intentClass: string;
  tier: Tier;
  context?: Record<string, unknown>;
  action: () => Promise<void>;
  fidelityRequirements?: Record<string, FidelityLevel>;
  pisValidation?: PISValidationConfig;
  reversible?: boolean;
  reversibleForMs?: number;
  idempotencyKey: string;
}

/**
 * BatchConfig controls batch execution semantics.
 */
export interface BatchConfig {
  maxConcurrency?: number;
  escalateIfAnyFail?: boolean;
  transactionSemantics: "atomic" | "best-effort";
}

/**
 * ReversibleAction wraps a forward function with a registered compensation function.
 */
export interface ReversibleAction {
  intentClass: string;
  forwardFunc: () => Promise<unknown>;
  reverseFunc: (forwardResult: unknown) => Promise<void>;
  idempotencyKey?: string;
}

/**
 * ExecutionStatus returned from kernel work order queries.
 */
export interface ExecutionStatus {
  workOrderId: string;
  status: WorkOrderStatus;
  autonomyTier: AutonomyTier;
  primaryPurpose?: string;
}

/**
 * ServiceConfig — constructor parameters for GovernedService.
 */
export interface ServiceConfig {
  assemblyId: string;
  purposeId: string;
  kernelEndpoint?: string;
  authToken?: string;
  approvalTimeoutMs?: number;
  approvalPollIntervalMs?: number;
}
