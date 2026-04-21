export function signalBatchIdFromRunId(runId: string): string {
  return `SNB-${runId}`
}
