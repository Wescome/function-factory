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
  'packages/schemas/src/trellis-execution-packet.ts',
  'packages/schemas/src/trellis-canonical-json.ts',
  'packages/compiler/src/instruction-tuning.ts',
  'packages/schemas/src/core.ts',
  'packages/schemas/src/coverage.ts',
  'packages/compiler/src/passes/07-coherence-verification.ts',
  'packages/compiler/src/passes/08-assemble-executable-specification.ts',
  'packages/compiler/src/passes/_executable-specification-emit.ts',
  'packages/coverage-gates/src/coherence-verification.ts',
  'workers/ff-pipeline/src/coordinator/state.ts',
  'workers/ff-pipeline/src/trellis-instruction-tuning.ts',
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
  'Trellis packet schema is materialized',
  'packages/schemas/src/trellis-execution-packet.ts',
  'TrellisExecutionPacket',
)
expectIncludes(
  'Instruction Tuning emits Trellis packets',
  'packages/compiler/src/instruction-tuning.ts',
  'tuneInstructions',
)
expectIncludes(
  'Coordinator state carries TrellisExecutionPacket',
  'workers/ff-pipeline/src/coordinator/state.ts',
  'trellisExecutionPacket',
)
expectIncludes(
  'Worker synthesis boundary requires packet payload',
  'workers/ff-pipeline/src/index.ts',
  'trellisExecutionPacket is required for synthesis queue dispatch',
)
expectIncludes(
  'Coordinator rejects packet-less synthesis',
  'workers/ff-pipeline/src/coordinator/coordinator.ts',
  'trellisExecutionPacket is required for synthesis',
)

const activeRoots = [
  'packages/schemas/src',
  'packages/compiler/src',
  'packages/coverage-gates/src',
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
  [/\bGate[123](?!-)/g, 'Gate numbered active API'],
  [/\bgate[123][A-Z_a-z]/g, 'gate numbered active field/API'],
  [/\brunGate1\b/g, 'runGate1 active API'],
  [/\bemitGate1Report\b/g, 'emitGate1Report active API'],
  [/\bevaluateGate[123]\b/g, 'evaluateGate active API'],
  [/\bGate2Verdict\b/g, 'Gate2Verdict active API'],
  [/\bCoverageReport\b/g, 'CoverageReport active type/API'],
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
  'CR-',
  'GATE1',
  'GATE2',
  'GATE3',
  'PRD-',
  'WG-',
  'specs/prds',
  'specs/workgraphs',
  'specs/coverage-reports',
  'specs_prds',
  'specs_workgraphs',
  'specs_coverage_reports',
  'prdId',
  'gate_status',
  'gate-1',
  'gate-2',
  'gate-3',
  'gate:',
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
  const content = readFileSync(path.join(root, file), 'utf8')
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
    if (entry === 'dist' || entry === 'node_modules' || entry.startsWith('.')) {
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
