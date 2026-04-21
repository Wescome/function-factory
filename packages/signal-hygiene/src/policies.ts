export const SIGNAL_TRUST_BY_KIND = {
  external: 0.95,
  feedback: 0.75,
  inferred: 0.6,
} as const

export const SIGNAL_WEIGHT_CAP_BY_KIND = {
  external: 1.0,
  feedback: 0.6,
  inferred: 0.5,
} as const

export const SIGNAL_WEIGHTING_POLICY_ID = "GOV-META-SIGNAL-HYGIENE-WEIGHTING"
