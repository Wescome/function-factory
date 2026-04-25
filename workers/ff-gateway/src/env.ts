/**
 * @module env
 *
 * Cloudflare Worker environment bindings for ff-gateway.
 *
 * Service Binding types are declared structurally rather than imported
 * from other Workers (cross-Worker imports break rootDir).
 */

import type { Gate1Report } from './types.js'

interface GatesBinding {
  evaluateGate1(workGraph: unknown): Promise<Gate1Report>
}

interface QueryBinding {
  getSpec(collection: string, key: string): Promise<unknown>
  listSpecs(collection: string, opts: { limit: number; offset: number }): Promise<{ items: unknown[]; total: number }>
  traceLineage(collection: string, key: string, maxDepth: number): Promise<unknown[]>
  traceImpact(collection: string, key: string, maxDepth: number): Promise<unknown[]>
  getGateStatus(gate: number, id: string): Promise<unknown>
  getTrustScore(id: string): Promise<unknown>
  getSystemHealth(): Promise<unknown>
  listPendingCRPs(): Promise<unknown[]>
  listPendingMRPs(): Promise<unknown[]>
  listMentorRules(): Promise<unknown[]>
}

export interface GatewayEnv {
  GATES: GatesBinding
  QUERY: QueryBinding
  ARANGO_URL: string
  ARANGO_DATABASE: string
  ARANGO_JWT: string
  ARANGO_USERNAME?: string
  ARANGO_PASSWORD?: string
  ENVIRONMENT: string
}
