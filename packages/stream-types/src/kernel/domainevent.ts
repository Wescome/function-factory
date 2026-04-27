// kernel/domainevent.ts - Domain event envelope types
// Mirrors weops-enterprise/pkg/domainevent/domainevent.go

import type { DomainContextID } from "./enums";

export interface DomainEvent {
  readonly event_id: string;
  readonly event_type: string;
  readonly source_context: DomainContextID;
  readonly workspace_id: string;
  readonly correlation_id: string;
  readonly timestamp: string;
  readonly payload: Record<string, unknown>;
  readonly schema_version: string;
}

// Event type must match dot-notation pattern: context.action (lowercase)
export const EVENT_TYPE_PATTERN = /^[a-z]+\.[a-z_]+$/;

// Valid two-letter domain context identifiers
export const VALID_CONTEXT_IDS: readonly DomainContextID[] = [
  "IC", "OR", "ME", "RE", "DA", "DI", "SM", "CC", "RA",
];
