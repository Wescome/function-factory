export function observationIdFromExecutionResultId(executionResultId: string): string {
  return executionResultId.replace(/^EXR-/, "OBS-")
}

export function feedbackSignalIdFromObservationId(observationId: string): string {
  return observationId.replace(/^OBS-/, "SIG-META-BOOTSTRAP-FEEDBACK-")
}
