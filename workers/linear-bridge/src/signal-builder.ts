/**
 * @module signal-builder
 *
 * Maps a ParsedDisposition → InboundSignal discriminated union.
 *
 * Schema authority: /packages/schemas/src/weops-signals.ts
 *
 * Key deltas from the spec pseudocode (signal-builder.ts):
 *   - 'resume' → ResumeSignal (not CommissioningSignal)
 *   - PatchAuthSignal uses `patchId` + `affectedRepoIds` (not `changedArtifactId` + `urgency`)
 *   - PipelineConfigAuthSignal uses `configChangeId` + `affectedRepoIds` (not `proposedConfigId`)
 *   - OverrideSignal uses `directive` (enum) + `targetRepoId` (not `action` + `targetId`)
 */

import type {
  CommissioningSignal,
  ResumeSignal,
  PatchAuthSignal,
  PipelineConfigAuthSignal,
  OverrideSignal,
  InboundSignal,
} from '@factory/schemas/weops-signals'
import type { ParsedDisposition } from './types.js'

// ─── Signal Build Result ──────────────────────────────────────────────────────

export interface SignalBuildSuccess {
  ok: true
  signal: InboundSignal
}

export interface SignalBuildFailure {
  ok: false
  reason: string
}

export type SignalBuildResult = SignalBuildSuccess | SignalBuildFailure

// ─── Builder ─────────────────────────────────────────────────────────────────

/**
 * Builds an InboundSignal from a ParsedDisposition and disposition context.
 *
 * @param parsed              Parsed DISPOSITION: comment
 * @param repoId              Repository identifier (from escalation payload)
 * @param dispositionEventId  ELC-* node ID (written before this call)
 * @param elucidationArtifactId ELC-* node ID (same value)
 */
export function buildSignal(
  parsed: ParsedDisposition,
  repoId: string,
  dispositionEventId: string,
  elucidationArtifactId: string,
): SignalBuildResult {
  const issuedAt = new Date().toISOString()

  switch (parsed.verb) {
    case 'commission': {
      if (!parsed.workGraphId || !parsed.workGraphVersion) {
        return { ok: false, reason: 'commission: missing workGraphId or workGraphVersion' }
      }
      const signal: CommissioningSignal = {
        signalType: 'CommissioningSignal',
        repoId,
        workGraphId: parsed.workGraphId,
        workGraphVersion: parsed.workGraphVersion,
        dispositionEventId,
        elucidationArtifactId,
        issuedAt,
      }
      return { ok: true, signal }
    }

    case 'resume': {
      const signal: ResumeSignal = {
        signalType: 'ResumeSignal',
        repoId,
        // newWorkGraphId / newWorkGraphVersion are optional on ResumeSignal
        ...(parsed.workGraphId !== undefined ? { newWorkGraphId: parsed.workGraphId } : {}),
        ...(parsed.workGraphVersion !== undefined ? { newWorkGraphVersion: parsed.workGraphVersion } : {}),
        dispositionEventId,
        elucidationArtifactId,
        issuedAt,
      }
      return { ok: true, signal }
    }

    case 'patch': {
      if (!parsed.patchId || !parsed.affectedRepoIds || parsed.affectedRepoIds.length === 0) {
        return { ok: false, reason: 'patch: missing patchId or affectedRepoIds' }
      }
      const signal: PatchAuthSignal = {
        signalType: 'PatchAuthSignal',
        patchId: parsed.patchId,
        affectedRepoIds: parsed.affectedRepoIds,
        dispositionEventId,
        elucidationArtifactId,
        issuedAt,
      }
      return { ok: true, signal }
    }

    case 'pipeline-config': {
      if (!parsed.configChangeId || !parsed.affectedRepoIds || parsed.affectedRepoIds.length === 0) {
        return { ok: false, reason: 'pipeline-config: missing configChangeId or affectedRepoIds' }
      }
      const signal: PipelineConfigAuthSignal = {
        signalType: 'PipelineConfigAuthSignal',
        configChangeId: parsed.configChangeId,
        affectedRepoIds: parsed.affectedRepoIds,
        dispositionEventId,
        elucidationArtifactId,
        issuedAt,
      }
      return { ok: true, signal }
    }

    case 'override': {
      if (!parsed.overrideDirective) {
        return { ok: false, reason: 'override: missing directive' }
      }
      const signal: OverrideSignal = {
        signalType: 'OverrideSignal',
        directive: parsed.overrideDirective,
        dispositionEventId,
        elucidationArtifactId,
        issuedAt,
        ...(parsed.targetRepoId !== undefined ? { targetRepoId: parsed.targetRepoId } : {}),
      }
      return { ok: true, signal }
    }

    case 'reject': {
      return { ok: false, reason: 'reject dispositions do not produce a gateway signal' }
    }
  }
}
