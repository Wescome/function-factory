/**
 * Ontology v0.2 aliases for current stable schema names.
 *
 * These exports are non-breaking compatibility aliases. They do not replace
 * current PRD, WorkGraph, Gate, Coverage Report, or Invariant schema names.
 */

import {
  Invariant,
  PRDDraft,
  WorkGraph,
  type Invariant as CurrentInvariant,
  type PRDDraft as CurrentPRDDraft,
  type WorkGraph as CurrentWorkGraph,
} from "./core.js"
import {
  CoverageReport,
  CoherenceVerificationReport as CurrentCoherenceVerificationReportValue,
  FidelityVerificationReport as CurrentFidelityVerificationReportValue,
  FidelityVerificationVerdict as CurrentFidelityVerificationVerdictValue,
  PersistenceVerificationReport as CurrentPersistenceVerificationReportValue,
  type CoverageReport as CurrentCoverageReport,
  type CoherenceVerificationReport as CurrentCoherenceVerificationReport,
  type FidelityVerificationReport as CurrentFidelityVerificationReport,
  type FidelityVerificationVerdict as CurrentFidelityVerificationVerdict,
  type PersistenceVerificationReport as CurrentPersistenceVerificationReport,
} from "./coverage.js"

export const IntentSpecification = PRDDraft
export type IntentSpecification = CurrentPRDDraft

export const ExecutableSpecification = WorkGraph
export type ExecutableSpecification = CurrentWorkGraph

export const InvariantSpecification = Invariant
export type InvariantSpecification = CurrentInvariant

export const VerificationReport = CoverageReport
export type VerificationReport = CurrentCoverageReport

export const CoherenceVerificationReport = CurrentCoherenceVerificationReportValue
export type CoherenceVerificationReport = CurrentCoherenceVerificationReport

export const FidelityVerificationReport = CurrentFidelityVerificationReportValue
export type FidelityVerificationReport = CurrentFidelityVerificationReport

export const FidelityVerificationVerdict = CurrentFidelityVerificationVerdictValue
export type FidelityVerificationVerdict = CurrentFidelityVerificationVerdict

export const PersistenceVerificationReport = CurrentPersistenceVerificationReportValue
export type PersistenceVerificationReport = CurrentPersistenceVerificationReport
