#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
let checks = 0

const requiredFiles = [
  'specs/reference/DOMAIN-FACTORY-KERNEL.md',
  'specs/reference/ONTOLOGY-CUTOVER-CONSTRAINTS.json',
  'specs/reference/FF-ONTOLOGY-ADDENDUM-A.md',
  'specs/reference/ONTOLOGY-ADDENDUM-B-STAGE-EXTENSIONS.md',
  'packages/schemas/src/domain-adapter.ts',
  'packages/schemas/src/coding-domain-adapter.ts',
  'packages/schemas/src/_attic/trellis-execution-packet.ts',
  'packages/schemas/src/_attic/trellis-canonical-json.ts',
  'packages/schemas/src/gascity-fidelity.ts',
  'packages/compiler/src/instruction-tuning.ts',
  'packages/schemas/src/core.ts',
  'packages/schemas/src/coverage.ts',
  'packages/compiler/src/passes/07-coherence-verification.ts',
  'packages/compiler/src/passes/08-assemble-executable-specification.ts',
  'packages/compiler/src/passes/_executable-specification-emit.ts',
  'packages/verification/src/coherence-verification.ts',
  'packages/verification/package.json',
  'packages/intent-authoring/package.json',
  '.agent/skills/coherence-verification/SKILL.md',
  '.agent/skills/fidelity-verification/SKILL.md',
  '.agent/skills/persistence-verification/SKILL.md',
  'workers/ff-pipeline/src/coordinator/state.ts',
  'workers/ff-pipeline/src/gascity/function-lifecycle.ts',
  'workers/ff-pipeline/src/gascity/webhook-receiver.ts',
]

for (const file of requiredFiles) {
  checks += 1
  if (!existsSync(path.join(root, file))) {
    failures.push(`missing required ontology hard-cut file: ${file}`)
  }
}

expectIncludes(
  'Domain Adapter schema exposes DomainExecutionRequest',
  'packages/schemas/src/domain-adapter.ts',
  'DomainExecutionRequest',
)
expectIncludes(
  'Coding adapter contract materialized',
  'packages/schemas/src/coding-domain-adapter.ts',
  'adapter.coding',
)
expectIncludes(
  'Coordinator state carries DomainExecutionRequest',
  'workers/ff-pipeline/src/coordinator/state.ts',
  'domainExecutionRequest',
)
expectIncludes(
  'Coordinator state carries DomainExecutionEvidence',
  'workers/ff-pipeline/src/coordinator/state.ts',
  'domainExecutionEvidence',
)
expectIncludes(
  'Trellis packet schema is quarantined while compatibility consumers remain',
  'packages/schemas/src/_attic/trellis-execution-packet.ts',
  'TrellisExecutionPacket',
)
expectIncludes(
  'Gas City fidelity schema is materialized',
  'packages/schemas/src/gascity-fidelity.ts',
  'GasCityFidelityVerificationReport',
)
expectIncludes(
  'Pipeline blocks synthesis-era instruction tuning handoff in Gas City era',
  'workers/ff-pipeline/src/pipeline.ts',
  'instruction-tuning-blocked',
)
expectIncludes(
  'Coordinator state carries TrellisExecutionPacket',
  'workers/ff-pipeline/src/coordinator/state.ts',
  'trellisExecutionPacket',
)
expectIncludes(
  'Worker synthesis boundary still rejects packet-less compatibility payloads',
  'workers/ff-pipeline/src/index.ts',
  'trellisExecutionPacket is required for synthesis queue dispatch',
)
expectIncludes(
  'Gas City webhook route is wired',
  'workers/ff-pipeline/src/index.ts',
  '/webhooks/gascity',
)
expectIncludes(
  'Gas City lifecycle transition helper is materialized',
  'workers/ff-pipeline/src/gascity/function-lifecycle.ts',
  'ALLOWED_FUNCTION_TRANSITIONS',
)
expectIncludes(
  'Coordinator rejects packet-less synthesis',
  'workers/ff-pipeline/src/coordinator/coordinator.ts',
  'trellisExecutionPacket is required for synthesis',
)

const activeRoots = [
  'packages/schemas/src',
  'packages/compiler/src',
  'packages/verification/src',
  'packages/function-synthesis/src',
  'workers/ff-pipeline/src',
  'workers/ff-gates/src',
  'workers/ff-gateway/src',
]

const forbiddenPatterns = [
  [/\bPRDDraft\b/g, 'PRDDraft active API'],
  [/\bPipelineWorkGraph\b/g, 'PipelineWorkGraph active API'],
  [/\bWorkGraph(Node|Edge|NodeType|NodeShape|EdgeShape)?\b/g, 'WorkGraph active API'],
  [/\bworkGraph(Id)?\b/g, 'workGraph active field/API'],
  [/\bworkgraph\b/g, 'workgraph active field/API'],
  [/\bcurrentWorkGraphId\b/g, 'currentWorkGraphId active field/API'],
  [/\bsourceWorkGraphId\b/g, 'sourceWorkGraphId active field/API'],
  [/\breadWorkGraph\b/g, 'readWorkGraph active tool/API'],
  [/\bCoverageReport\b/g, 'CoverageReport active type/API'],
  [/\bPRD-/g, 'PRD artifact prefix'],
  [/\bWG-/g, 'WG artifact prefix'],
  [/\bCR-/g, 'CR artifact prefix'],
  [/specs\/prds/g, 'legacy Intent Specification path'],
  [/specs\/workgraphs/g, 'legacy Executable Specification path'],
  [/specs\/coverage-reports/g, 'legacy Verification Report path'],
  [/specs_prds/g, 'legacy Intent Specification collection'],
  [/specs_workgraphs/g, 'legacy Executable Specification collection'],
  [/specs_coverage_reports/g, 'legacy Verification Report collection'],
  [/\bgate_status\b/g, 'legacy verification status collection'],
  [/packages\/coverage-gates/g, 'legacy verification package path'],
  [/@factory\/coverage-gates/g, 'legacy verification package name'],
  [/\bcoverage-gates\b/g, 'legacy verification package slug'],
  [/packages\/prd-authoring/g, 'legacy intent authoring package path'],
  [/@factory\/prd-authoring/g, 'legacy intent authoring package name'],
  [/\bprd-authoring\b/g, 'legacy intent authoring package slug'],
  [/\bcoverage-gate-[123]\b/g, 'legacy verification skill slug'],
  [/\bcoverage-(coherence|fidelity|persistence)-verification\b/g, 'legacy coverage-prefixed skill slug'],
  [/\bGate[123](?!-)/g, 'Gate numbered active API'],
  [/\bGate [123]\b/g, 'Gate numbered active prose'],
  [/\bGATE[123]\b/g, 'GATE numbered artifact discriminator'],
  [/\bgate[123][A-Z_a-z]/g, 'gate numbered active field/API'],
  [/\bgate-[123]\b/g, 'gate numbered route/status discriminator'],
  [/\brunGate1\b/g, 'runGate1 active API'],
  [/\bemitGate1Report\b/g, 'emitGate1Report active API'],
  [/\bevaluateGate[123]\b/g, 'evaluateGate active API'],
  [/\bGate2Verdict\b/g, 'Gate2Verdict active API'],
  [/\bGate[123]Report\b/g, 'Gate report active type/API'],
  [/\bgateReport\b/g, 'gateReport compatibility field'],
  [/\bgateRequired\b/g, 'gateRequired compatibility field'],
  [/\bGATE_REQUIREMENTS\b/g, 'GATE_REQUIREMENTS compatibility map'],
  [/\bLegacyGateRequirement\b/g, 'LegacyGateRequirement compatibility type'],
  [/\blegacyStatus\b/g, 'legacyStatus compatibility field'],
  [/\blegacyRole\b/g, 'legacyRole compatibility field'],
  [/\bgate-1-failed\b/g, 'gate-1-failed compatibility status'],
  [/\/debug\/gate2-simulate\b/g, 'gate2 diagnostic compatibility route'],
]

const allowedFragments = [
  'createReadOnlyGate',
  'createCommandPolicyGate',
  'createFileScopeGate',
  'composeGates',
]

for (const file of activeSourceFiles(activeRoots)) {
  const rel = path.relative(root, file)
  const content = readFileSync(file, 'utf8')
  for (const [pattern, label] of forbiddenPatterns) {
    for (const match of content.matchAll(pattern)) {
      const line = lineAt(content, match.index ?? 0)
      if (allowedFragments.some((fragment) => line.includes(fragment))) {
        continue
      }
      failures.push(`${rel}:${lineNumberAt(content, match.index ?? 0)} forbidden ${label}: ${line.trim()}`)
    }
  }
}

console.log(`ontology_hard_cut_checks=${checks} failures=${failures.length}`)

for (const failure of failures) {
  console.error(failure)
}

if (failures.length > 0) {
  process.exit(1)
}

console.log('ontology hard-cut audit passed')

function expectIncludes(label, file, needle) {
  checks += 1
  const full = path.join(root, file)
  if (!existsSync(full)) {
    failures.push(`${label}: expected ${file} to exist`)
    return
  }
  const content = readFileSync(full, 'utf8')
  if (!content.includes(needle)) {
    failures.push(`${label}: expected ${file} to include ${needle}`)
  }
}

function activeSourceFiles(roots) {
  const files = []
  for (const relRoot of roots) {
    walk(path.join(root, relRoot), files)
  }
  return files.filter((file) => /\.(ts|tsx|js|mjs)$/.test(file))
}

function walk(dir, out) {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir)) {
    if (entry === 'dist' || entry === 'node_modules' || entry === '_attic' || entry.startsWith('.')) {
      continue
    }
    const full = path.join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      walk(full, out)
    } else {
      out.push(full)
    }
  }
}

function lineAt(content, index) {
  const start = content.lastIndexOf('\n', index) + 1
  const end = content.indexOf('\n', index)
  return content.slice(start, end === -1 ? content.length : end)
}

function lineNumberAt(content, index) {
  return content.slice(0, index).split('\n').length
}
