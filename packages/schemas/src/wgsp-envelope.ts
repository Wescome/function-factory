import { z } from "zod"

// ─── Shared sub-types ─────────────────────────────────────────────────────────

export const EndpointDescriptor = z.object({
  kernel_id: z.string().min(1),
  agent_id: z.string().min(1),
})
export type EndpointDescriptor = z.infer<typeof EndpointDescriptor>

export const IdentityContext = z.object({
  actor_id: z.string().min(1),
  actor_type: z.enum(["agent", "human", "system"]),
})
export type IdentityContext = z.infer<typeof IdentityContext>

export const SessionContext = z.object({
  session_id: z.string().min(1),    // runId
  assembly_id: z.string().min(1),   // workGraphId
})
export type SessionContext = z.infer<typeof SessionContext>

export const GovernanceContext = z.object({
  work_order_id: z.string().min(1),
  evidence_chain_root: z.string().min(1),
})
export type GovernanceContext = z.infer<typeof GovernanceContext>

export const WorkGraphSubgraph = z.object({
  durable_objects: z.unknown(),   // typed per signal in weops-signals.ts
}).passthrough()
export type WorkGraphSubgraph = z.infer<typeof WorkGraphSubgraph>

export const OptionScore = z.object({
  option: z.string().min(1),
  score: z.number(),
})
export type OptionScore = z.infer<typeof OptionScore>

export const EpistemicSurface = z.object({
  decision_id: z.string().min(1),              // '{repoId}:{atomId}:{verdictType}'
  selected_option: z.string().min(1),          // 'favorable' | 'unfavorable'
  decision_entropy: z.number(),
  decision_margin: z.number(),
  alternative_pressure: z.number(),
  governance_friction: z.number(),
  top_k_alternatives: z.array(OptionScore),
  policy_refs: z.array(z.string().min(1)),     // INV-* ids evaluated
  requires_downstream_review: z.boolean(),
})
export type EpistemicSurface = z.infer<typeof EpistemicSurface>

export const ProvenancePointer = z.object({
  ledger_kernel_id: z.string().min(1),
  evidence_root_hash: z.string().min(1),
  evidence_count: z.number().int().nonnegative(),
  authentication_required: z.boolean(),
})
export type ProvenancePointer = z.infer<typeof ProvenancePointer>

export const EnvelopeSignature = z.object({
  algorithm: z.enum(["HMAC-SHA256", "Ed25519"]),
  signing_kernel_id: z.string().min(1),   // 'factory-i-layer'
  signed_at: z.string().min(1),           // RFC 3339 UTC
  signature: z.string().min(1),           // base64; RFC 8785 canonical-JSON, excludes `signature` field
  canonicalization: z.literal("RFC8785"),
})
export type EnvelopeSignature = z.infer<typeof EnvelopeSignature>

export const WgemEvent = z.enum(["PROPOSAL", "RESULT", "BOUNDARY"])
export type WgemEvent = z.infer<typeof WgemEvent>

// ─── Full WGSP outbound envelope ─────────────────────────────────────────────

export const OutboundEnvelope = z.object({
  envelope_schema_version: z.literal("1.0.0"),
  envelope_id: z.string().min(1),               // env_<uuid_v7>
  parent_envelope_id: z.string().min(1).optional(),
  correlation_id: z.string().min(1),             // cor_<uuid_v7>
  timestamp: z.string().min(1),                  // RFC 3339 UTC, microsecond — AC-WE-01
  source: EndpointDescriptor,
  target: EndpointDescriptor,
  identity_context: IdentityContext,
  session_context: SessionContext,
  governance_context: GovernanceContext,
  work_graph: WorkGraphSubgraph,
  epistemic_surface: EpistemicSurface.optional(),
  provenance_pointer: ProvenancePointer.optional(),
  signature: EnvelopeSignature,
  wgem_event: WgemEvent,
})
export type OutboundEnvelope = z.infer<typeof OutboundEnvelope>
