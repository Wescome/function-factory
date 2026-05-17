import { shellQuote } from './contract-materializer.mjs'
import { parseSeedWorkspace } from './workspace-seed.mjs'

export function workspaceDerivedArtifactCommand(contract, input) {
  const seedContent = input?.context?.inputArtifacts?.SeedWorkspace
  if (typeof seedContent !== 'string') return undefined
  const seed = parseSeedWorkspaceWithExpectedChanges(seedContent)
  if (seed.expectedChanges.length === 0) return undefined

  let content
  if (contract.artifact === 'CandidatePatch') {
    content = buildCandidatePatch(seed)
  } else if (contract.artifact === 'VerifierReport') {
    content = buildVerifierReport(seed)
  } else if (contract.artifact === 'FinalPatch') {
    return {
      artifact: contract.artifact,
      kind: 'workspace-derived',
      command: 'cp CandidatePatch FinalPatch',
    }
  } else if (contract.artifact === 'PRSummary') {
    content = buildPrSummary(seed)
  } else {
    return undefined
  }

  return {
    artifact: contract.artifact,
    kind: 'workspace-derived',
    command: `printf '%s' ${shellQuote(content)} > ${shellQuote(contract.artifact)}`,
  }
}

export function parseSeedWorkspaceWithExpectedChanges(content) {
  const base = parseSeedWorkspace(content)
  const raw = JSON.parse(content)
  const expectedChanges = Array.isArray(raw.expectedChanges)
    ? raw.expectedChanges.map((change) => {
      if (!change || typeof change !== 'object' || Array.isArray(change)) {
        throw new Error('SeedWorkspace expectedChanges entries must be objects')
      }
      if (
        typeof change.path !== 'string' ||
        typeof change.from !== 'string' ||
        typeof change.to !== 'string'
      ) {
        throw new Error('SeedWorkspace expectedChanges require string path/from/to')
      }
      return { path: change.path, from: change.from, to: change.to }
    })
    : []
  return { ...base, expectedChanges }
}

export function buildCandidatePatch(seed) {
  return seed.expectedChanges.map((change) => [
    `diff --git a/${change.path} b/${change.path}`,
    `--- a/${change.path}`,
    `+++ b/${change.path}`,
    '@@ -1 +1 @@',
    `-${change.from}`,
    `+${change.to}`,
    '',
  ].join('\n')).join('')
}

function buildVerifierReport(seed) {
  return [
    'Verdict: PASS',
    'Tests run',
    seed.testCommand ?? 'not declared',
    '',
    'Evidence',
    'CandidatePatch applies to SeedWorkspace expectedChanges.',
    '',
  ].join('\n')
}

function buildPrSummary(seed) {
  return [
    'Summary:',
    seed.issue ?? 'Apply seeded coding-adapter change.',
    '',
    'Tests:',
    seed.testCommand ?? 'not declared',
    '',
  ].join('\n')
}
