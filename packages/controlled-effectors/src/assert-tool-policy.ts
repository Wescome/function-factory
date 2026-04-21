export function assertToolPolicyAllows(
  toolPolicyMode: "allowlist" | "restricted" | "none",
  requestedEffectorType: "tool_call" | "file_write" | "no_op"
): void {
  if (toolPolicyMode === "none" && requestedEffectorType !== "no_op") {
    throw new Error("Controlled effector denied: tool policy is none")
  }

  if (toolPolicyMode === "restricted" && requestedEffectorType === "tool_call") {
    throw new Error("Controlled effector denied: restricted policy blocks direct tool_call in bootstrap mode")
  }
}
