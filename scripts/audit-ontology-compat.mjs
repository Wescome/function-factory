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
  specsReadme: 'specs/README.md',
  referenceReadme: 'specs/reference/README.md',
  mapping: 'specs/reference/ONTOLOGY-CURRENT-MAPPING.md',
  blastRadius: 'specs/reference/ONTOLOGY-RENAME-BLAST-RADIUS.md',
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
  expectIncludes('blast-radius report forbids mass rename of specs/prds', blastRadius, 'No mass rename of `specs/prds`')
  expectIncludes('blast-radius report names compatibility audit script', blastRadius, 'scripts/audit-ontology-compat.mjs')
  expectIncludes('blast-radius report names compatibility audit command', blastRadius, 'pnpm audit:ontology')
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
