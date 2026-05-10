export interface CoherenceVerificationReport {
  verification: "coherence"
  passed: boolean
  timestamp: string
  workGraphId: string
  checks: { name: string; passed: boolean; detail: string }[]
  summary: string
}
