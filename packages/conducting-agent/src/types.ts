// Conducting Agent — Gas City interface types
// SPEC-CONDUCTING-AGENT-001 §3, §4

export type GasCitySessionRequest = {
  repoId: string
  workingDir: string
  memoryMb: number
  envVars: Record<string, string>
  permittedTools: string[]
  instruction: string
  timeoutMs: number
}

export type GasCitySessionResponse = {
  sessionId: string
  outcome: 'success' | 'failure' | 'timeout'
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
}

export type ConductingAgentTraceFragment = {
  executionId: string
  directiveId: string
  atomRef: string
  workGraphVersion: string
  repoId: string
  outcome: 'success' | 'failure' | 'timeout' | 'cancelled'
  rawOutput: string          // truncated to 4KB
  sandboxOutputRef?: string  // presigned R2 URL, 24h TTL
  durationMs: number
  attemptNumber: number
  cancelReason?: string
  producedAt: string
}
