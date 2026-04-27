// kernel/provenance.ts - W3C PROV-inspired provenance tracking
// Mirrors weops-enterprise/pkg/provenance/provenance.go

export interface Provenance {
  readonly entity_id: string;
  readonly generated_by_activity: string;
  readonly attributed_to_agents: readonly string[];
  readonly derived_from_entities?: readonly string[];
  readonly used_entities?: readonly string[];
  readonly generated_at?: string;
}
