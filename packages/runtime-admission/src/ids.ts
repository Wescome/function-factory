export function runtimeAdmissionIdFromExecutableSpecificationId(executableSpecificationId: string, decision: "allow" | "deny"): string {
  const base = executableSpecificationId.replace(/^ES-/, "RAD-")
  return `${base}-${decision.toUpperCase()}`
}
