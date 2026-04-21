export function effectorRealizationIdFromEffectorId(effectorId: string): string {
  return effectorId.replace(/^EFF-/, "EFFR-")
}
