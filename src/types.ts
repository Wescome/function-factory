/**
 * Core domain types intended for downstream consumption.
 */
export interface AtomDefinition {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  description: string;
  critical: boolean;
}

export type AtomStatus = 'pending' | 'active' | 'resolved' | 'failed';

export interface PlanMetadata {
  atoms: readonly AtomDefinition[];
  executorRecommendation?: string;
  estimatedComplexity?: 'low' | 'medium' | 'high';
}
