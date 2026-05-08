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
  Gate1Report,
  Gate2Report,
  Gate3Report,
  type CoverageReport as CurrentCoverageReport,
  type Gate1Report as CurrentGate1Report,
  type Gate2Report as CurrentGate2Report,
  type Gate3Report as CurrentGate3Report,
} from "./coverage.js"

export const IntentSpecification = PRDDraft
export type IntentSpecification = CurrentPRDDraft

export const ExecutableSpecification = WorkGraph
export type ExecutableSpecification = CurrentWorkGraph

export const InvariantSpecification = Invariant
export type InvariantSpecification = CurrentInvariant

export const VerificationReport = CoverageReport
export type VerificationReport = CurrentCoverageReport

export const CoherenceVerificationReport = Gate1Report
export type CoherenceVerificationReport = CurrentGate1Report

export const FidelityVerificationReport = Gate2Report
export type FidelityVerificationReport = CurrentGate2Report

export const PersistenceVerificationReport = Gate3Report
export type PersistenceVerificationReport = CurrentGate3Report
