/**
 * SHACL constraints extracted from factory-shapes.ttl
 *
 * All 16 constraints (C1-C16) as queryable TypeScript objects.
 * Each constraint maps to a sh:NodeShape in the SHACL shapes file.
 */

import type { OntologyConstraint } from './index.js'

export const ONTOLOGY_CONSTRAINTS: OntologyConstraint[] = [

  // ─── C1: Lineage Completeness ──────────────────────────────────
  {
    _key: 'C1-lineage',
    constraintId: 'C1',
    name: 'Lineage Completeness',
    shapeName: 'NonSignalLineageShape',
    targetClasses: ['Pressure', 'BusinessCapability', 'FunctionProposal', 'PRDDraft', 'WorkGraph', 'CoverageReport'],
    severity: 'violation',
    message: 'LINEAGE BREAK: Every non-Signal artifact MUST derive from at least one upstream artifact.',
    requiredProperties: ['derivesFrom', 'sourceRefs'],
    minCount: 1,
  },

  // ─── C2: specContent Propagation ───────────────────────────────
  {
    _key: 'C2-specContent',
    constraintId: 'C2',
    name: 'specContent Propagation',
    shapeName: 'SpecContentPropagationShape',
    targetClasses: ['Pressure', 'BusinessCapability', 'FunctionProposal'],
    severity: 'violation',
    message: 'SPEC LOSS: When the originating Signal has specContent, every derivation artifact MUST carry it.',
    requiredProperties: ['specContent'],
    sparqlCheck: true,
  },

  // ─── C3: BriefingScript Completeness ───────────────────────────
  {
    _key: 'C3-briefing',
    constraintId: 'C3',
    name: 'BriefingScript Completeness',
    shapeName: 'BriefingScriptShape',
    targetClasses: ['BriefingScript'],
    severity: 'violation',
    message: 'BriefingScript MUST have all 6 required fields: goal, successCriteria, architecturalContext, strategicAdvice, knownGotchas, validationLoop.',
    requiredProperties: ['goal', 'successCriteria', 'architecturalContext', 'strategicAdvice', 'validationLoop'],
    optionalProperties: ['knownGotchas'],
    additionalChecks: [
      { property: 'goal', minLength: 10 },
      { property: 'architecturalContext', minLength: 20 },
      { property: 'producedBy', hasValue: 'ArchitectRole' },
    ],
  },

  // ─── C4: Agent Is Real Agent ───────────────────────────────────
  {
    _key: 'C4-realAgent',
    constraintId: 'C4',
    name: 'Agent Is Real Agent',
    shapeName: 'AgentRoleShape',
    targetClasses: ['AgentRole'],
    severity: 'violation',
    message: 'FAKE AGENT: An agent without tools is not an agent. It is a prompt wrapper.',
    requiredProperties: ['hasTools', 'hasMemoryAccess', 'runsIn'],
    minCount: 1,
  },

  // ─── C5: Invariant Has Detector ────────────────────────────────
  {
    _key: 'C5-detector',
    constraintId: 'C5',
    name: 'Invariant Has Detector',
    shapeName: 'InvariantDetectorShape',
    targetClasses: ['Invariant'],
    severity: 'violation',
    message: 'WISH NOT INVARIANT: An Invariant without a DetectorSpec is a wish. Gate 1 MUST reject.',
    requiredProperties: ['detectedBy'],
    minCount: 1,
  },

  // ─── C6: Every Artifact Reviewed ───────────────────────────────
  {
    _key: 'C6-reviewed',
    constraintId: 'C6',
    name: 'Every Artifact Reviewed',
    shapeName: 'WorkGraphReviewShape',
    targetClasses: ['WorkGraph', 'CodeArtifact', 'PRDDraft'],
    severity: 'violation',
    message: 'UNREVIEWED: Every WorkGraph, CodeArtifact, and PRDDraft MUST be reviewed by an Agent before synthesis.',
    requiredProperties: ['reviewedBy'],
    minCount: 1,
  },

  // ─── C7: CRP Escalation on Low Confidence ─────────────────────
  {
    _key: 'C7-confidence',
    constraintId: 'C7',
    name: 'CRP Escalation on Low Confidence',
    shapeName: 'ConfidenceEscalationShape',
    targetClasses: ['ExecutionArtifact'],
    severity: 'violation',
    message: 'SILENT UNCERTAINTY: Artifact with confidence < 0.7 MUST have an associated CRP.',
    sparqlCheck: true,
    confidenceThreshold: 0.7,
  },

  // ─── C8: MentorScript Enforcement ──────────────────────────────
  {
    _key: 'C8-mentorRules',
    constraintId: 'C8',
    name: 'MentorScript Enforcement',
    shapeName: 'CritiqueRuleComplianceShape',
    targetClasses: ['CritiqueReport'],
    severity: 'violation',
    message: 'RULES IGNORED: CritiqueReport MUST document which MentorScript rules were checked.',
    requiredProperties: ['mentorRulesChecked'],
    minCount: 1,
  },

  // ─── C9: Gate Fail-Closed ──────────────────────────────────────
  {
    _key: 'C9-failClosed',
    constraintId: 'C9',
    name: 'Gate Fail-Closed',
    shapeName: 'GateFailClosedShape',
    targetClasses: ['CoverageReport'],
    severity: 'violation',
    message: 'Gate result MUST be explicitly pass or fail. No ambiguity.',
    requiredProperties: ['passed', 'gateResult'],
    additionalChecks: [
      { property: 'passed', datatype: 'boolean', minCount: 1, maxCount: 1 },
    ],
  },

  // ─── C10: Semantic Review Grounded ─────────────────────────────
  {
    _key: 'C10-grounded',
    constraintId: 'C10',
    name: 'Semantic Review Grounded',
    shapeName: 'SemanticReviewGroundedShape',
    targetClasses: ['CritiqueReport'],
    severity: 'warning',
    message: 'UNGROUNDED REVIEW: Semantic review MUST compare against original specContent, not pipeline intermediates.',
    sparqlCheck: true,
  },

  // ─── C11: Coder Has Filesystem ─────────────────────────────────
  {
    _key: 'C11-coderEnv',
    constraintId: 'C11',
    name: 'Coder Has Filesystem',
    shapeName: 'CoderEnvironmentShape',
    targetClasses: ['CoderRole'],
    severity: 'warning',
    message: 'FAKE CODE: Coder MUST run in a Sandbox Container with real filesystem, not a V8 isolate producing JSON.',
    requiredProperties: ['runsIn', 'hasTools'],
    additionalChecks: [
      { property: 'runsIn', hasValue: 'SandboxContainer' },
      { property: 'hasTools', requiredValues: ['FileWriteTool', 'BashExecuteTool', 'GitTool'] },
    ],
  },

  // ─── C12: Tester Runs Real Tests ───────────────────────────────
  {
    _key: 'C12-testerEnv',
    constraintId: 'C12',
    name: 'Tester Runs Real Tests',
    shapeName: 'TesterEnvironmentShape',
    targetClasses: ['TesterRole'],
    severity: 'warning',
    message: 'SIMULATED TESTS: Tester MUST run in a Sandbox Container with real test execution.',
    requiredProperties: ['runsIn', 'hasTools'],
    additionalChecks: [
      { property: 'runsIn', hasValue: 'SandboxContainer' },
      { property: 'hasTools', requiredValues: ['BashExecuteTool'] },
    ],
  },

  // ─── C13: WorkGraph Has Atoms ──────────────────────────────────
  {
    _key: 'C13-atoms',
    constraintId: 'C13',
    name: 'WorkGraph Has Atoms',
    shapeName: 'WorkGraphCompletenessShape',
    targetClasses: ['WorkGraph'],
    severity: 'violation',
    message: 'EMPTY WORKGRAPH: WorkGraph must have at least one node.',
    requiredProperties: ['hasNode'],
    minCount: 1,
  },

  // ─── C14: Function Lifecycle Transitions ───────────────────────
  {
    _key: 'C14-lifecycle',
    constraintId: 'C14',
    name: 'Function Lifecycle Transitions',
    shapeName: 'LifecycleTransitionShape',
    targetClasses: ['FunctionProposal'],
    severity: 'violation',
    message: 'UNGATED PROMOTION: Function cannot transition to verified without Gate 2 pass, or to monitored without active Gate 3.',
    sparqlCheck: true,
    lifecycleRules: [
      { from: 'Proposed', to: 'Designed' },
      { from: 'Designed', to: 'InProgress' },
      { from: 'InProgress', to: 'Implemented' },
      { from: 'Implemented', to: 'Verified', requires: 'Gate2' },
      { from: 'Verified', to: 'Monitored', requires: 'Gate3' },
      { from: 'Monitored', to: 'Retired' },
    ],
  },

  // ─── C15: No Secrets in Artifacts ──────────────────────────────
  {
    _key: 'C15-secrets',
    constraintId: 'C15',
    name: 'No Secrets in Artifacts',
    shapeName: 'NoSecretsShape',
    targetClasses: ['CodeArtifact'],
    severity: 'violation',
    message: 'SECRET LEAK: CodeArtifact must not contain API keys, passwords, or tokens.',
    sparqlCheck: true,
    secretPatterns: [
      'sk-ant-', 'sk-proj-', 'GOCSPX-', 'Bearer ey', 'AKIA',
      '-----BEGIN RSA PRIVATE KEY', '-----BEGIN OPENSSH PRIVATE KEY',
      'ghp_', 'glpat-', 'xoxb-', 'ya29.',
    ],
  },

  // ─── C16: Event-Driven Communication ───────────────────────────
  {
    _key: 'C16-eventDriven',
    constraintId: 'C16',
    name: 'Event-Driven Communication',
    shapeName: 'EventDrivenShape',
    targetClasses: ['Workflow'],
    severity: 'violation',
    message: 'DEADLOCK RISK: Workflows MUST communicate with DOs via Queue, not direct RPC.',
    requiredProperties: ['communicatesVia'],
    additionalChecks: [
      { property: 'communicatesVia', hasValue: 'synthesisQueue' },
    ],
  },
]
