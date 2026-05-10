export function executionStartIdFromExecutableSpecificationId(executableSpecificationId: string): string {
  return executableSpecificationId.replace(/^WG-/, "EXS-")
}
export function executionTraceIdFromExecutableSpecificationId(executableSpecificationId: string): string {
  return executableSpecificationId.replace(/^WG-/, "EXT-")
}
export function executionResultIdFromExecutableSpecificationId(executableSpecificationId: string): string {
  return executableSpecificationId.replace(/^WG-/, "EXR-")
}
