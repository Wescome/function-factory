export function runtimeAdmissionIdFromWorkGraphId(workGraphId: string, decision: "allow" | "deny"): string {
  const base = workGraphId.replace(/^WG-/, "RAD-")
  return `${base}-${decision.toUpperCase()}`
}
