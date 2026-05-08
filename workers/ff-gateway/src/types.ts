export interface CoherenceVerificationReport {
  gate: 1
  passed: boolean
  timestamp: string
  workGraphId: string
  checks: { name: string; passed: boolean; detail: string }[]
  summary: string
}

export type Gate1Report = CoherenceVerificationReport
