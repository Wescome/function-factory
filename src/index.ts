/**
 * Type Export Module
 *
 * Centralized type-only export mechanism ensuring downstream packages
 * consume a stable public type surface without importing internal modules.
 */

export type {
  AtomDefinition,
  AtomStatus,
  PlanMetadata,
} from './types';
