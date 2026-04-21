export function assertSafeExecuteMode(mode: "simulate" | "safe_execute"): void {
  if (mode !== "safe_execute") {
    throw new Error("Effector realization denied: only safe_execute may produce EFFR")
  }
}

export function assertTrustedEnvironment(environmentTrust: "trusted" | "untrusted"): void {
  if (environmentTrust !== "trusted") {
    throw new Error("Effector realization denied: environment is not trusted")
  }
}

export function assertRealizableEffectorType(requestedEffectorType: "tool_call" | "file_write" | "no_op"): void {
  if (requestedEffectorType !== "file_write") {
    throw new Error("Effector realization denied: bootstrap realization supports only sandboxed file_write")
  }
}
