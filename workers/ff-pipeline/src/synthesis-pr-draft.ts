import { buildBranchName } from './stages/generate-pr'

export interface SynthesisMaterializationAudit {
  type: 'synthesis_artifact_materialization'
  timestamp: string
  pipelineId: string
  runtimeStatus: string
  signalId: string
  pressureId: string
  capabilityId: string
  proposalId: string
  workGraphId: string
  gate1Passed: boolean
  atomResults: Array<{
    atomId: string
    decision: string
    confidence: number
    tests: string
  }>
  materializedFiles: Array<{
    atomId: string
    path: string
    action: string
    sha256: string
  }>
  localVerification: string[]
  notes?: string
}

export interface SynthesisPRDraft {
  title: string
  branchName: string
  baseBranch: 'main'
  body: string
  sourceRefs: string[]
  proposalId: string
  workGraphId: string
}

export class SynthesisPRDraftError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SynthesisPRDraftError'
  }
}

function assertReadyForPR(audit: SynthesisMaterializationAudit): void {
  if (audit.runtimeStatus !== 'synthesis-passed') {
    throw new SynthesisPRDraftError(`Runtime status must be synthesis-passed, got ${audit.runtimeStatus}`)
  }
  if (!audit.gate1Passed) {
    throw new SynthesisPRDraftError('Gate 1 must pass before building a synthesis PR draft')
  }
  if (audit.materializedFiles.length === 0) {
    throw new SynthesisPRDraftError('At least one materialized file is required for a synthesis PR draft')
  }
  for (const atom of audit.atomResults) {
    if (atom.decision !== 'pass') {
      throw new SynthesisPRDraftError(`Atom ${atom.atomId} must pass before building a synthesis PR draft`)
    }
  }
}

export function buildSynthesisPRDraft(audit: SynthesisMaterializationAudit): SynthesisPRDraft {
  assertReadyForPR(audit)

  const sourceRefs = [
    audit.signalId,
    audit.pressureId,
    audit.capabilityId,
    audit.proposalId,
    audit.workGraphId,
  ]

  const body: string[] = [
    '## Factory Synthesis Materialization',
    '',
    `Pipeline: \`${audit.pipelineId}\``,
    `WorkGraph: \`${audit.workGraphId}\``,
    `Proposal: \`${audit.proposalId}\``,
    `Runtime status: \`${audit.runtimeStatus}\``,
    `Gate 1: \`${audit.gate1Passed ? 'pass' : 'fail'}\``,
    `Materialized at: \`${audit.timestamp}\``,
    '',
    '### Lineage',
    '',
    ...sourceRefs.map(ref => `- \`${ref}\``),
    '',
    '### Atom Results',
    '',
    ...audit.atomResults.map(atom => `- \`${atom.atomId}\`: ${atom.decision}, confidence ${atom.confidence}, tests ${atom.tests}`),
    '',
    '### Materialized Files',
    '',
    ...audit.materializedFiles.map(file => `- \`${file.action}\` \`${file.path}\` (${file.atomId}) sha256 \`${file.sha256}\``),
    '',
    '### Local Verification',
    '',
    ...audit.localVerification.map(item => `- ${item}`),
    '',
    '### Notes',
    '',
    audit.notes ?? 'No additional notes.',
    '',
    '---',
    '_Prepared by the Function Factory synthesis artifact handoff._',
  ]

  return {
    title: `[Factory] Materialize ${audit.workGraphId} synthesis artifact`,
    branchName: buildBranchName(audit.proposalId),
    baseBranch: 'main',
    body: body.join('\n'),
    sourceRefs,
    proposalId: audit.proposalId,
    workGraphId: audit.workGraphId,
  }
}
