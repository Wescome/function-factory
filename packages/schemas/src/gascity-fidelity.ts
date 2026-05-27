import { z } from "zod"
import { ArtifactId, Lineage } from "./lineage.js"

const VerificationReportId = ArtifactId.refine((id) => id.startsWith("VR-"), "GasCityFidelityVerificationReport IDs must start with VR-")
const FunctionId = ArtifactId.refine((id) => id.startsWith("FN-"), "function_id must start with FN-")
const IntentSpecificationId = ArtifactId.refine((id) => id.startsWith("IS-"), "is_id must start with IS-")
const ExecutableSpecificationId = ArtifactId.refine((id) => id.startsWith("ES-"), "es_id must start with ES-")
const ExecutionPacketId = ArtifactId.refine((id) => id.startsWith("EP-"), "ep_id must start with EP-")
const FormulaArtifactId = ArtifactId.refine((id) => id.startsWith("FORM-"), "form_id must start with FORM-")

export const GasCityOutcome = z.enum(["approved", "revise"])
export type GasCityOutcome = z.infer<typeof GasCityOutcome>

export const GasCityFidelityVerificationReport = Lineage.extend({
  id: VerificationReportId,
  verification: z.literal("fidelity"),
  variant: z.literal("gascity"),
  function_id: FunctionId,
  timestamp: z.string().datetime(),
  overall: z.enum(["pass", "fail"]),
  gc_outcome: GasCityOutcome,
  bead_id: z.string().min(1),
  form_id: FormulaArtifactId,
  ep_id: ExecutionPacketId,
  es_id: ExecutableSpecificationId,
  is_id: IntentSpecificationId,
  factory_attempt: z.number().int().positive(),
  intake_checks: z.object({
    hmac_valid: z.literal(true),
    payload_wellformed: z.literal(true),
    lineage_resolved: z.literal(true),
    dispatch_match: z.object({
      dispatch_log_key: z.string().min(1),
      matched_on: z.literal("bead_id"),
    }),
  }),
  verdict_authority: z.literal("gas-city-verify-stage"),
  received_at: z.string().datetime(),
  remediation: z.string().min(1),
  source_refs: z.array(ArtifactId).min(5),
})
export type GasCityFidelityVerificationReport = z.infer<typeof GasCityFidelityVerificationReport>

