/**
 * Lineage and explicitness primitives.
 *
 * Every Factory artifact must carry:
 *   - a populated source_refs array (IDs of every upstream artifact)
 *   - an explicitness tag (explicit | inferred)
 *   - a rationale (substantive when inferred; may be terse when explicit)
 *
 * These primitives are composed into every higher-level schema via
 * Lineage.extend({...}) so the rule is statically enforced.
 */

import { z } from "zod"

/**
 * Explicitness tag. `explicit` means the value was directly stated in a
 * cited upstream artifact. `inferred` means the Factory derived it;
 * rationale must be substantive.
 */
export const Explicitness = z.enum(["explicit", "inferred"])
export type Explicitness = z.infer<typeof Explicitness>

/**
 * Source reference. A bare artifact ID. Every Factory ID starts with a
 * type prefix (PRS-, BC-, FN-, CONTRACT-, FP-, PRD-, WG-, INV-, VAL-,
 * DEP-, ATOM-, CR-, TRJ-, PF-, INC-, DET-, DEL-, SIG-).
 */
export const ArtifactId = z
  .string()
  .regex(
    /^(PRS|BC|FN|CONTRACT|FP|PRD|WG|INV|VAL|DEP|ATOM|CR|TRJ|PF|INC|DET|DEL|SIG)-[A-Z0-9][A-Z0-9-]*$/,
    "ArtifactId must be <TYPE-PREFIX>-<ALPHANUM-WITH-HYPHENS>"
  )
export type ArtifactId = z.infer<typeof ArtifactId>

/**
 * Lineage mixin. Every artifact extends this.
 */
export const Lineage = z.object({
  id: ArtifactId,
  source_refs: z
    .array(ArtifactId)
    .describe("IDs of upstream artifacts that contributed to this artifact"),
  explicitness: Explicitness,
  rationale: z
    .string()
    .min(1, "rationale is required; TODO is not acceptable")
    .describe("why this artifact exists / why a field was inferred"),
})
export type Lineage = z.infer<typeof Lineage>

/**
 * Uncertainty entry. When a compiler pass or skill cannot confidently
 * produce an artifact, it emits one of these instead of guessing.
 */
export const UncertaintyEntry = z.object({
  id: z.string().regex(/^UNC-/),
  pass_or_skill: z.string(),
  source_ref: ArtifactId.optional(),
  reason: z.string().min(1),
  suggested_resolution: z.string().min(1),
  timestamp: z.string().datetime(),
})
export type UncertaintyEntry = z.infer<typeof UncertaintyEntry>
