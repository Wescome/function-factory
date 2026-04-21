export function executionStartIdFromWorkGraphId(workGraphId: string): string {
  return workGraphId.replace(/^WG-/, "EXS-")
}
export function executionTraceIdFromWorkGraphId(workGraphId: string): string {
  return workGraphId.replace(/^WG-/, "EXT-")
}
export function executionResultIdFromWorkGraphId(workGraphId: string): string {
  return workGraphId.replace(/^WG-/, "EXR-")
}
