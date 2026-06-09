export interface CoherenceVerificationReport {
  verification: "coherence"
  passed: boolean
  timestamp: string
  executableSpecificationId: string
  checks: { name: string; passed: boolean; detail: string }[]
  summary: string
}
