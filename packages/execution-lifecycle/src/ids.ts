export function executionStartIdFromExecutableSpecificationId(executableSpecificationId: string): string {
  return executableSpecificationId.replace(/^ES-/, "EXS-")
}
export function executionTraceIdFromExecutableSpecificationId(executableSpecificationId: string): string {
  return executableSpecificationId.replace(/^ES-/, "EXT-")
}
export function executionResultIdFromExecutableSpecificationId(executableSpecificationId: string): string {
  return executableSpecificationId.replace(/^ES-/, "EXR-")
}
