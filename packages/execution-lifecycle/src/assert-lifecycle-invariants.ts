export function assertExecutionStartAllowed(radDecision: "allow" | "deny"): void {
  if (radDecision !== "allow") throw new Error("Execution lifecycle denied: EXS requires RAD allow")
}
export function assertTraceAllowed(hasExecutionStart: boolean): void {
  if (!hasExecutionStart) throw new Error("Execution lifecycle denied: EXT requires EXS")
}
export function assertResultAllowed(hasExecutionStart: boolean): void {
  if (!hasExecutionStart) throw new Error("Execution lifecycle denied: EXR requires EXS")
}
