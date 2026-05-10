#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const checks = []

const files = {
  packageJson: 'package.json',
  rootReadme: 'README.md',
  ciWorkflow: '.github/workflows/ci.yml',
  agentMap: '.agent/AGENTS.md',
  skillIndex: '.agent/skills/_index.md',
  semanticLessons: '.agent/memory/semantic/LESSONS.md',
  schemaIndex: 'packages/schemas/src/index.ts',
  schemaPackageJson: 'packages/schemas/package.json',
  coverageSchema: 'packages/schemas/src/coverage.ts',
  sdlcSchema: 'packages/schemas/src/sdlc.ts',
  sdlcSchemaTest: 'packages/schemas/src/sdlc.test.ts',
  domainAdapterSchema: 'packages/schemas/src/domain-adapter.ts',
  domainAdapterSchemaTest: 'packages/schemas/src/domain-adapter.test.ts',
  codingDomainAdapter: 'packages/schemas/src/coding-domain-adapter.ts',
  codingDomainAdapterTest: 'packages/schemas/src/coding-domain-adapter.test.ts',
  compilerPackageJson: 'packages/compiler/package.json',
  coverageGatesPackageJson: 'packages/coverage-gates/package.json',
  prdAuthoringPackageJson: 'packages/prd-authoring/package.json',
  runtimeAdmissionPackageJson: 'packages/runtime-admission/package.json',
  artifactValidatorPackageJson: 'packages/artifact-validator/package.json',
  functionSynthesisPackageJson: 'packages/function-synthesis/package.json',
  ontologyLoaderPackageJson: 'packages/ontology-loader/package.json',
  ffPipelinePackageJson: 'workers/ff-pipeline/package.json',
  ffGatesPackageJson: 'workers/ff-gates/package.json',
  ffGatewayPackageJson: 'workers/ff-gateway/package.json',
  aliases: 'packages/schemas/src/ontology-aliases.ts',
  aliasTest: 'packages/schemas/src/ontology-aliases.test.ts',
  compiler: 'packages/compiler/src/compile.ts',
  compilerCli: 'packages/compiler/src/cli.ts',
  compilerExtractAtoms: 'packages/compiler/src/passes/01-extract-atoms.ts',
  compilerPassCoherenceVerification: 'packages/compiler/src/passes/07-gate-1.ts',
  compilerDeriveInvariants: 'packages/compiler/src/passes/03-derive-invariants.ts',
  compilerAssembleWorkgraph: 'packages/compiler/src/passes/08-assemble-workgraph.ts',
  compilerWorkgraphEmit: 'packages/compiler/src/passes/_workgraph-emit.ts',
  compilerPassIndex: 'packages/compiler/src/passes/index.ts',
  compilerAssemblyTest: 'packages/compiler/src/passes/08-assemble-workgraph.test.ts',
  compilerTestFixtures: 'packages/compiler/src/passes/_test-fixtures.ts',
  compilerReadme: 'packages/compiler/README.md',
  coverageGatesIndex: 'packages/coverage-gates/src/index.ts',
  coverageGatesChecks: 'packages/coverage-gates/src/checks.ts',
  coverageGatesGate1: 'packages/coverage-gates/src/gate-1.ts',
  coverageGatesEmit: 'packages/coverage-gates/src/emit.ts',
  coverageEmit: 'packages/coverage-gates/src/emit.ts',
  functionSynthesisTypes: 'packages/function-synthesis/src/types.ts',
  functionSynthesisEvidence: 'packages/function-synthesis/src/evidence.ts',
  artifactValidatorReadme: 'packages/artifact-validator/README.md',
  functionSynthesisReadme: 'packages/function-synthesis/README.md',
  ontologyLoaderReadme: 'packages/ontology-loader/README.md',
  ffPipelineReadme: 'workers/ff-pipeline/README.md',
  ffGatesReadme: 'workers/ff-gates/README.md',
  ffGatewayReadme: 'workers/ff-gateway/README.md',
  arangoReadme: 'infra/arangodb/README.md',
  specsReadme: 'specs/README.md',
  referenceReadme: 'specs/reference/README.md',
  domainKernel: 'specs/reference/DOMAIN-FACTORY-KERNEL.md',
  compatibilityContract: 'specs/reference/ONTOLOGY-COMPATIBILITY-CONTRACT.json',
  addendumA: 'specs/reference/FF-ONTOLOGY-ADDENDUM-A.md',
  addendumB: 'specs/reference/ONTOLOGY-ADDENDUM-B-STAGE-EXTENSIONS.md',
  mapping: 'specs/reference/ONTOLOGY-CURRENT-MAPPING.md',
  blastRadius: 'specs/reference/ONTOLOGY-RENAME-BLAST-RADIUS.md',
  renameTemplate: 'specs/reference/ONTOLOGY-RENAME-PROPOSAL-TEMPLATE.md',
  refactorReadiness: 'specs/reference/ONTOLOGY-REFACTOR-READINESS-CHECKLIST.md',
  arangoInitTs: 'infra/arangodb/init-db.ts',
  arangoInitJs: 'infra/arangodb/init/001-create-db.js',
  arangoSeed: 'infra/arangodb/seed.ts',
  arangoVerify: 'infra/arangodb/verify.ts',
  ontologyClasses: 'packages/ontology-loader/src/classes.ts',
  ontologyConstraints: 'packages/ontology-loader/src/constraints.ts',
  ontologyInstances: 'packages/ontology-loader/src/instances.ts',
  ontologyProperties: 'packages/ontology-loader/src/properties.ts',
  pipelineIndex: 'workers/ff-pipeline/src/index.ts',
  pipelineWorkflow: 'workers/ff-pipeline/src/pipeline.ts',
  pipelineLifecycle: 'workers/ff-pipeline/src/lifecycle.ts',
  pipelineCompileStage: 'workers/ff-pipeline/src/stages/compile.ts',
  pipelineCoordinatorState: 'workers/ff-pipeline/src/coordinator/state.ts',
  pipelineCoordinatorGraph: 'workers/ff-pipeline/src/coordinator/graph.ts',
  pipelineRuntimeVerification: 'workers/ff-pipeline/src/runtime-verification.ts',
  pipelineGenerateFeedback: 'workers/ff-pipeline/src/stages/generate-feedback.ts',
  pipelineFidelityVerification: 'workers/ff-pipeline/src/gate2-simulation.ts',
  pipelinePersistenceVerification: 'workers/ff-pipeline/src/gate3-assurance.ts',
  pipelineMergeReadinessPack: 'workers/ff-pipeline/src/merge-readiness-pack.ts',
  pipelineSynthesisPrDraft: 'workers/ff-pipeline/src/synthesis-pr-draft.ts',
  gatesWorker: 'workers/ff-gates/src/index.ts',
  gatewayWorker: 'workers/ff-gateway/src/index.ts',
  gatewayEnv: 'workers/ff-gateway/src/env.ts',
  gatewayTypes: 'workers/ff-gateway/src/types.ts',
}

for (const [label, file] of Object.entries(files)) {
  checkExists(label, file)
}

checkPackageScript()
checkCompatibilityContractManifest()
checkCurrentCompatibilitySurfaces()
checkNoUnapprovedOntologyRenameTargets()
checkNoUnapprovedOntologyCollectionTargets()
checkCiGate()
checkSchemaAliases()
checkDomainAdapterSchemas()
checkCodingDomainAdapterContract()
checkLegacyNumberConcordance()
checkCompilerPathContracts()
checkDocsSurfaces()
checkDomainFactoryKernel()
checkActiveTerminologySurfaces()
checkPackageAliasReadmes()
checkWorkerAliasReadmes()
checkInfraAliasReadmes()
checkRenameProposalTemplate()
checkRefactorReadinessChecklist()
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
  expectIncludes('root package keeps packages workspace glob', read(files.packageJson), '"packages/*"')
  expectIncludes('root package keeps workers workspace glob', read(files.packageJson), '"workers/*"')
}

function checkCompatibilityContractManifest() {
  const contract = readJson(files.compatibilityContract)

  expectEqual('compatibility contract schema version', contract.schemaVersion, 1)
  expectEqual('compatibility contract status', contract.status, 'active compatibility contract')

  expectArrayIncludes('compatibility contract keeps specs/prds stable', contract.stableDirectories, 'specs/prds')
  expectArrayIncludes('compatibility contract keeps specs/workgraphs stable', contract.stableDirectories, 'specs/workgraphs')
  expectArrayIncludes('compatibility contract keeps specs/coverage-reports stable', contract.stableDirectories, 'specs/coverage-reports')
  expectArrayIncludes('compatibility contract keeps packages/compiler stable', contract.stableDirectories, 'packages/compiler')
  expectArrayIncludes('compatibility contract keeps workers/ff-pipeline stable', contract.stableDirectories, 'workers/ff-pipeline')
  expectArrayIncludes('compatibility contract keeps infra/arangodb stable', contract.stableDirectories, 'infra/arangodb')

  const stablePackageNames = contract.stablePackages.map((entry) => entry.name)
  expectArrayIncludes('compatibility contract keeps @factory/schemas stable', stablePackageNames, '@factory/schemas')
  expectArrayIncludes('compatibility contract keeps @factory/compiler stable', stablePackageNames, '@factory/compiler')
  expectArrayIncludes('compatibility contract keeps @factory/coverage-gates stable', stablePackageNames, '@factory/coverage-gates')
  expectArrayIncludes('compatibility contract keeps @factory/ff-pipeline stable', stablePackageNames, '@factory/ff-pipeline')

  for (const stablePackage of contract.stablePackages) {
    checkExists(`compatibility contract package manifest ${stablePackage.manifest}`, stablePackage.manifest)
  }

  expectArrayIncludes('compatibility contract forbids specs/intent-specifications', contract.forbiddenOntologyRenameTargets, 'specs/intent-specifications')
  expectArrayIncludes('compatibility contract forbids specs/executable-specifications', contract.forbiddenOntologyRenameTargets, 'specs/executable-specifications')
  expectArrayIncludes('compatibility contract forbids specs/verification-reports', contract.forbiddenOntologyRenameTargets, 'specs/verification-reports')
  expectArrayIncludes('compatibility contract forbids packages/verification', contract.forbiddenOntologyRenameTargets, 'packages/verification')
  expectArrayIncludes('compatibility contract forbids workers/ff-fidelity-verification', contract.forbiddenOntologyRenameTargets, 'workers/ff-fidelity-verification')

  expectArrayIncludes('compatibility contract scans Arango init', contract.runtimeCollectionFilesToScan, files.arangoInitTs)
  expectArrayIncludes('compatibility contract scans ontology classes', contract.runtimeCollectionFilesToScan, files.ontologyClasses)
  expectArrayIncludes('compatibility contract scans ff-pipeline runtime', contract.runtimeCollectionFilesToScan, files.pipelineIndex)
  expectArrayIncludes('compatibility contract scans ff-gates runtime', contract.runtimeCollectionFilesToScan, files.gatesWorker)

  for (const runtimeFile of contract.runtimeCollectionFilesToScan) {
    checkExists(`compatibility contract runtime collection scan file ${runtimeFile}`, runtimeFile)
  }

  expectArrayIncludes('compatibility contract keeps legacy gate-2 discriminator explicit', contract.stableRuntimeDiscriminators, 'gate-2')
  expectArrayIncludes('compatibility contract keeps legacy gateReport explicit', contract.stableRuntimeDiscriminators, 'gateReport')
  expectArrayIncludes('compatibility contract records Coherence Verification primary runtime alias', contract.primaryRuntimeAliases, 'coherence-verification')
  expectArrayIncludes('compatibility contract records Fidelity Verification primary runtime alias', contract.primaryRuntimeAliases, 'fidelity-verification')
  expectArrayIncludes('compatibility contract records verificationReport primary runtime alias', contract.primaryRuntimeAliases, 'verificationReport')

  expectEqual('compatibility contract links legacy number concordance', contract.legacyNumberConcordance?.source, files.addendumA)
  expectEqual('compatibility contract links stage extension concordance', contract.legacyNumberConcordance?.stageExtensions, files.addendumB)
  expectEqual('compatibility contract links current mapping for concordance', contract.legacyNumberConcordance?.currentMapping, files.mapping)
  expectEqual('compatibility contract maps Stage 1', contract.legacyNumberConcordance?.stageLabels?.['Stage 1'], 'Signal Artifact collection')
  expectEqual('compatibility contract maps Stage 7', contract.legacyNumberConcordance?.stageLabels?.['Stage 7'], 'Persistence Verification / continuous assurance')
  expectEqual('compatibility contract maps Stage 8 extension', contract.legacyNumberConcordance?.stageLabels?.['Stage 8'], 'Merge Readiness / PR Handoff / Function identity materialization')
  expectEqual('compatibility contract maps Stage 9 extension', contract.legacyNumberConcordance?.stageLabels?.['Stage 9'], 'Meta-Governance / policy evolution')
  expectEqual('compatibility contract maps Gate 2a', contract.legacyNumberConcordance?.gateLabels?.['Gate 2a'], 'Fidelity Verification (learned)')
  expectEqual('compatibility contract maps Gate 2b', contract.legacyNumberConcordance?.gateLabels?.['Gate 2b'], 'Fidelity Verification (deterministic)')
  expectEqual('compatibility contract maps current repo Pass 8 compatibility', contract.legacyNumberConcordance?.compilerPassLabels?.['Current repo Pass 8'], 'Structural Assembly completion compatibility label')
  expectEqual('compatibility contract maps ontology Pass 8 future', contract.legacyNumberConcordance?.compilerPassLabels?.['Ontology Pass 8'], 'Instruction Tuning (future)')

  expectArrayIncludes('compatibility contract forbids specs_intent_specifications', contract.forbiddenOntologyCollectionTargets, 'specs_intent_specifications')
  expectArrayIncludes('compatibility contract forbids specs_executable_specifications', contract.forbiddenOntologyCollectionTargets, 'specs_executable_specifications')
  expectArrayIncludes('compatibility contract forbids specs_verification_reports', contract.forbiddenOntologyCollectionTargets, 'specs_verification_reports')
  expectArrayIncludes('compatibility contract forbids fidelity_verifications', contract.forbiddenOntologyCollectionTargets, 'fidelity_verifications')
}

function checkCurrentCompatibilitySurfaces() {
  const contract = readJson(files.compatibilityContract)

  for (const stableDir of contract.stableDirectories) {
    checkExists(`stable compatibility directory ${stableDir}`, stableDir)
  }

  for (const stablePackage of contract.stablePackages) {
    expectEqual(`${stablePackage.name} package name remains stable`, readJson(stablePackage.manifest).name, stablePackage.name)
  }
}

function checkNoUnapprovedOntologyRenameTargets() {
  const contract = readJson(files.compatibilityContract)

  for (const forbiddenPath of contract.forbiddenOntologyRenameTargets) {
    expectAbsent(`unapproved ontology rename target ${forbiddenPath}`, forbiddenPath)
  }
}

function checkNoUnapprovedOntologyCollectionTargets() {
  const contract = readJson(files.compatibilityContract)

  for (const file of contract.runtimeCollectionFilesToScan) {
    const content = read(file)
    for (const collection of contract.forbiddenOntologyCollectionTargets) {
      expectExcludes(`${file} does not introduce ${collection}`, content, collection)
    }
  }
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
  ]

  for (const [alias, current] of aliasPairs) {
    expectIncludes(`schema alias ${alias} points to ${current}`, aliases, `export const ${alias} = ${current}`)
    expectIncludes(`schema alias ${alias} has type export`, aliases, `export type ${alias} = Current`)
    expectIncludes(`schema alias test covers ${alias}`, aliasTest, alias)
  }

  expectIncludes('schema package index re-exports ontology aliases', schemaIndex, 'export * from "./ontology-aliases.js"')
  expectIncludes('schema package exports ontology alias subpath', schemaPackage, '"./ontology-aliases": "./src/ontology-aliases.ts"')
  expectIncludes('ontology alias module re-exports primary Coherence Verification report', aliases, 'export const CoherenceVerificationReport = CurrentCoherenceVerificationReportValue')
  expectIncludes('ontology alias module re-exports primary Fidelity Verification report', aliases, 'export const FidelityVerificationReport = CurrentFidelityVerificationReportValue')
  expectIncludes('ontology alias module re-exports primary Fidelity Verification verdict', aliases, 'export const FidelityVerificationVerdict = CurrentFidelityVerificationVerdictValue')
  expectIncludes('ontology alias module re-exports primary Persistence Verification report', aliases, 'export const PersistenceVerificationReport = CurrentPersistenceVerificationReportValue')
  expectIncludes('coverage schema defines Coherence Verification report as primary', read(files.coverageSchema), 'export const CoherenceVerificationReport = Lineage.extend')
  expectIncludes('coverage schema keeps Gate1Report compatibility alias', read(files.coverageSchema), 'export const Gate1Report = CoherenceVerificationReport')
  expectIncludes('coverage schema defines Fidelity Verification report as primary', read(files.coverageSchema), 'export const FidelityVerificationReport = Lineage.extend')
  expectIncludes('coverage schema keeps Gate2Report compatibility alias', read(files.coverageSchema), 'export const Gate2Report = FidelityVerificationReport')
  expectIncludes('coverage schema defines Persistence Verification report as primary', read(files.coverageSchema), 'export const PersistenceVerificationReport = Lineage.extend')
  expectIncludes('coverage schema keeps Gate3Report compatibility alias', read(files.coverageSchema), 'export const Gate3Report = PersistenceVerificationReport')
  expectIncludes('coverage-gates exports Coherence Verification runner', read(files.coverageGatesIndex), 'runCoherenceVerification')
  expectIncludes('coverage-gates runner keeps legacy Gate 1 alias', read(files.coverageGatesGate1), 'export const runGate1 = runCoherenceVerification')
  expectIncludes('coverage-gates checks define Coherence Verification input first', read(files.coverageGatesChecks), 'export interface CoherenceVerificationInput')
  expectIncludes('coverage-gates checks keep Gate 1 input alias', read(files.coverageGatesChecks), 'export type Gate1Input = CoherenceVerificationInput')
  expectIncludes('coverage-gates emit keeps legacy Gate 1 report alias', read(files.coverageGatesEmit), 'export const emitGate1Report = emitCoherenceVerificationReport')
  expectIncludes('compiler invokes Coherence Verification pass', read(files.compiler), 'runCoherenceVerificationPass')
  expectIncludes('compiler pass invokes Coherence Verification evaluator', read(files.compilerPassCoherenceVerification), 'runCoherenceVerification')
  expectIncludes('compiler pass emits Coherence Verification report', read(files.compilerPassCoherenceVerification), 'emitCoherenceVerificationReport')
  expectIncludes('compiler generated invariants use Coherence Verification report name', read(files.compilerDeriveInvariants), 'Coherence Verification produces byte-identical CoherenceVerificationReport')
  expectIncludes('compiler extracted atoms use Coherence Verification subject', read(files.compilerExtractAtoms), 'subject: "Coherence Verification"')
  expectIncludes('compiler CLI prints Coherence Verification verdict', read(files.compilerCli), 'Coherence Verification- ${result.report.overall.toUpperCase()}')
  expectIncludes('compiler assembly consumes Coherence Verification report', read(files.compilerAssembleWorkgraph), 'coherenceVerificationReport: CoherenceVerificationReport')
  expectIncludes('compiler exposes Executable Specification assembly alias', read(files.compilerAssembleWorkgraph), 'export function assembleExecutableSpecification')
  expectIncludes('compiler keeps assembleWorkgraph compatibility alias', read(files.compilerAssembleWorkgraph), 'export const assembleWorkgraph = assembleExecutableSpecification')
  expectIncludes('compiler exposes Executable Specification emit alias', read(files.compilerWorkgraphEmit), 'export const emitExecutableSpecification = emitWorkgraph')
  expectIncludes('compiler pass index exports Executable Specification assembly', read(files.compilerPassIndex), 'assembleExecutableSpecification')
  expectIncludes('compiler assembly tests alias compatibility', read(files.compilerAssemblyTest), 'expect(assembleWorkgraph).toBe(assembleExecutableSpecification)')
  expectIncludes('compiler assembly docs mark ontology Pass 8 future', read(files.compilerAssembleWorkgraph), 'ontology v0.2 reserves Pass 8 for future')
  expectIncludes('compiler fixtures build Coherence Verification reports first', read(files.compilerTestFixtures), 'export function makeCoherenceVerificationReportPassing')
  expectIncludes('compiler fixtures keep legacy Gate 1 report helper alias', read(files.compilerTestFixtures), 'export const makeGate1ReportPassing = makeCoherenceVerificationReportPassing')
  expectIncludes('function synthesis makes FidelityVerificationInput the primary schema', read(files.functionSynthesisTypes), 'export const FidelityVerificationInput = z.object')
  expectIncludes('function synthesis requires FidelityVerificationInput on SynthesisResult', read(files.functionSynthesisTypes), 'fidelityVerificationInput: FidelityVerificationInput,')
  expectIncludes('function synthesis keeps optional gate2Input compatibility field on SynthesisResult', read(files.functionSynthesisTypes), 'gate2Input: Gate2Input.optional()')
  expectIncludes('function synthesis keeps legacy Gate2Input schema alias', read(files.functionSynthesisTypes), 'export const Gate2Input = FidelityVerificationInput')
  expectIncludes('function synthesis keeps legacy Gate2Input type alias', read(files.functionSynthesisTypes), 'export type Gate2Input = FidelityVerificationInput')
  expectIncludes('function synthesis builds FidelityVerificationInput', read(files.functionSynthesisEvidence), 'buildFidelityVerificationInput')
  expectIncludes('function synthesis uses Fidelity Verification builder input as primary', read(files.functionSynthesisEvidence), 'export interface FidelityVerificationInputBuilderInput')
  expectIncludes('function synthesis keeps legacy Gate2Input builder input alias', read(files.functionSynthesisEvidence), 'export type Gate2InputBuilderInput = FidelityVerificationInputBuilderInput')
  expectIncludes('function synthesis keeps legacy Gate2Input builder alias', read(files.functionSynthesisEvidence), 'export const buildGate2Input = buildFidelityVerificationInput')
  expectIncludes('ff-pipeline defines Fidelity Verification evaluator as primary', read(files.pipelineFidelityVerification), 'export function evaluateFidelityVerification')
  expectIncludes('ff-pipeline keeps legacy Gate 2 evaluator alias', read(files.pipelineFidelityVerification), 'export const evaluateGate2Simulation = evaluateFidelityVerification')
  expectIncludes('ff-pipeline defines Fidelity Verification contract adapter as primary', read(files.pipelineFidelityVerification), 'export function evaluateFidelityVerificationFromContractInput')
  expectIncludes('ff-pipeline keeps legacy Gate 2 contract adapter alias', read(files.pipelineFidelityVerification), 'export const evaluateGate2FromContractInput = evaluateFidelityVerificationFromContractInput')
  expectIncludes('ff-pipeline defines Fidelity Verification input as primary', read(files.pipelineFidelityVerification), 'export interface FidelityVerificationInput')
  expectIncludes('ff-pipeline keeps legacy Gate 2 simulation input alias', read(files.pipelineFidelityVerification), 'export type Gate2SimulationInput = FidelityVerificationInput')
  expectIncludes('ff-pipeline dry-run exposes Fidelity Verification report key primary', read(files.pipelineFidelityVerification), 'verificationReport: string')
  expectIncludes('MRP schema accepts Fidelity Verification report id', read(files.sdlcSchema), 'fidelityVerificationReportId')
  expectIncludes('MRP schema accepts Coherence Verification report id', read(files.sdlcSchema), 'coherenceVerificationReportId')
  expectIncludes('MRP schema test covers Fidelity Verification report id', read(files.sdlcSchemaTest), 'fidelityVerificationReportId')
  expectIncludes('MRP schema test covers Coherence Verification report id', read(files.sdlcSchemaTest), 'coherenceVerificationReportId')
  expectIncludes('MRP helper exposes Fidelity Verification evidence overlay', read(files.pipelineMergeReadinessPack), 'withFidelityVerificationReportEvidence')
  expectIncludes('MRP helper keeps legacy Gate 2 evidence overlay', read(files.pipelineMergeReadinessPack), 'export function withGate2ReportEvidence')
  expectIncludes('MRP canonical evidence accepts Coherence Verification report id', read(files.pipelineMergeReadinessPack), 'coherenceVerificationReportId?: string')
  expectIncludes('MRP readiness criterion uses Coherence Verification primary evidence label', read(files.pipelineMergeReadinessPack), 'coherenceVerification:${coherencePassed ?')
  expectIncludes('synthesis PR draft uses Coherence Verification primary status field', read(files.pipelineSynthesisPrDraft), 'coherenceVerificationPassed?: boolean')
  expectIncludes('synthesis PR draft keeps gate1Passed compatibility input', read(files.pipelineSynthesisPrDraft), 'gate1Passed?: boolean')
  expectIncludes('synthesis PR draft body names Coherence Verification', read(files.pipelineSynthesisPrDraft), 'Coherence Verification: \\`')
  expectIncludes('runtime verification exposes Coherence Verification verdict as primary', read(files.pipelineRuntimeVerification), 'coherenceVerificationVerdict: CoherenceVerificationVerdict')
  expectIncludes('runtime verification keeps gate1Verdict compatibility field', read(files.pipelineRuntimeVerification), 'gate1Verdict: Gate1Verdict')
  expectIncludes('coordinator state exposes Coherence Verification pass flag', read(files.pipelineCoordinatorState), 'coherenceVerificationPassed: boolean')
  expectIncludes('coordinator state exposes Coherence Verification report field', read(files.pipelineCoordinatorState), 'coherenceVerificationReport: unknown | null')
  expectIncludes('coordinator graph records Coherence Verification evidence first', read(files.pipelineCoordinatorGraph), 'const coherenceVerificationReport =')
  expectIncludes('coordinator graph uses Coherence Verification node primary', read(files.pipelineCoordinatorGraph), "export const COHERENCE_VERIFICATION_NODE = 'coherence-verification'")
  expectIncludes('coordinator graph keeps legacy gate-1 node marker', read(files.pipelineCoordinatorGraph), "export const LEGACY_GATE1_NODE = 'gate-1'")
  expectIncludes('coordinator role history keeps legacyRole compatibility marker', read(files.pipelineCoordinatorState), 'legacyRole?: string')
  expectIncludes('feedback signals use Coherence Verification failure subtype primary', read(files.pipelineGenerateFeedback), 'synthesis:coherence-verification-failed')
  expectIncludes('feedback signals keep legacy gate-1 failed status input', read(files.pipelineGenerateFeedback), "const LEGACY_COHERENCE_VERIFICATION_FAILED_STATUS = 'gate-1-failed'")
  expectIncludes('feedback signals preserve legacy gate1 failed subtype metadata', read(files.pipelineGenerateFeedback), "const LEGACY_GATE1_FAILED_SUBTYPE = 'synthesis:gate1-failed'")
  expectIncludes('ff-pipeline defines Persistence Verification evaluator as primary', read(files.pipelinePersistenceVerification), 'export function evaluatePersistenceVerificationRegistration')
  expectIncludes('ff-pipeline keeps legacy Gate 3 assurance evaluator alias', read(files.pipelinePersistenceVerification), 'export const evaluateGate3AssuranceRegistration = evaluatePersistenceVerificationRegistration')
  expectIncludes('ff-pipeline defines Persistence Verification registration input as primary', read(files.pipelinePersistenceVerification), 'export interface PersistenceVerificationRegistrationInput')
  expectIncludes('ff-pipeline keeps legacy Gate 3 assurance input alias', read(files.pipelinePersistenceVerification), 'export type Gate3AssuranceRegistrationInput = PersistenceVerificationRegistrationInput')
  expectIncludes('ff-pipeline exposes Fidelity Verification diagnostic route', read(files.pipelineIndex), '/debug/fidelity-verification')
  expectIncludes('ff-pipeline exposes Persistence Verification diagnostic route', read(files.pipelineIndex), '/debug/persistence-verification')
  expectIncludes('ff-pipeline lifecycle defines Verification requirements primary', read(files.pipelineLifecycle), 'export const VERIFICATION_REQUIREMENTS')
  expectIncludes('ff-pipeline lifecycle keeps legacy gate requirements map', read(files.pipelineLifecycle), 'export const GATE_REQUIREMENTS')
  expectIncludes('ff-pipeline lifecycle accepts verificationReport primary evidence', read(files.pipelineLifecycle), 'verificationReport?: string')
  expectIncludes('ff-pipeline lifecycle returns verificationRequired primary guard', read(files.pipelineLifecycle), 'verificationRequired: requirement.verification')
  expectIncludes('ff-pipeline workflow calls Coherence Verification service method', read(files.pipelineWorkflow), 'evaluateCoherenceVerification')
  expectIncludes('ff-pipeline workflow uses Coherence Verification step name', read(files.pipelineWorkflow), "'coherence-verification'")
  expectIncludes('ff-pipeline workflow emits Coherence Verification failure status primary', read(files.pipelineWorkflow), "const COHERENCE_VERIFICATION_FAILED_STATUS = 'coherence-verification-failed'")
  expectIncludes('ff-pipeline workflow keeps legacy gate-1 failed status alias', read(files.pipelineWorkflow), "const LEGACY_GATE1_FAILED_STATUS = 'gate-1-failed'")
  expectIncludes('ff-gates exposes Coherence Verification service method', read(files.gatesWorker), 'evaluateCoherenceVerification')
  expectIncludes('ff-gates defines canonical Coherence Verification report interface first', read(files.gatesWorker), 'export interface CoherenceVerificationReport')
  expectIncludes('ff-gates keeps Gate1Report as alias', read(files.gatesWorker), 'export type Gate1Report = CoherenceVerificationReport')
  expectIncludes('ff-gateway exposes Coherence Verification route', read(files.gatewayWorker), '/coherence-verification')
  expectIncludes('ff-gateway defines canonical Coherence Verification report interface first', read(files.gatewayTypes), 'export interface CoherenceVerificationReport')
  expectIncludes('ff-gateway keeps Gate1Report as alias', read(files.gatewayTypes), 'export type Gate1Report = CoherenceVerificationReport')
  expectIncludes('ff-gateway service binding supports Coherence Verification method', read(files.gatewayEnv), 'evaluateCoherenceVerification')
  expectIncludes('ff-gates package description uses Coherence Verification', read(files.ffGatesPackageJson), 'Coherence Verification')
  expectIncludes('ontology loader defines Verification class as primary', read(files.ontologyClasses), "_key: 'Verification'")
  expectIncludes('ontology loader marks Gate class legacy', read(files.ontologyClasses), 'Legacy compatibility class for numbered gate terminology')
  expectIncludes('ontology loader defines Coherence Verification instance', read(files.ontologyInstances), "_key: 'CoherenceVerification'")
  expectIncludes('ontology loader defines Fidelity Verification instance', read(files.ontologyInstances), "_key: 'FidelityVerification'")
  expectIncludes('ontology loader defines Persistence Verification instance', read(files.ontologyInstances), "_key: 'PersistenceVerification'")
  expectIncludes('ontology loader keeps Gate1 as Coherence Verification alias', read(files.ontologyInstances), "legacyAliasOf: 'CoherenceVerification'")
  expectIncludes('ontology loader keeps Gate2 as Fidelity Verification alias', read(files.ontologyInstances), "legacyAliasOf: 'FidelityVerification'")
  expectIncludes('ontology loader keeps Gate3 as Persistence Verification alias', read(files.ontologyInstances), "legacyAliasOf: 'PersistenceVerification'")
  expectIncludes('ontology loader constraints require Fidelity Verification', read(files.ontologyConstraints), "requires: 'FidelityVerification'")
  expectIncludes('ontology loader constraints require Persistence Verification', read(files.ontologyConstraints), "requires: 'PersistenceVerification'")
  expectIncludes('ontology loader properties use Coherence Verification language', read(files.ontologyProperties), 'Coherence Verification rejects')
}

function checkDomainAdapterSchemas() {
  const domainAdapter = read(files.domainAdapterSchema)
  const domainAdapterTest = read(files.domainAdapterSchemaTest)
  const schemaIndex = read(files.schemaIndex)
  const schemaPackage = read(files.schemaPackageJson)
  const schemasReadme = read('packages/schemas/README.md')

  const requiredSchemaTerms = [
    'export const DomainAdapterId',
    'export const KernelConcept',
    'export const DomainAdapterTermMapping',
    'export const DomainExecutionMode',
    'export const DomainAdapterContract',
    'export const DomainExecutionRequest',
    'export const DomainExecutionEvidence',
    'executableSpecificationId',
    'intentSpecificationId',
  ]

  for (const term of requiredSchemaTerms) {
    expectIncludes(`domain adapter schema includes ${term}`, domainAdapter, term)
  }

  const requiredKernelConcepts = [
    'domain_substrate',
    'execution_workspace',
    'handoff_artifact',
    'effector_realization_artifact',
    'verification_evidence_source',
    'human_governance_input',
    'lifecycle_transition_substrate',
    'agent_call_role',
  ]

  for (const term of requiredKernelConcepts) {
    expectIncludes(`domain adapter schema maps ${term}`, domainAdapter, term)
  }

  expectIncludes('domain adapter tests keep pull request as adapter term', domainAdapterTest, 'adapterTerm: "pull request"')
  expectIncludes('domain adapter tests keep CI check as evidence source mapping', domainAdapterTest, 'adapterTerm: "CI check"')
  expectIncludes('domain adapter tests reject workGraphId in parsed request', domainAdapterTest, 'expect("workGraphId" in parsed).toBe(false)')
  expectIncludes('schema index exports domain adapter module', schemaIndex, 'export * from "./domain-adapter.js"')
  expectIncludes('schema package exports domain adapter subpath', schemaPackage, '"./domain-adapter": "./src/domain-adapter.ts"')
  expectIncludes('schemas README documents domain-adapter module', schemasReadme, 'domain-adapter')
  expectIncludes('schemas README keeps coding terms inside adapter mappings', schemasReadme, 'coding-adapter mappings')
}

function checkCodingDomainAdapterContract() {
  const codingAdapter = read(files.codingDomainAdapter)
  const codingAdapterTest = read(files.codingDomainAdapterTest)
  const schemaIndex = read(files.schemaIndex)
  const schemaPackage = read(files.schemaPackageJson)
  const schemasReadme = read('packages/schemas/README.md')

  expectIncludes('coding adapter exports parsed contract', codingAdapter, 'export const CodingDomainAdapterContract = DomainAdapterContract.parse')
  expectIncludes('coding adapter uses canonical adapter id', codingAdapter, 'adapterId: "adapter.coding"')
  expectIncludes('coding adapter names git/github/ci substrate', codingAdapter, 'substrate: "git-github-ci"')

  const requiredMappings = [
    ['repository', 'domain_substrate'],
    ['branch', 'execution_workspace'],
    ['pull request', 'handoff_artifact'],
    ['diff', 'effector_realization_artifact'],
    ['CI check', 'verification_evidence_source'],
    ['code review', 'human_governance_input'],
    ['deployment', 'lifecycle_transition_substrate'],
    ['Coder', 'agent_call_role'],
    ['Tester', 'agent_call_role'],
  ]

  for (const [adapterTerm, kernelConcept] of requiredMappings) {
    expectIncludes(`coding adapter maps ${adapterTerm}`, codingAdapter, `adapterTerm: "${adapterTerm}"`)
    expectIncludes(`coding adapter maps ${adapterTerm} to ${kernelConcept}`, codingAdapter, `kernelConcept: "${kernelConcept}"`)
  }

  const evidenceSources = [
    'test-result',
    'typecheck-result',
    'repository-audit',
    'literate-sync',
    'factory-pr-gate',
    'runtime-diagnostic',
  ]

  for (const evidenceSource of evidenceSources) {
    expectIncludes(`coding adapter declares evidence source ${evidenceSource}`, codingAdapter, `"${evidenceSource}"`)
  }

  expectIncludes('coding adapter test asserts adapter identity', codingAdapterTest, 'adapterId).toBe("adapter.coding")')
  expectIncludes('coding adapter test asserts exact substrate mappings', codingAdapterTest, 'toEqual([')
  expectIncludes('schema index exports coding adapter module', schemaIndex, 'export * from "./coding-domain-adapter.js"')
  expectIncludes('schema package exports coding adapter subpath', schemaPackage, '"./coding-domain-adapter": "./src/coding-domain-adapter.ts"')
  expectIncludes('schemas README documents coding-domain-adapter module', schemasReadme, 'coding-domain-adapter')
}

function checkCompilerPathContracts() {
  const compiler = read(files.compiler)
  const coverageEmit = read(files.coverageEmit)

  expectIncludes('compiler retains default coverage report path', compiler, '"coverage-reports"')
  expectIncludes('compiler retains default workgraph path', compiler, '"workgraphs"')
  expectIncludes('compiler docs retain PRD source path contract', compiler, '<repo>/specs/prds/PRD-*.md')
  expectIncludes('coverage gate emitter retains coverage report default path', coverageEmit, 'specs/coverage-reports')
}

function checkLegacyNumberConcordance() {
  const addendumA = read(files.addendumA)
  const addendumB = read(files.addendumB)
  const mapping = read(files.mapping)
  const referenceReadme = read(files.referenceReadme)

  expectIncludes('reference index links Addendum A', referenceReadme, 'FF-ONTOLOGY-ADDENDUM-A.md')
  expectIncludes('reference index links Addendum B', referenceReadme, 'ONTOLOGY-ADDENDUM-B-STAGE-EXTENSIONS.md')
  expectIncludes('reference index documents legacy number policy', referenceReadme, '## Legacy Number Policy')

  const addendumATerms = [
    '## Pipeline Stages',
    'Stage 1 | Signal Artifact',
    'Stage 7 | Persistence Verification',
    'Gate 2a | Fidelity Verification',
    'Gate 2b | Fidelity Verification',
    'Pass 8 | Instruction Tuning',
    'FP- / FN- | Function Proposal',
    'coverage-gate-1/SKILL.md | Coherence verification enforcement',
  ]

  for (const term of addendumATerms) {
    expectIncludes(`Addendum A contains ${term}`, addendumA, term)
  }

  const mappingTerms = [
    '## Legacy Pipeline Stage Concordance',
    '| Stage 1 | Signal Artifact collection |',
    '| Stage 7 | Persistence Verification / continuous assurance |',
    '## Legacy Coverage Gate Concordance',
    '| Gate 2a | Fidelity Verification (learned) |',
    '| Gate 2b | Fidelity Verification (deterministic) |',
    '## Legacy Compiler Pass Concordance',
    '| Current repo Pass 8 | Structural Assembly completion compatibility label |',
    '| Ontology Pass 8 | Instruction Tuning (future) |',
    '## Artifact ID Prefix Concordance',
    '## Skill File Concordance',
    '## Post-v0.2 Stage Extensions',
  ]

  for (const term of mappingTerms) {
    expectIncludes(`current mapping contains ${term}`, mapping, term)
  }

  const addendumBTerms = [
    '# Ontology Addendum B: Repo-Local Stage Extensions',
    '| Stage 8 | Merge Readiness / PR Handoff / Function identity materialization |',
    '| Stage 8.5 | Selection-bias correction overlay |',
    '| Stage 9 | Meta-Governance / policy evolution |',
    '| Stage 10 | Policy Activation / rollback control |',
    'not new ontology categories yet',
  ]

  for (const term of addendumBTerms) {
    expectIncludes(`Addendum B contains ${term}`, addendumB, term)
  }
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
  expectIncludes('reference index links compatibility contract manifest', referenceReadme, 'ONTOLOGY-COMPATIBILITY-CONTRACT.json')
  expectIncludes('reference index links rename blast-radius report', referenceReadme, 'ONTOLOGY-RENAME-BLAST-RADIUS.md')
  expectIncludes('reference index links rename proposal template', referenceReadme, 'ONTOLOGY-RENAME-PROPOSAL-TEMPLATE.md')
  expectIncludes('reference index links refactor readiness checklist', referenceReadme, 'ONTOLOGY-REFACTOR-READINESS-CHECKLIST.md')
  expectIncludes('blast-radius report forbids mass rename of specs/prds', blastRadius, 'No mass rename of `specs/prds`')
  expectIncludes('blast-radius report names compatibility audit script', blastRadius, 'scripts/audit-ontology-compat.mjs')
  expectIncludes('blast-radius report names compatibility audit command', blastRadius, 'pnpm audit:ontology')
  expectIncludes('blast-radius report points future renames to template', blastRadius, 'ONTOLOGY-RENAME-PROPOSAL-TEMPLATE.md')
  expectIncludes('blast-radius report points future renames to readiness checklist', blastRadius, 'ONTOLOGY-REFACTOR-READINESS-CHECKLIST.md')
  expectIncludes('current mapping requires rename proposal template', mapping, 'ONTOLOGY-RENAME-PROPOSAL-TEMPLATE.md')
  expectIncludes('current mapping requires refactor readiness checklist', mapping, 'ONTOLOGY-REFACTOR-READINESS-CHECKLIST.md')
  expectIncludes('current mapping links compatibility contract manifest', mapping, 'ONTOLOGY-COMPATIBILITY-CONTRACT.json')
}

function checkDomainFactoryKernel() {
  const domainKernel = read(files.domainKernel)
  const referenceReadme = read(files.referenceReadme)
  const mapping = read(files.mapping)
  const rootReadme = read(files.rootReadme)
  const architecture = read('ARCHITECTURE.md')
  const agentMap = read(files.agentMap)
  const decisions = read('.agent/memory/semantic/DECISIONS.md')

  const kernelTerms = [
    'domain-neutral compiler',
    'Coding is one adapter domain',
    'Intent Specification',
    'Executable Specification',
    'Verification',
    'Evidence',
    'Lifecycle',
    'Domain Adapter',
    'Hard Cutover Rule',
  ]

  for (const term of kernelTerms) {
    expectIncludes(`domain kernel defines ${term}`, domainKernel, term)
  }

  const adapterTerms = [
    'repository | domain substrate',
    'branch | execution workspace',
    'pull request | handoff artifact',
    'diff | effector realization artifact',
    'CI check | Verification evidence source',
    'code review | human governance input',
    'deployment | lifecycle transition substrate',
  ]

  for (const term of adapterTerms) {
    expectIncludes(`domain kernel maps coding adapter term ${term}`, domainKernel, term)
  }

  expectIncludes('reference index links domain kernel', referenceReadme, 'DOMAIN-FACTORY-KERNEL.md')
  expectIncludes('reference index documents domain adapter rule', referenceReadme, '## Domain Adapter Rule')
  expectIncludes('current mapping cites domain kernel as source', mapping, 'DOMAIN-FACTORY-KERNEL.md')
  expectIncludes('current mapping documents domain kernel policy', mapping, '## Domain Kernel Policy')
  expectIncludes('current mapping documents coding adapter boundary', mapping, '## Coding Adapter Boundary')
  expectIncludes('root README declares domain-neutral Factory', rootReadme, 'A domain-neutral compiler for trustworthy executable Functions.')
  expectIncludes('root README makes coding one Domain Adapter', rootReadme, 'coding is one Domain')
  expectIncludes('architecture declares domain-neutral compiler', architecture, 'domain-neutral closed-loop compiler')
  expectIncludes('architecture makes coding the bootstrap adapter', architecture, 'Coding is the bootstrap Domain Adapter')
  expectIncludes('agent map names implementation agent', agentMap, 'implementation agent working on the **Function Factory**')
  expectIncludes('agent map defines domain adapter boundary', agentMap, 'Domain adapter boundary')
  expectIncludes('decision log records domain kernel decision', decisions, 'Domain Factory kernel is canonical; coding is an adapter')
}

function checkActiveTerminologySurfaces() {
  const rootReadme = read(files.rootReadme)
  const agentMap = read(files.agentMap)
  const skillIndex = read(files.skillIndex)
  const lessons = read(files.semanticLessons)
  const compilerReadme = read(files.compilerReadme)

  expectIncludes('root README leads with Intent-to-Executable compilation', rootReadme, 'Intent → Executable Specification compilation')
  expectIncludes('root README labels Signal Artifacts primary', rootReadme, 'Signal Artifacts (legacy Stage 1')
  expectIncludes('root README labels Persistence Verification primary', rootReadme, 'Persistence Verification, trust')
  expectIncludes('agent map uses Coherence Verification primary', agentMap, 'fails Coherence')
  expectIncludes('agent map uses Fidelity Verification primary', agentMap, 'without Fidelity')
  expectIncludes('agent map uses Persistence Verification primary', agentMap, 'active Persistence')
  expectIncludes('skill index uses Compilation harness primary', skillIndex, 'Compilation harness')
  expectIncludes('skill index uses Coherence Verification charter primary', skillIndex, 'Coherence Verification charter')
  expectIncludes('skill index uses Fidelity Verification charter primary', skillIndex, 'Fidelity Verification charter')
  expectIncludes('skill index uses Persistence Verification charter primary', skillIndex, 'Persistence Verification charter')
  expectIncludes('lessons use compiler transformation discipline', lessons, 'compiler transformation discipline')
  expectIncludes('lessons map future Instruction Tuning', lessons, 'future Instruction Tuning')
  expectIncludes('compiler README marks historical pass numbers compatibility', compilerReadme, 'pass numbers remain compatibility labels')
  expectIncludes('compiler README documents Executable Specification Assembly', compilerReadme, 'Executable Specification Assembly')
  expectIncludes('compiler README documents ontology Pass 8 as future', compilerReadme, 'Ontology Pass 8: Instruction Tuning -- future')
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
  expectIncludes('compiler README documents Coherence Verification pass', read(files.compilerReadme), 'runCoherenceVerificationPass')
  expectIncludes('compiler README marks pass numbers legacy', read(files.compilerReadme), 'pass numbers remain compatibility labels')
  expectIncludes('compiler README documents Executable Specification Assembly alias', read(files.compilerReadme), 'assembleExecutableSpecification')
  expectIncludes('function synthesis README retains WorkGraph compatibility term', read(files.functionSynthesisReadme), 'WorkGraph')
  expectIncludes('function synthesis README documents FidelityVerificationInput', read(files.functionSynthesisReadme), 'FidelityVerificationInput')
  expectIncludes('function synthesis README marks numbered gate terms legacy', read(files.functionSynthesisReadme), 'legacy compatibility shims')
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
  expectIncludes('ff-pipeline README marks numbered gate terms legacy', read(files.ffPipelineReadme), 'legacy compatibility shims')
  expectIncludes('ff-pipeline README requires rename proposal template', read(files.ffPipelineReadme), 'ONTOLOGY-RENAME-PROPOSAL-TEMPLATE.md')
  expectIncludes('ff-gates README retains Gate1Report compatibility term', read(files.ffGatesReadme), 'Gate1Report')
  expectIncludes('ff-gates README marks numbered gate terms legacy', read(files.ffGatesReadme), 'legacy compatibility shims')
  expectIncludes('ff-gates README documents Coherence Verification service method', read(files.ffGatesReadme), 'evaluateCoherenceVerification')
  expectIncludes('ff-gateway README documents Coherence Verification route', read(files.ffGatewayReadme), '/coherence-verification')
  expectIncludes('ff-gateway README marks numbered gate terms legacy', read(files.ffGatewayReadme), 'legacy compatibility shims')
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

function checkRefactorReadinessChecklist() {
  const checklist = read(files.refactorReadiness)

  const requiredSections = [
    '# Ontology Refactor Readiness Checklist',
    '## Current Decision',
    '## Required Before Any Rename',
    '## Required Green Checks',
    '## Blocked Without Explicit Approval',
    '## Audit-Enforced Non-Starters',
    '## Ready-To-Propose Bar',
  ]

  for (const section of requiredSections) {
    expectIncludes(`refactor readiness checklist includes ${section}`, checklist, section)
  }

  const requiredTerms = [
    'stable compatibility contracts',
    'ONTOLOGY-COMPATIBILITY-CONTRACT.json',
    'ONTOLOGY-RENAME-PROPOSAL-TEMPLATE.md',
    'aliases alone are insufficient',
    'dual-read compatibility',
    'live worker, MRP, lifecycle, and Verification evidence',
    'pnpm audit:docs',
    'pnpm audit:ontology',
    'Repository Audit',
    'Factory PR Gate',
    '.agent/AGENTS.md',
    '.agent/skills/*',
    'packages/schemas/src/core.ts',
    'specs/intent-specifications',
    'specs_intent_specifications',
    'specs/prds',
    'packages/compiler',
    'workers/ff-pipeline',
    'infra/arangodb',
  ]

  for (const term of requiredTerms) {
    expectIncludes(`refactor readiness checklist requires ${term}`, checklist, term)
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

function expectAbsent(label, file) {
  checks.push(label)
  if (existsSync(resolve(file))) {
    failures.push(`unexpected-file ${label}: ${file}`)
  }
}

function expectIncludes(label, content, expected) {
  checks.push(label)
  if (!content.includes(expected)) {
    failures.push(`missing-content ${label}: ${expected}`)
  }
}

function expectExcludes(label, content, forbidden) {
  checks.push(label)
  if (content.includes(forbidden)) {
    failures.push(`forbidden-content ${label}: ${forbidden}`)
  }
}

function expectArrayIncludes(label, values, expected) {
  checks.push(label)
  if (!Array.isArray(values) || !values.includes(expected)) {
    failures.push(`missing-array-value ${label}: ${expected}`)
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
