/**
 * Named instances extracted from factory-ontology.ttl
 *
 * Agent roles, tools, infrastructure components, collections, graphs.
 */

import type { OntologyInstance } from './index.js'

export const ONTOLOGY_INSTANCES: OntologyInstance[] = [

  // ═══════════════════════════════════════════════════════════════
  // AGENT ROLES — from ff:AgentRole instances + role constraints
  // ═══════════════════════════════════════════════════════════════

  {
    _key: 'ArchitectRole',
    uri: 'ff:ArchitectRole',
    type: 'AgentRole',
    label: 'Architect Agent',
    comment: 'Produces BriefingScripts with full codebase context. Replaces Stages 2-4.',
    tools: ['FileReadTool', 'GrepSearchTool', 'ArangoQueryTool'],
    permissions: ['ReadOnly'],
    memoryAccess: ['DecisionsMemory', 'LessonsMemory', 'MentorRulesMemory', 'CodebaseAccess'],
    runsIn: 'V8Isolate',
  },
  {
    _key: 'PlannerRole',
    uri: 'ff:PlannerRole',
    type: 'AgentRole',
    label: 'Planner Agent',
    comment: 'Decomposes WorkGraph into implementation plan.',
    tools: ['FileReadTool', 'GrepSearchTool'],
    permissions: ['ReadOnly'],
    memoryAccess: ['DecisionsMemory', 'LessonsMemory'],
    runsIn: 'V8Isolate',
  },
  {
    _key: 'CoderRole',
    uri: 'ff:CoderRole',
    type: 'AgentRole',
    label: 'Coder Agent',
    comment: 'Implements code against a plan. Requires filesystem, git, test runner.',
    tools: ['FileReadTool', 'FileWriteTool', 'BashExecuteTool', 'GrepSearchTool', 'GitTool'],
    permissions: ['CanRead', 'CanWrite', 'CanExecute'],
    memoryAccess: ['DecisionsMemory', 'LessonsMemory', 'MentorRulesMemory', 'CodebaseAccess'],
    runsIn: 'SandboxContainer',
  },
  {
    _key: 'CriticRole',
    uri: 'ff:CriticRole',
    type: 'AgentRole',
    label: 'Critic Agent',
    comment: 'Reviews PRDs for semantic alignment and code for quality.',
    tools: ['FileReadTool', 'GrepSearchTool', 'ArangoQueryTool'],
    permissions: ['ReadOnly'],
    memoryAccess: ['DecisionsMemory', 'LessonsMemory', 'MentorRulesMemory', 'CodebaseAccess'],
    runsIn: 'V8Isolate',
  },
  {
    _key: 'TesterRole',
    uri: 'ff:TesterRole',
    type: 'AgentRole',
    label: 'Tester Agent',
    comment: 'Executes real tests. Requires filesystem and test runner.',
    tools: ['FileReadTool', 'BashExecuteTool', 'GrepSearchTool'],
    permissions: ['CanRead', 'CanExecute'],
    memoryAccess: ['LessonsMemory', 'MentorRulesMemory'],
    runsIn: 'SandboxContainer',
  },
  {
    _key: 'VerifierRole',
    uri: 'ff:VerifierRole',
    type: 'AgentRole',
    label: 'Verifier Agent',
    comment: 'Makes final pass/patch/resample/interrupt/fail decision.',
    tools: ['FileReadTool', 'GrepSearchTool', 'ArangoQueryTool'],
    permissions: ['ReadOnly'],
    memoryAccess: ['DecisionsMemory', 'LessonsMemory'],
    runsIn: 'V8Isolate',
  },

  // ═══════════════════════════════════════════════════════════════
  // TOOLS — from ff:Tool instances
  // ═══════════════════════════════════════════════════════════════

  {
    _key: 'FileReadTool',
    uri: 'ff:FileReadTool',
    type: 'Tool',
    label: 'File Read Tool',
    comment: 'Read files from filesystem or codebase.',
  },
  {
    _key: 'FileWriteTool',
    uri: 'ff:FileWriteTool',
    type: 'Tool',
    label: 'File Write Tool',
    comment: 'Write/create files on filesystem.',
  },
  {
    _key: 'BashExecuteTool',
    uri: 'ff:BashExecuteTool',
    type: 'Tool',
    label: 'Bash Execute Tool',
    comment: 'Execute shell commands.',
  },
  {
    _key: 'GrepSearchTool',
    uri: 'ff:GrepSearchTool',
    type: 'Tool',
    label: 'Grep Search Tool',
    comment: 'Search across files using patterns.',
  },
  {
    _key: 'ArangoQueryTool',
    uri: 'ff:ArangoQueryTool',
    type: 'Tool',
    label: 'Arango Query Tool',
    comment: 'Query ArangoDB knowledge graph via AQL.',
  },
  {
    _key: 'GitTool',
    uri: 'ff:GitTool',
    type: 'Tool',
    label: 'Git Tool',
    comment: 'Git operations (clone, commit, push, diff).',
  },

  // ═══════════════════════════════════════════════════════════════
  // EXECUTION ENVIRONMENTS
  // ═══════════════════════════════════════════════════════════════

  {
    _key: 'V8Isolate',
    uri: 'ff:V8Isolate',
    type: 'ExecutionEnvironment',
    label: 'V8 Isolate',
    comment: 'Cloudflare Worker/Agent — no filesystem, no shell.',
  },
  {
    _key: 'SandboxContainer',
    uri: 'ff:SandboxContainer',
    type: 'ExecutionEnvironment',
    label: 'Sandbox Container',
    comment: 'CF Sandbox — real filesystem, git, pnpm, shell.',
  },

  // ═══════════════════════════════════════════════════════════════
  // MEMORY ACCESS TYPES
  // ═══════════════════════════════════════════════════════════════

  {
    _key: 'DecisionsMemory',
    uri: 'ff:DecisionsMemory',
    type: 'MemoryAccess',
    label: 'Decisions Memory',
    comment: 'Architectural decisions stored in memory_semantic.',
  },
  {
    _key: 'LessonsMemory',
    uri: 'ff:LessonsMemory',
    type: 'MemoryAccess',
    label: 'Lessons Memory',
    comment: 'Lessons learned stored in memory_semantic.',
  },
  {
    _key: 'MentorRulesMemory',
    uri: 'ff:MentorRulesMemory',
    type: 'MemoryAccess',
    label: 'Mentor Rules Memory',
    comment: 'MentorScript rules stored in mentorscript_rules.',
  },
  {
    _key: 'EpisodicMemory',
    uri: 'ff:EpisodicMemory',
    type: 'MemoryAccess',
    label: 'Episodic Memory',
    comment: 'Event-level memory stored in memory_episodic.',
  },
  {
    _key: 'CodebaseAccess',
    uri: 'ff:CodebaseAccess',
    type: 'MemoryAccess',
    label: 'Codebase Access',
    comment: 'Access to the Factory codebase (via file_read, grep_search).',
  },

  // ═══════════════════════════════════════════════════════════════
  // GATE INSTANCES
  // ═══════════════════════════════════════════════════════════════

  {
    _key: 'Gate1',
    uri: 'ff:Gate1',
    type: 'Gate',
    label: 'Gate 1 — Compile Coverage',
    comment: 'Structural validation: atom coverage, invariant coverage, validation coverage, dependency closure.',
  },
  {
    _key: 'Gate2',
    uri: 'ff:Gate2',
    type: 'Gate',
    label: 'Gate 2 — Simulation Coverage',
    comment: 'Behavioral validation: scenario coverage, invariant exercise, validation pass rate.',
  },
  {
    _key: 'Gate3',
    uri: 'ff:Gate3',
    type: 'Gate',
    label: 'Gate 3 — Assurance',
    comment: 'Continuous validation: detector freshness, evidence source liveness, audit pipeline integrity.',
  },

  // ═══════════════════════════════════════════════════════════════
  // INFRASTRUCTURE INSTANCES — Workers, DOs, Queues, etc.
  // ═══════════════════════════════════════════════════════════════

  {
    _key: 'ffGateway',
    uri: 'ff:ffGateway',
    type: 'Worker',
    label: 'ff-gateway',
    comment: 'Gateway worker for the Factory.',
  },
  {
    _key: 'ffPipeline',
    uri: 'ff:ffPipeline',
    type: 'Worker',
    label: 'ff-pipeline',
    comment: 'Pipeline worker implementing Stages 1-5 + gates.',
  },
  {
    _key: 'ffGates',
    uri: 'ff:ffGates',
    type: 'Worker',
    label: 'ff-gates',
    comment: 'Gates worker for coverage validation.',
  },
  {
    _key: 'factoryPipeline',
    uri: 'ff:factoryPipeline',
    type: 'Workflow',
    label: 'factory-pipeline',
    comment: 'CF Workflow implementing the Factory pipeline.',
  },
  {
    _key: 'synthesisCoordinator',
    uri: 'ff:synthesisCoordinator',
    type: 'DurableObject',
    label: 'SynthesisCoordinator',
    comment: 'Durable Object coordinating Stage 6 synthesis.',
  },
  {
    _key: 'sandbox',
    uri: 'ff:sandbox',
    type: 'Container',
    label: 'Sandbox',
    comment: 'CF Container for real code execution.',
  },
  {
    _key: 'synthesisQueue',
    uri: 'ff:synthesisQueue',
    type: 'Queue',
    label: 'synthesis-queue',
    comment: 'Queue for Workflow-to-DO communication (C16 event-driven).',
  },
  {
    _key: 'ffWorkspaces',
    uri: 'ff:ffWorkspaces',
    type: 'R2Bucket',
    label: 'ff-workspaces',
    comment: 'R2 bucket for synthesis workspaces.',
  },

  // ═══════════════════════════════════════════════════════════════
  // ARANGO COLLECTION INSTANCES
  // ═══════════════════════════════════════════════════════════════

  {
    _key: 'col_signals',
    uri: 'ff:col_signals',
    type: 'ArangoCollection',
    label: 'specs_signals',
    comment: 'Signal documents.',
  },
  {
    _key: 'col_pressures',
    uri: 'ff:col_pressures',
    type: 'ArangoCollection',
    label: 'specs_pressures',
    comment: 'Pressure documents.',
  },
  {
    _key: 'col_capabilities',
    uri: 'ff:col_capabilities',
    type: 'ArangoCollection',
    label: 'specs_capabilities',
    comment: 'Business Capability documents.',
  },
  {
    _key: 'col_functions',
    uri: 'ff:col_functions',
    type: 'ArangoCollection',
    label: 'specs_functions',
    comment: 'Function Proposal documents.',
  },
  {
    _key: 'col_prds',
    uri: 'ff:col_prds',
    type: 'ArangoCollection',
    label: 'specs_prds',
    comment: 'PRD Draft documents.',
  },
  {
    _key: 'col_workgraphs',
    uri: 'ff:col_workgraphs',
    type: 'ArangoCollection',
    label: 'specs_workgraphs',
    comment: 'WorkGraph documents.',
  },
  {
    _key: 'col_invariants',
    uri: 'ff:col_invariants',
    type: 'ArangoCollection',
    label: 'specs_invariants',
    comment: 'Invariant documents.',
  },
  {
    _key: 'col_coverage_reports',
    uri: 'ff:col_coverage_reports',
    type: 'ArangoCollection',
    label: 'specs_coverage_reports',
    comment: 'Coverage Report documents.',
  },
  {
    _key: 'col_execution_artifacts',
    uri: 'ff:col_execution_artifacts',
    type: 'ArangoCollection',
    label: 'execution_artifacts',
    comment: 'Execution artifact documents (BriefingScript, Plan, Code, Critique, Tests, Verdict, Session).',
  },
  {
    _key: 'col_mentorscript_rules',
    uri: 'ff:col_mentorscript_rules',
    type: 'ArangoCollection',
    label: 'mentorscript_rules',
    comment: 'MentorScript rule documents.',
  },
  {
    _key: 'col_consultation_requests',
    uri: 'ff:col_consultation_requests',
    type: 'ArangoCollection',
    label: 'consultation_requests',
    comment: 'Consultation Request Pack documents.',
  },
  {
    _key: 'col_vcrs',
    uri: 'ff:col_vcrs',
    type: 'ArangoCollection',
    label: 'version_controlled_resolutions',
    comment: 'Version Controlled Resolution documents.',
  },
  {
    _key: 'col_mrps',
    uri: 'ff:col_mrps',
    type: 'ArangoCollection',
    label: 'merge_readiness_packs',
    comment: 'Merge Readiness Pack documents.',
  },
  {
    _key: 'col_gate_status',
    uri: 'ff:col_gate_status',
    type: 'ArangoCollection',
    label: 'gate_status',
    comment: 'Gate status documents.',
  },
  {
    _key: 'col_trust_scores',
    uri: 'ff:col_trust_scores',
    type: 'ArangoCollection',
    label: 'trust_scores',
    comment: 'Trust composite score documents.',
  },
  {
    _key: 'col_memory_episodic',
    uri: 'ff:col_memory_episodic',
    type: 'ArangoCollection',
    label: 'memory_episodic',
    comment: 'Episodic memory documents.',
  },
  {
    _key: 'col_memory_semantic',
    uri: 'ff:col_memory_semantic',
    type: 'ArangoCollection',
    label: 'memory_semantic',
    comment: 'Semantic memory documents (decisions, lessons).',
  },
  {
    _key: 'col_memory_working',
    uri: 'ff:col_memory_working',
    type: 'ArangoCollection',
    label: 'memory_working',
    comment: 'Working memory documents.',
  },
  {
    _key: 'col_memory_personal',
    uri: 'ff:col_memory_personal',
    type: 'ArangoCollection',
    label: 'memory_personal',
    comment: 'Personal preference documents.',
  },
  {
    _key: 'col_function_runs',
    uri: 'ff:col_function_runs',
    type: 'ArangoCollection',
    label: 'function_runs',
    comment: 'Function execution run documents.',
  },
  {
    _key: 'col_agent_designs',
    uri: 'ff:col_agent_designs',
    type: 'ArangoCollection',
    label: 'agent_designs',
    comment: 'Agent design documents.',
  },

  // ═══════════════════════════════════════════════════════════════
  // ARANGO GRAPH INSTANCES
  // ═══════════════════════════════════════════════════════════════

  {
    _key: 'lineageGraph',
    uri: 'ff:lineageGraph',
    type: 'ArangoGraph',
    label: 'lineage_graph',
    comment: 'Graph tracing artifact derivation chains.',
  },
  {
    _key: 'assuranceGraph',
    uri: 'ff:assuranceGraph',
    type: 'ArangoGraph',
    label: 'assurance_graph',
    comment: 'Graph connecting invariants, detectors, gates, and coverage reports.',
  },
  {
    _key: 'dependencyGraph',
    uri: 'ff:dependencyGraph',
    type: 'ArangoGraph',
    label: 'dependency_graph',
    comment: 'Graph of specification element dependencies.',
  },

  // ═══════════════════════════════════════════════════════════════
  // PIPELINE STAGE INSTANCES
  // ═══════════════════════════════════════════════════════════════

  {
    _key: 'Stage1_Ingest',
    uri: 'ff:Stage1_Ingest',
    type: 'PipelineStage',
    label: 'Stage 1 — Ingest',
    comment: 'Signal ingestion from environment.',
  },
  {
    _key: 'Stage2_Pressure',
    uri: 'ff:Stage2_Pressure',
    type: 'PipelineStage',
    label: 'Stage 2 — Pressure',
    comment: 'Derive Pressures from Signals.',
  },
  {
    _key: 'Stage3_Capability',
    uri: 'ff:Stage3_Capability',
    type: 'PipelineStage',
    label: 'Stage 3 — Capability',
    comment: 'Identify Business Capabilities from Pressures.',
  },
  {
    _key: 'Stage4_Proposal',
    uri: 'ff:Stage4_Proposal',
    type: 'PipelineStage',
    label: 'Stage 4 — Proposal',
    comment: 'Create Function Proposals from Capabilities.',
  },
  {
    _key: 'Stage5_Compile',
    uri: 'ff:Stage5_Compile',
    type: 'PipelineStage',
    label: 'Stage 5 — Compile',
    comment: 'Compile PRD into WorkGraph.',
  },
  {
    _key: 'Stage6_Synthesis',
    uri: 'ff:Stage6_Synthesis',
    type: 'PipelineStage',
    label: 'Stage 6 — Synthesis',
    comment: 'Multi-agent synthesis: Architect, Planner, Coder, Critic, Tester, Verifier.',
  },
  {
    _key: 'Stage7_Observe',
    uri: 'ff:Stage7_Observe',
    type: 'PipelineStage',
    label: 'Stage 7 — Observe',
    comment: 'Runtime monitoring and Gate 3 checks.',
  },
  {
    _key: 'Stage8_PR',
    uri: 'ff:Stage8_PR',
    type: 'PipelineStage',
    label: 'Stage 8 — PR',
    comment: 'Create PR with MRP evidence bundle.',
  },

  // ═══════════════════════════════════════════════════════════════
  // SIGNAL TYPE INSTANCES
  // ═══════════════════════════════════════════════════════════════

  {
    _key: 'MarketSignal',
    uri: 'ff:MarketSignal',
    type: 'SignalType',
    label: 'Market Signal',
    comment: 'Signal from market environment.',
  },
  {
    _key: 'CustomerSignal',
    uri: 'ff:CustomerSignal',
    type: 'SignalType',
    label: 'Customer Signal',
    comment: 'Signal from customer feedback.',
  },
  {
    _key: 'CompetitorSignal',
    uri: 'ff:CompetitorSignal',
    type: 'SignalType',
    label: 'Competitor Signal',
    comment: 'Signal from competitive landscape.',
  },
  {
    _key: 'RegulatorySignal',
    uri: 'ff:RegulatorySignal',
    type: 'SignalType',
    label: 'Regulatory Signal',
    comment: 'Signal from regulatory requirements.',
  },
  {
    _key: 'InternalSignal',
    uri: 'ff:InternalSignal',
    type: 'SignalType',
    label: 'Internal Signal',
    comment: 'Signal from internal operations.',
  },
  {
    _key: 'MetaSignal',
    uri: 'ff:MetaSignal',
    type: 'SignalType',
    label: 'Meta Signal',
    comment: 'Signal about the Factory itself (self-referential during bootstrap).',
  },
]
