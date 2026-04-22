export function recalibratedPressureIdFromPressureId(pressureId: string): string {
  return pressureId.replace(/^PRS-/, "RPRS-")
}

export function deltaDriftInputIdFromPressureId(pressureId: string): string {
  return pressureId.replace(/^PRS-/, "DDI-")
}
