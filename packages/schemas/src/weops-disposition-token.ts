import { z } from "zod"

export const TokenScope = z.enum([
  "we-layer:commission",
  "we-layer:patch",
  "we-layer:pipeline-config",
  "we-layer:override",
])
export type TokenScope = z.infer<typeof TokenScope>

export const WeOpsDispositionTokenClaims = z.object({
  iss: z.literal("weops-gateway"),
  sub: z.string().min(1),                   // commenterLinearId
  aud: z.literal("factory-i-layer"),
  exp: z.number().int().positive(),         // iat + 300 (5-minute window)
  iat: z.number().int().positive(),
  jti: z.string().min(1),                   // unique per disposition; KV replay prevention
  scope: z.array(TokenScope).min(1),
  dispositionEventId: z.string().min(1),    // ELC-* node ID
  elucidationArtifactId: z.string().min(1),
})
export type WeOpsDispositionTokenClaims = z.infer<typeof WeOpsDispositionTokenClaims>
