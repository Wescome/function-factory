export function runtimeAdmissionIdFromExecutableSpecificationId(executableSpecificationId: string, decision: "allow" | "deny"): string {
  const base = executableSpecificationId.replace(/^WG-/, "RAD-")
  return `${base}-${decision.toUpperCase()}`
}
