/**
 * @module types
 *
 * Shared types for the Linear Bridge worker.
 *
 * Disposition comments use a structured DISPOSITION: prefix syntax:
 *   DISPOSITION: <verb> [args...]
 *
 * Supported verbs:
 *   resume            — resume a suspended pipeline (ResumeSignal)
 *   commission        — commission a work graph (CommissioningSignal)
 *   patch             — authorize a patch artifact (PatchAuthSignal)
 *   pipeline-config   — authorize a pipeline config change (PipelineConfigAuthSignal)
 *   override          — two-person override operation (OverrideSignal)
 *   reject            — reject and close the escalation
 */

import type { TokenScope } from '@factory/schemas/weops-disposition-token'
import type { OverrideDirective } from '@factory/schemas/weops-signals'

// ─── Disposition Verb ─────────────────────────────────────────────────────────

export type DispositionVerb =
  | 'resume'
  | 'commission'
  | 'patch'
  | 'pipeline-config'
  | 'override'
  | 'reject'

// ─── Parsed Disposition ───────────────────────────────────────────────────────

export interface ParsedDisposition {
  verb: DispositionVerb

  // resume/commission: optional work-graph reference
  workGraphId?: string
  workGraphVersion?: string

  // patch/pipeline-config: artifact IDs
  patchId?: string
  configChangeId?: string
  affectedRepoIds?: string[]

  // override: directive and optional target
  overrideDirective?: OverrideDirective
  targetRepoId?: string

  // raw args for pass-through
  rawArgs: string[]
}

// ─── Escalation Type ─────────────────────────────────────────────────────────

export type EscalationType =
  | 'CommissioningSignal'
  | 'ResumeSignal'
  | 'PatchAuthSignal'
  | 'PipelineConfigAuthSignal'
  | 'OverrideSignal'

// ─── Gateway Signal (generic outbound wrapper) ───────────────────────────────

export interface GatewaySignalRequest {
  signalBody: Record<string, unknown>
  jwtToken: string
}

// ─── Override Action ─────────────────────────────────────────────────────────

export interface OverrideAction {
  escalationId: string
  initiatorLinearId: string
  directive: OverrideDirective
  targetRepoId?: string
}

// ─── Verb → Scope Mapping ─────────────────────────────────────────────────────

export const VERB_TO_SCOPE: Record<DispositionVerb, TokenScope> = {
  resume: 'we-layer:commission',
  commission: 'we-layer:commission',
  patch: 'we-layer:patch',
  'pipeline-config': 'we-layer:pipeline-config',
  override: 'we-layer:override',
  reject: 'we-layer:commission', // any authority can reject
}

// ─── Elucidation Artifact ─────────────────────────────────────────────────────

export interface DispositionElucidationArtifact {
  id: string              // ELC-BRIDGE-{escalationId}-{timestamp}
  nodeType: 'ElucidationArtifact'
  escalationId: string
  repoId: string
  linearIssueId: string
  linearCommentId: string
  commenterLinearId: string
  dispositionVerb: DispositionVerb
  parsedArgs: Record<string, unknown>
  producedAt: string      // ISO 8601
  bridge: 'ff-linear-bridge'
}

// ─── Rejection Record ────────────────────────────────────────────────────────

export interface RejectionRecord {
  id: string              // REJ-BRIDGE-{escalationId}-{timestamp}
  nodeType: 'RejectionRecord'
  escalationId: string
  repoId: string
  linearIssueId: string
  linearCommentId: string
  rejectedBy: string      // Linear user ID
  reason?: string
  rejectedAt: string      // ISO 8601
  bridge: 'ff-linear-bridge'
}

// ─── Linear Webhook Payload ───────────────────────────────────────────────────

export interface LinearWebhookPayload {
  action: string
  type: string
  data: {
    id: string
    body?: string
    user?: { id: string; name?: string }
    issue?: { id: string; identifier?: string; title?: string; state?: { name?: string } }
    [key: string]: unknown
  }
  organizationId?: string
  webhookTimestamp?: number
  [key: string]: unknown
}

// ─── Env ─────────────────────────────────────────────────────────────────────

export interface Env {
  // Secrets (wrangler secret put)
  LINEAR_WEBHOOK_SECRET: string   // raw string — NOT base64; used with TextEncoder
  LINEAR_API_KEY: string          // Linear personal API key for GraphQL
  WEOPS_SIGNING_KEY: string       // base64-encoded HMAC-SHA256 raw bytes — matches ff-gateway
  WEOPS_GATEWAY_URL: string       // e.g. https://ff-gateway.koales.workers.dev

  // KV Binding
  BRIDGE_KV: KVNamespace          // authority-registry, pending-override:*, jti:*, audit

  // Durable Object Bindings
  ARTIFACT_GRAPH: DurableObjectNamespace    // ArtifactGraphDO — per-repo
  APPROVAL_FLOW_DO: DurableObjectNamespace  // ApprovalFlowDO — per-escalation
}
