#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const checks = []

const files = {
  packageJson: 'package.json',
  ciWorkflow: '.github/workflows/ci.yml',
  schemaIndex: 'packages/schemas/src/index.ts',
  schemaPackageJson: 'packages/schemas/package.json',
  aliases: 'packages/schemas/src/ontology-aliases.ts',
  aliasTest: 'packages/schemas/src/ontology-aliases.test.ts',
  compiler: 'packages/compiler/src/compile.ts',
  coverageEmit: 'packages/coverage-gates/src/emit.ts',
  artifactValidatorReadme: 'packages/artifact-validator/README.md',
  functionSynthesisReadme: 'packages/function-synthesis/README.md',
  ontologyLoaderReadme: 'packages/ontology-loader/README.md',
  ffPipelineReadme: 'workers/ff-pipeline/README.md',
  ffGatesReadme: 'workers/ff-gates/README.md',
  ffGatewayReadme: 'workers/ff-gateway/README.md',
  arangoReadme: 'infra/arangodb/README.md',
  specsReadme: 'specs/README.md',
  referenceReadme: 'specs/reference/README.md',
  mapping: 'specs/reference/ONTOLOGY-CURRENT-MAPPING.md',
  blastRadius: 'specs/reference/ONTOLOGY-RENAME-BLAST-RADIUS.md',
  renameTemplate: 'specs/reference/ONTOLOGY-RENAME-PROPOSAL-TEMPLATE.md',
  arangoInitTs: 'infra/arangodb/init-db.ts',
  arangoInitJs: 'infra/arangodb/init/001-create-db.js',
  arangoSeed: 'infra/arangodb/seed.ts',
  arangoVerify: 'infra/arangodb/verify.ts',
  ontologyClasses: 'packages/ontology-loader/src/classes.ts',
  ontologyInstances: 'packages/ontology-loader/src/instances.ts',
  pipelineIndex: 'workers/ff-pipeline/src/index.ts',
  pipelineLifecycle: 'workers/ff-pipeline/src/lifecycle.ts',
  pipelineCompileStage: 'workers/ff-pipeline/src/stages/compile.ts',
  gatesWorker: 'workers/ff-gates/src/index.ts',
}

for (const [label, file] of Object.entries(files)) {
  checkExists(label, file)
}

checkPackageScript()
checkCiGate()
checkSchemaAliases()
checkCompilerPathContracts()
checkDocsSurfaces()
checkPackageAliasReadmes()
checkWorkerAliasReadmes()
checkInfraAliasReadmes()
checkRenameProposalTemplate()
checkRuntimeCollectionContracts()

for (const failure of failures) {
  console.error(failure)
}

console.log(`ontology_compat_checks=${checks.length} failures=${failures.length}`)

if (failures.length > 0) {
  process.exit(1)
}

console.log('ontology compatibility audit passed')

function checkPackageScript() {
  const pkg = readJson(files.packageJson)
  expectEqual('root package exposes audit:ontology script', pkg.scripts?.['audit:ontology'], 'node scripts/audit-ontology-compat.mjs')
}

function checkCiGate() {
  const ciWorkflow = read(files.ciWorkflow)

  expectIncludes('CI runs ontology compatibility audit', ciWorkflow, 'pnpm audit:ontology')
  expectIncludes('CI runs docs audit before rename work', ciWorkflow, 'pnpm audit:docs')
  expectIncludes('Factory PR Gate depends on repository audit', ciWorkflow, 'needs: [typecheck, test, repository-audit]')
}

function checkSchemaAliases() {
  const aliases = read(files.aliases)
  const aliasTest = read(files.aliasTest)
  const schemaIndex = read(files.schemaIndex)
  const schemaPackage = read(files.schemaPackageJson)

  const aliasPairs = [
    ['IntentSpecification', 'PRDDraft'],
    ['ExecutableSpecification', 'WorkGraph'],
    ['InvariantSpecification', 'Invariant'],
    ['VerificationReport', 'CoverageReport'],
    ['CoherenceVerificationReport', 'Gate1Report'],
    ['FidelityVerificationReport', 'Gate2Report'],
    ['PersistenceVerificationReport', 'Gate3Report'],
  ]

  for (const [alias, current] of aliasPairs) {
    expectIncludes(`schema alias ${alias} points to ${current}`, aliases, `export const ${alias} = ${current}`)
    expectIncludes(`schema alias ${alias} has type export`, aliases, `export type ${alias} = Current`)
    expectIncludes(`schema alias test covers ${alias}`, aliasTest, alias)
  }

  expectIncludes('schema package index re-exports ontology aliases', schemaIndex, 'export * from "./ontology-aliases.js"')
  expectIncludes('schema package exports ontology alias subpath', schemaPackage, '"./ontology-aliases": "./src/ontology-aliases.ts"')
}

function checkCompilerPathContracts() {
  const compiler = read(files.compiler)
  const coverageEmit = read(files.coverageEmit)

  expectIncludes('compiler retains default coverage report path', compiler, '"coverage-reports"')
  expectIncludes('compiler retains default workgraph path', compiler, '"workgraphs"')
  expectIncludes('compiler docs retain PRD source path contract', compiler, '<repo>/specs/prds/PRD-*.md')
  expectIncludes('coverage gate emitter retains coverage report default path', coverageEmit, 'specs/coverage-reports')
}

function checkDocsSurfaces() {
  const specsReadme = read(files.specsReadme)
  const referenceReadme = read(files.referenceReadme)
  const mapping = read(files.mapping)
  const blastRadius = read(files.blastRadius)

  const docsTerms = [
    'Intent Specification',
    'Executable Specification',
    'Verification Report',
    'Coherence Verification',
    'Fidelity Verification',
    'Persistence Verification',
  ]

  for (const term of docsTerms) {
    expectIncludes(`specs README documents ${term}`, specsReadme, term)
    expectIncludes(`mapping documents ${term}`, mapping, term)
  }

  expectIncludes('reference index links ontology current mapping', referenceReadme, 'ONTOLOGY-CURRENT-MAPPING.md')
  expectIncludes('reference index links rename blast-radius report', referenceReadme, 'ONTOLOGY-RENAME-BLAST-RADIUS.md')
  expectIncludes('reference index links rename proposal template', referenceReadme, 'ONTOLOGY-RENAME-PROPOSAL-TEMPLATE.md')
  expectIncludes('blast-radius report forbids mass rename of specs/prds', blastRadius, 'No mass rename of `specs/prds`')
  expectIncludes('blast-radius report names compatibility audit script', blastRadius, 'scripts/audit-ontology-compat.mjs')
  expectIncludes('blast-radius report names compatibility audit command', blastRadius, 'pnpm audit:ontology')
  expectIncludes('blast-radius report points future renames to template', blastRadius, 'ONTOLOGY-RENAME-PROPOSAL-TEMPLATE.md')
  expectIncludes('current mapping requires rename proposal template', mapping, 'ONTOLOGY-RENAME-PROPOSAL-TEMPLATE.md')
}

function checkPackageAliasReadmes() {
  const packageReadmes = [
    [files.artifactValidatorReadme, '@factory/artifact-validator', 'constraint enforcement'],
    [files.functionSynthesisReadme, '@factory/function-synthesis', 'Fidelity Verification'],
    [files.ontologyLoaderReadme, '@factory/ontology-loader', 'Queryable ontology'],
  ]

  for (const [file, packageName, ontologyRole] of packageReadmes) {
    const content = read(file)
    expectIncludes(`${packageName} README has ontology alias section`, content, '## Ontology Alias')
    expectIncludes(`${packageName} README keeps package compatibility name`, content, packageName)
    expectIncludes(`${packageName} README documents ontology role`, content, ontologyRole)
    expectIncludes(`${packageName} README names stable compatibility`, content, 'stable compatibility')
  }

  expectIncludes('artifact validator README retains specs_workgraphs collection', read(files.artifactValidatorReadme), 'specs_workgraphs')
  expectIncludes('artifact validator README retains specs_coverage_reports collection', read(files.artifactValidatorReadme), 'specs_coverage_reports')
  expectIncludes('function synthesis README retains WorkGraph compatibility term', read(files.functionSynthesisReadme), 'WorkGraph')
  expectIncludes('function synthesis README retains Gate 2 compatibility term', read(files.functionSynthesisReadme), 'Gate 2')
  expectIncludes('ontology loader README retains specs_prds collection', read(files.ontologyLoaderReadme), 'specs_prds')
  expectIncludes('ontology loader README retains specs_workgraphs collection', read(files.ontologyLoaderReadme), 'specs_workgraphs')
  expectIncludes('ontology loader README retains specs_coverage_reports collection', read(files.ontologyLoaderReadme), 'specs_coverage_reports')
}

function checkWorkerAliasReadmes() {
  const workerReadmes = [
    [files.ffPipelineReadme, '@factory/ff-pipeline', 'Fidelity Verification'],
    [files.ffGatesReadme, '@factory/ff-gates', 'Coherence Verification'],
    [files.ffGatewayReadme, '@factory/ff-gateway', 'Coherence Verification'],
  ]

  for (const [file, packageName, ontologyRole] of workerReadmes) {
    const content = read(file)
    expectIncludes(`${packageName} README has ontology alias section`, content, '## Ontology Alias')
    expectIncludes(`${packageName} README keeps package compatibility name`, content, packageName)
    expectIncludes(`${packageName} README documents ontology role`, content, ontologyRole)
    expectIncludes(`${packageName} README names stable compatibility`, content, 'stable compatibility')
  }

  expectIncludes('ff-pipeline README retains specs_workgraphs collection', read(files.ffPipelineReadme), 'specs_workgraphs')
  expectIncludes('ff-pipeline README retains specs_coverage_reports collection', read(files.ffPipelineReadme), 'specs_coverage_reports')
  expectIncludes('ff-pipeline README retains MRP compatibility term', read(files.ffPipelineReadme), 'MRP')
  expectIncludes('ff-pipeline README requires rename proposal template', read(files.ffPipelineReadme), 'ONTOLOGY-RENAME-PROPOSAL-TEMPLATE.md')
  expectIncludes('ff-gates README retains Gate1Report compatibility term', read(files.ffGatesReadme), 'Gate1Report')
  expectIncludes('ff-gates README retains specs_workgraphs collection', read(files.ffGatesReadme), 'specs_workgraphs')
  expectIncludes('ff-gateway README retains gate route compatibility', read(files.ffGatewayReadme), '/gate/1')
  expectIncludes('ff-gateway README retains MRP route compatibility', read(files.ffGatewayReadme), '/mrps/pending')
}

function checkInfraAliasReadmes() {
  const arangoReadme = read(files.arangoReadme)

  expectIncludes('Arango README has ontology alias section', arangoReadme, '## Ontology Alias')
  expectIncludes('Arango README names stable compatibility collections', arangoReadme, 'stable compatibility names')
  expectIncludes('Arango README documents Intent Specification', arangoReadme, 'Intent Specification')
  expectIncludes('Arango README documents Executable Specification', arangoReadme, 'Executable Specification')
  expectIncludes('Arango README documents Verification Report', arangoReadme, 'Verification Report')
  expectIncludes('Arango README documents Persistence Verification', arangoReadme, 'Persistence Verification')
  expectIncludes('Arango README retains specs_prds collection', arangoReadme, 'specs_prds')
  expectIncludes('Arango README retains specs_workgraphs collection', arangoReadme, 'specs_workgraphs')
  expectIncludes('Arango README retains specs_invariants collection', arangoReadme, 'specs_invariants')
  expectIncludes('Arango README retains specs_coverage_reports collection', arangoReadme, 'specs_coverage_reports')
  expectIncludes('Arango README retains lineage_edges collection', arangoReadme, 'lineage_edges')
  expectIncludes('Arango README requires dual-read compatibility', arangoReadme, 'dual-read compatibility')
  expectIncludes('Arango README requires rename proposal template', arangoReadme, 'ONTOLOGY-RENAME-PROPOSAL-TEMPLATE.md')
}

function checkRenameProposalTemplate() {
  const renameTemplate = read(files.renameTemplate)

  const requiredSections = [
    '# Ontology Rename Proposal Template',
    '## Rename Family',
    '## Decision',
    '## Compatibility Strategy',
    '## Blast Radius',
    '## Rollback Plan',
    '## Verification Plan',
    '## Non-Starters',
  ]

  for (const section of requiredSections) {
    expectIncludes(`rename proposal template includes ${section}`, renameTemplate, section)
  }

  const requiredTerms = [
    'exactly one rename family',
    'current compatibility contract',
    'pnpm audit:docs',
    'pnpm audit:ontology',
    'Repository Audit',
    'Factory PR Gate',
    'packages/schemas/src/core.ts',
    '.agent/AGENTS.md',
    '.agent/skills/*',
    'dual-read compatibility',
  ]

  for (const term of requiredTerms) {
    expectIncludes(`rename proposal template requires ${term}`, renameTemplate, term)
  }
}

function checkRuntimeCollectionContracts() {
  const collectionFiles = [
    files.arangoInitTs,
    files.arangoInitJs,
    files.arangoSeed,
    files.arangoVerify,
    files.ontologyClasses,
    files.ontologyInstances,
  ]
  const collections = ['specs_prds', 'specs_workgraphs', 'specs_coverage_reports']

  for (const file of collectionFiles) {
    const content = read(file)
    for (const collection of collections) {
      expectIncludes(`${file} retains ${collection}`, content, collection)
    }
  }

  expectIncludes('ff-pipeline runtime still writes specs_coverage_reports', read(files.pipelineIndex), 'specs_coverage_reports')
  expectIncludes('ff-pipeline lifecycle still queries specs_coverage_reports', read(files.pipelineLifecycle), 'specs_coverage_reports')
  expectIncludes('ff-pipeline compile stage still writes specs_workgraphs', read(files.pipelineCompileStage), 'specs_workgraphs')
  expectIncludes('ff-gates lineage still starts from specs_workgraphs', read(files.gatesWorker), 'specs_workgraphs/')
}

function checkExists(label, file) {
  checks.push(label)
  if (!existsSync(resolve(file))) {
    failures.push(`missing-file ${file}`)
  }
}

function expectIncludes(label, content, expected) {
  checks.push(label)
  if (!content.includes(expected)) {
    failures.push(`missing-content ${label}: ${expected}`)
  }
}

function expectEqual(label, actual, expected) {
  checks.push(label)
  if (actual !== expected) {
    failures.push(`unexpected-value ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function read(file) {
  return readFileSync(resolve(file), 'utf8')
}

function readJson(file) {
  return JSON.parse(read(file))
}

function resolve(file) {
  return path.join(root, file)
}
