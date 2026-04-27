/**
 * Agent Design Documents — the single source of truth for agent configuration.
 *
 * Each agent loads its design from ArangoDB at session start. The design defines:
 *   context  — tools, memory access, environment, permissions
 *   intent   — JTBD, what it produces, success criteria
 *   engineering — model route, timeout, token budget, I/O shapes, validation
 *   prompts  — system prompt, output format, tool guidance
 *
 * Designs are seeded to the `agent_designs` collection. Agents never hardcode
 * their own system prompts — they query the graph for them.
 */

import type { ArangoClient } from '@factory/arango-client'

// ═══════════════════════════════════════════════════════════════
// SCHEMA
// ═══════════════════════════════════════════════════════════════

export interface AgentDesign {
  _key: string

  context: {
    tools: ToolSpec[]
    memoryAccess: string[]
    environment: 'v8-isolate' | 'sandbox-container'
    permissions: ('read' | 'write' | 'execute')[]
    /** CF platform: how this agent relates to the Cloudflare runtime */
    platform: {
      /** The agent runs inside this CF primitive */
      host: 'coordinator-do' | 'sandbox-container' | 'worker'
      /** CF SDK class the host extends (SynthesisCoordinator extends Agent from 'agents') */
      hostClass: string
      /** Runtime: gdk-agent agentLoop (in-process) or sandbox exec (cross-process) */
      runtime: 'gdk-agent-agentloop' | 'sandbox-exec-rpc'
      /** Per ADR-003: pi SDK is default, container is fallback */
      executorDefault: 'gdk-agent' | 'sandbox' | 'container-openhands'
    }
  }

  intent: {
    jtbd: string
    produces: string
    outputShape: Record<string, string>
    successCriteria: string[]
  }

  engineering: {
    modelRoute: { provider: string; model: string }
    fallbackRoute?: { provider: string; model: string }
    taskKind: string
    timeoutMs: number
    maxTokens: number
    maxTurns: number
    inputFields: Record<string, { type: string; required: boolean; description: string }>
    outputValidation: { required: string[]; types: Record<string, string> }
  }

  prompts: {
    system: string
    outputFormat: string
    toolGuidance: string
    mentorRuleInjection: boolean
  }

  version: string
  updatedAt: string
}

export interface ToolSpec {
  name: string
  description: string
  aqlExamples: string[]
}

// ═══════════════════════════════════════════════════════════════
// DESIGNS
// ═══════════════════════════════════════════════════════════════

const now = () => new Date().toISOString()

export const AGENT_DESIGNS: AgentDesign[] = [

  // ─── ARCHITECT ─────────────────────────────────────────────
  {
    _key: 'architect',
    context: {
      tools: [{
        name: 'arango_query',
        description: 'Query the Factory knowledge graph via AQL',
        aqlExamples: [
          'FOR d IN memory_semantic FILTER d.type == "decision" RETURN { key: d._key, decision: d.decision, rationale: d.rationale }',
          'FOR l IN memory_semantic FILTER l.type == "lesson" RETURN { key: l._key, lesson: l.lesson, pain: l.pain_score }',
          'FOR r IN mentorscript_rules FILTER r.status == "active" RETURN { ruleId: r._key, rule: r.rule }',
          'FOR f IN specs_functions LIMIT 5 RETURN { key: f._key, name: f.name, domain: f.domain }',
        ],
      }],
      memoryAccess: ['memory_semantic', 'memory_episodic', 'mentorscript_rules', 'specs_functions', 'specs_workgraphs'],
      environment: 'v8-isolate',
      permissions: ['read'],
      platform: {
        host: 'coordinator-do',
        hostClass: 'SynthesisCoordinator extends Agent (agents SDK)',
        runtime: 'gdk-agent-agentloop',
        executorDefault: 'gdk-agent',
      },
    },
    intent: {
      jtbd: 'When a WorkGraph specification enters Stage 6, I want to produce a BriefingScript grounded in architectural decisions and lessons learned, so downstream agents have clear, contextual guidance for synthesis.',
      produces: 'BriefingScript',
      outputShape: {
        goal: 'string — the primary objective for this synthesis',
        successCriteria: 'string[] — measurable conditions that define success',
        architecturalContext: 'string — relevant background from decisions and codebase',
        strategicAdvice: 'string — high-level guidance for downstream agents',
        knownGotchas: 'string[] — pitfalls from lessons learned',
        validationLoop: 'string — how to validate the outcome',
      },
      successCriteria: [
        'BriefingScript references at least one real decision or lesson from ArangoDB',
        'All 6 required fields present and non-empty',
        'strategicAdvice addresses the specific domain of the WorkGraph, not generic boilerplate',
        'knownGotchas sourced from actual LESSONS, not hallucinated',
      ],
    },
    engineering: {
      modelRoute: { provider: 'deepseek', model: 'deepseek-v4-pro' },
      fallbackRoute: { provider: 'google', model: 'gemini-3.1-pro-preview' },
      taskKind: 'planning',
      timeoutMs: 120_000,
      maxTokens: 4096,
      maxTurns: 5,
      inputFields: {
        signal: { type: 'Record<string, unknown>', required: true, description: 'WorkGraph specification object' },
        specContent: { type: 'string', required: false, description: 'Original specification text from the Signal' },
      },
      outputValidation: {
        required: ['goal', 'successCriteria', 'architecturalContext', 'strategicAdvice', 'knownGotchas', 'validationLoop'],
        types: { goal: 'string', successCriteria: 'array', architecturalContext: 'string', strategicAdvice: 'string', knownGotchas: 'array', validationLoop: 'string' },
      },
    },
    prompts: {
      system: `You are the Architect agent in the Function Factory synthesis pipeline.

Your job: produce a BriefingScript that guides downstream agents (Planner, Coder, Tester, Verifier) through synthesizing a Function from a WorkGraph specification.

You have the arango_query tool. USE IT to ground your briefing in real Factory context. Make at least one tool call before producing your briefing. Do not hallucinate context.`,
      outputFormat: `Respond with ONLY a JSON object (no markdown fences, no explanation):
{
  "goal": "the primary objective for this synthesis",
  "successCriteria": ["measurable condition 1", "measurable condition 2"],
  "architecturalContext": "relevant background from decisions and codebase",
  "strategicAdvice": "high-level guidance for downstream agents",
  "knownGotchas": ["pitfall from lessons learned"],
  "validationLoop": "how to validate the outcome"
}`,
      toolGuidance: `Query these collections before producing output:
1. memory_semantic (type == 'decision') — architectural decisions
2. memory_semantic (type == 'lesson') — lessons from past failures
3. mentorscript_rules (status == 'active') — coding rules to enforce
4. specs_functions — existing functions for context`,
      mentorRuleInjection: true,
    },
    version: '1.0.0',
    updatedAt: now(),
  },

  // ─── CRITIC (semantic review) ──────────────────────────────
  {
    _key: 'critic',
    context: {
      tools: [{
        name: 'arango_query',
        description: 'Query the Factory knowledge graph via AQL',
        aqlExamples: [
          'FOR s IN specs_signals FILTER s._key == @signalId RETURN s',
          'FOR d IN memory_semantic FILTER d.type == "decision" RETURN { key: d._key, decision: d.decision }',
          'FOR l IN memory_semantic FILTER l.type == "lesson" RETURN { key: l._key, lesson: l.lesson }',
          'FOR r IN mentorscript_rules FILTER r.status == "active" RETURN { ruleId: r._key, rule: r.rule }',
        ],
      }],
      memoryAccess: ['memory_semantic', 'mentorscript_rules', 'specs_signals', 'specs_functions', 'specs_workgraphs', 'execution_artifacts'],
      environment: 'v8-isolate',
      permissions: ['read'],
      platform: {
        host: 'coordinator-do',
        hostClass: 'SynthesisCoordinator extends Agent (agents SDK)',
        runtime: 'gdk-agent-agentloop',
        executorDefault: 'gdk-agent',
      },
    },
    intent: {
      jtbd: 'When a PRD or code artifact needs validation, I want to verify it against the original specification, architectural decisions, and mentor rules, so misaligned or defective artifacts are caught before they propagate downstream.',
      produces: 'SemanticReviewResult | CritiqueReport',
      outputShape: {
        'semanticReview.alignment': '"aligned" | "miscast" | "uncertain"',
        'semanticReview.confidence': 'number (0.0–1.0)',
        'semanticReview.citations': 'string[] — specific spec sections referenced',
        'semanticReview.rationale': 'string — explanation grounded in evidence',
        'semanticReview.timestamp': 'string — ISO 8601',
        'codeReview.passed': 'boolean',
        'codeReview.issues': '{ severity, description, file?, line? }[]',
        'codeReview.mentorRuleCompliance': '{ ruleId, compliant }[]',
        'codeReview.overallAssessment': 'string',
      },
      successCriteria: [
        'Semantic review cites specific spec sections, not vague claims',
        'Code review checks every active MentorScript rule',
        'Confidence below 0.7 triggers CRP escalation (ontology C7)',
        'Review is grounded in original specContent, not pipeline intermediates (ontology C10)',
      ],
    },
    engineering: {
      modelRoute: { provider: 'anthropic', model: 'claude-opus-4.6' },
      fallbackRoute: { provider: 'google', model: 'gemini-3.1-pro-preview' },
      taskKind: 'critic',
      timeoutMs: 120_000,
      maxTokens: 4096,
      maxTurns: 5,
      inputFields: {
        'semanticReview.prd': { type: 'Record<string, unknown>', required: true, description: 'PRD or WorkGraph to review' },
        'semanticReview.specContent': { type: 'string', required: false, description: 'Original specification for ground truth comparison' },
        'codeReview.code': { type: 'CodeArtifact', required: true, description: 'Code output from Coder' },
        'codeReview.plan': { type: 'Plan', required: true, description: 'Plan the code should implement' },
        'codeReview.workGraph': { type: 'Record<string, unknown>', required: true, description: 'WorkGraph specification' },
        'codeReview.mentorRules': { type: 'string[]', required: false, description: 'Active MentorScript rules' },
      },
      outputValidation: {
        required: ['alignment', 'confidence', 'citations', 'rationale', 'timestamp'],
        types: { alignment: 'string', confidence: 'number', citations: 'array', rationale: 'string', timestamp: 'string' },
      },
    },
    prompts: {
      system: `You are the Critic agent in the Function Factory synthesis pipeline.

You operate in two modes:
1. SEMANTIC REVIEW: Compare a PRD/WorkGraph against the original specification. Assess alignment.
2. CODE REVIEW: Review code against the plan, invariants, and active MentorScript rules.

You have the arango_query tool. USE IT to ground every review in real Factory context. Never review against hallucinated expectations — only against what exists in the knowledge graph and the provided specContent.`,
      outputFormat: `Semantic Review — respond with ONLY JSON:
{
  "alignment": "aligned" | "miscast" | "uncertain",
  "confidence": 0.0 to 1.0,
  "citations": ["specific spec section or artifact referenced"],
  "rationale": "Grounded explanation of alignment assessment",
  "timestamp": "ISO 8601"
}

Code Review — respond with ONLY JSON:
{
  "passed": true | false,
  "issues": [{ "severity": "critical | major | minor", "description": "...", "file": "path", "line": 42 }],
  "mentorRuleCompliance": [{ "ruleId": "MR-001", "compliant": true }],
  "overallAssessment": "Summary of review"
}`,
      toolGuidance: `For semantic review: query the original signal, spec content, and decisions.
For code review: query mentor rules (MANDATORY — C8), invariants, and past critiques.
Always query mentorscript_rules before producing a code review.`,
      mentorRuleInjection: true,
    },
    version: '1.0.0',
    updatedAt: now(),
  },

  // ─── PLANNER ───────────────────────────────────────────────
  {
    _key: 'planner',
    context: {
      tools: [{
        name: 'arango_query',
        description: 'Query the Factory knowledge graph via AQL',
        aqlExamples: [
          'FOR f IN specs_functions LIMIT 10 RETURN { key: f._key, name: f.name, domain: f.domain }',
          'FOR i IN specs_invariants LIMIT 10 RETURN { key: i._key, description: i.description }',
          'FOR d IN memory_semantic FILTER d.type == "decision" RETURN { key: d._key, decision: d.decision }',
        ],
      }],
      memoryAccess: ['memory_semantic', 'specs_functions', 'specs_invariants', 'specs_workgraphs'],
      environment: 'v8-isolate',
      permissions: ['read'],
      platform: {
        host: 'coordinator-do',
        hostClass: 'SynthesisCoordinator extends Agent (agents SDK)',
        runtime: 'gdk-agent-agentloop',
        executorDefault: 'gdk-agent',
      },
    },
    intent: {
      jtbd: 'When a BriefingScript and WorkGraph are available after architect review, I want to decompose the work into executable atoms with clear dependency ordering and implementation guidance, so the Coder has an unambiguous plan.',
      produces: 'Plan',
      outputShape: {
        approach: 'string — high-level implementation strategy',
        atoms: '{ id, description, assignedTo }[] — ordered implementation steps',
        executorRecommendation: '"gdk-agent" | "sandbox" | "container-openhands"',
        estimatedComplexity: '"low" | "medium" | "high"',
      },
      successCriteria: [
        'Every WorkGraph atom has a corresponding plan atom',
        'Atoms are ordered by dependency (no forward references)',
        'Executor recommendation matches the work type (gdk-agent for V8, sandbox for filesystem, container-openhands for browser)',
        'Repair cycles reference the specific failure and adjust strategy',
      ],
    },
    engineering: {
      modelRoute: { provider: 'google', model: 'gemini-3.1-pro-preview' },
      fallbackRoute: { provider: 'deepseek', model: 'deepseek-v4-pro' },
      taskKind: 'planner',
      timeoutMs: 120_000,
      maxTokens: 4096,
      maxTurns: 5,
      inputFields: {
        workGraph: { type: 'Record<string, unknown>', required: true, description: 'Compiled specification' },
        briefingScript: { type: 'BriefingScript', required: true, description: 'Architect guidance' },
        specContent: { type: 'string', required: false, description: 'Original specification text' },
        repairNotes: { type: 'string', required: false, description: 'Verifier notes on what to fix (patch cycle)' },
        previousPlan: { type: 'Plan', required: false, description: 'Previous plan (patch/resample cycle)' },
        resampleReason: { type: 'string', required: false, description: 'Why the approach needs to change' },
      },
      outputValidation: {
        required: ['approach', 'atoms', 'executorRecommendation', 'estimatedComplexity'],
        types: { approach: 'string', atoms: 'array', executorRecommendation: 'string', estimatedComplexity: 'string' },
      },
    },
    prompts: {
      system: `You are the Planner agent in the Function Factory synthesis pipeline.

Your job: produce a Plan that decomposes a WorkGraph specification into concrete implementation steps for the Coder agent.

You have the arango_query tool. USE IT to understand what already exists before planning. Query existing functions, invariants, and dependencies. Do not plan implementations that duplicate existing code.

If this is a repair cycle (repairNotes/resampleReason provided), adjust your strategy based on the specific failure.`,
      outputFormat: `Respond with ONLY a JSON object:
{
  "approach": "High-level strategy description",
  "atoms": [
    { "id": "atom-id", "description": "What to implement and how", "assignedTo": "coder" }
  ],
  "executorRecommendation": "gdk-agent | sandbox | container-openhands",
  "estimatedComplexity": "low | medium | high"
}`,
      toolGuidance: `Query before planning:
1. specs_functions — what already exists (avoid duplication)
2. specs_invariants — constraints that must be preserved
3. memory_semantic (decisions) — architectural boundaries`,
      mentorRuleInjection: false,
    },
    version: '1.0.0',
    updatedAt: now(),
  },

  // ─── CODER ─────────────────────────────────────────────────
  {
    _key: 'coder',
    context: {
      tools: [{
        name: 'arango_query',
        description: 'Query the Factory knowledge graph via AQL',
        aqlExamples: [
          'FOR f IN specs_functions LIMIT 5 RETURN { key: f._key, name: f.name, domain: f.domain }',
          'FOR inv IN specs_invariants FILTER inv.status == "active" RETURN { id: inv._key, condition: inv.condition }',
          'FOR r IN mentorscript_rules FILTER r.status == "active" RETURN { ruleId: r._key, rule: r.rule }',
          'FOR ea IN execution_artifacts FILTER ea.type == "code" LIMIT 3 RETURN { key: ea._key, functionRunId: ea.functionRunId }',
        ],
      },
      // Phase C adds: file_read, file_write, bash_execute, grep_search, git
      ],
      memoryAccess: ['memory_semantic', 'mentorscript_rules', 'specs_invariants', 'specs_functions', 'execution_artifacts'],
      environment: 'sandbox-container',
      permissions: ['read', 'write', 'execute'],
      platform: {
        host: 'sandbox-container',
        hostClass: 'Sandbox extends DurableObject (@cloudflare/sandbox)',
        runtime: 'sandbox-exec-rpc',
        executorDefault: 'gdk-agent',
      },
    },
    intent: {
      jtbd: 'When a Plan with implementation atoms is available, I want to produce file changes that implement the plan while respecting invariants and mentor rules, so the code can be tested, critiqued, and verified.',
      produces: 'CodeArtifact',
      outputShape: {
        files: '{ path, content, action }[] — file changes to apply',
        summary: 'string — what was implemented and why',
        testsIncluded: 'boolean — whether tests are included in files',
      },
      successCriteria: [
        'Every plan atom has corresponding file changes',
        'Code respects active invariants from ArangoDB',
        'Code follows MentorScript rules (C8)',
        'No secrets in output (C15)',
        'Repair cycles address specific critique issues, not rewrite from scratch',
      ],
    },
    engineering: {
      modelRoute: { provider: 'deepseek', model: 'deepseek-v4-pro' },
      fallbackRoute: { provider: 'anthropic', model: 'claude-opus-4.6' },
      taskKind: 'coder',
      timeoutMs: 120_000,
      maxTokens: 8192,
      maxTurns: 8,
      inputFields: {
        workGraph: { type: 'Record<string, unknown>', required: true, description: 'WorkGraph specification' },
        plan: { type: 'Plan', required: true, description: 'Implementation plan from Planner' },
        specContent: { type: 'string', required: false, description: 'Original specification' },
        repairNotes: { type: 'string', required: false, description: 'Verifier repair notes' },
        previousCode: { type: 'CodeArtifact', required: false, description: 'Previous code (patch cycle)' },
        critiqueIssues: { type: 'Issue[]', required: false, description: 'Critic issues to address' },
      },
      outputValidation: {
        required: ['files', 'summary', 'testsIncluded'],
        types: { files: 'array', summary: 'string', testsIncluded: 'boolean' },
      },
    },
    prompts: {
      system: `You are the Coder agent in the Function Factory synthesis pipeline.

Your job: produce a CodeArtifact — a set of file changes that implement the Plan against the WorkGraph specification.

You have the arango_query tool. USE IT to query invariants, existing patterns, and mentor rules before writing code. Do not hallucinate patterns or imports.

If this is a repair cycle (repairNotes provided), focus on fixing the specific issues noted. Reuse existing patterns from the codebase. Follow the plan's atom ordering.`,
      outputFormat: `Respond with ONLY a JSON object:
{
  "files": [
    { "path": "src/example.ts", "content": "file content here", "action": "create | modify | delete" }
  ],
  "summary": "What was implemented and why",
  "testsIncluded": true | false
}`,
      toolGuidance: `Query before coding:
1. specs_invariants — constraints your code must respect
2. mentorscript_rules — coding standards to follow
3. execution_artifacts (type == 'code') — past implementations for patterns
4. specs_functions — existing functions to avoid duplication`,
      mentorRuleInjection: true,
    },
    version: '1.0.0',
    updatedAt: now(),
  },

  // ─── TESTER ────────────────────────────────────────────────
  {
    _key: 'tester',
    context: {
      tools: [{
        name: 'arango_query',
        description: 'Query the Factory knowledge graph via AQL',
        aqlExamples: [
          'FOR inv IN specs_invariants FILTER inv.status == "active" RETURN { key: inv._key, rule: inv.rule, severity: inv.severity }',
          'FOR t IN execution_artifacts FILTER t.type == "test_report" LIMIT 5 RETURN { key: t._key, content: t.content }',
          'FOR l IN memory_semantic FILTER l.type == "lesson" AND CONTAINS(LOWER(l.lesson), "test") RETURN { key: l._key, lesson: l.lesson }',
        ],
      },
      // Phase C adds: file_read, bash_execute (read-only gate blocks writes)
      ],
      memoryAccess: ['memory_semantic', 'specs_invariants', 'execution_artifacts'],
      environment: 'sandbox-container',
      permissions: ['read', 'execute'],
      platform: {
        host: 'sandbox-container',
        hostClass: 'Sandbox extends DurableObject (@cloudflare/sandbox)',
        runtime: 'sandbox-exec-rpc',
        executorDefault: 'gdk-agent',
      },
    },
    intent: {
      jtbd: 'When code is produced by the Coder, I want to verify invariant compliance and functional correctness by running or evaluating tests, so defects are caught before the Verifier renders a verdict.',
      produces: 'TestReport',
      outputShape: {
        passed: 'boolean — overall pass/fail',
        testsRun: 'number — total tests executed',
        testsPassed: 'number',
        testsFailed: 'number',
        failures: '{ name, error }[] — details of failed tests',
        summary: 'string — assessment of test quality and coverage',
      },
      successCriteria: [
        'Every active invariant has a corresponding test',
        'Test results reflect actual code behavior, not hallucinated outcomes',
        'Failure descriptions are specific enough for the Coder to fix',
        'In sandbox mode (Phase C), tests are EXECUTED not simulated (C12)',
      ],
    },
    engineering: {
      modelRoute: { provider: 'deepseek', model: 'deepseek-v4-pro' },
      fallbackRoute: { provider: 'moonshotai', model: 'kimi-k2.6' },
      taskKind: 'tester',
      timeoutMs: 120_000,
      maxTokens: 4096,
      maxTurns: 5,
      inputFields: {
        workGraph: { type: 'Record<string, unknown>', required: true, description: 'WorkGraph specification' },
        plan: { type: 'Plan', required: true, description: 'Implementation plan' },
        code: { type: 'CodeArtifact', required: true, description: 'Code to test' },
        critique: { type: 'CritiqueReport', required: false, description: 'Critic review results' },
      },
      outputValidation: {
        required: ['passed', 'testsRun', 'testsPassed', 'testsFailed', 'failures', 'summary'],
        types: { passed: 'boolean', testsRun: 'number', testsPassed: 'number', testsFailed: 'number', failures: 'array', summary: 'string' },
      },
    },
    prompts: {
      system: `You are the Tester agent in the Function Factory synthesis pipeline.

Your job: evaluate the code produced by the Coder against the WorkGraph specification, the Plan, and invariants from the knowledge graph. Produce a TestReport.

You have the arango_query tool. USE IT to query active invariants BEFORE producing your report. Every invariant must have a corresponding test. Do not hallucinate test results.`,
      outputFormat: `Respond with ONLY a JSON object:
{
  "passed": true | false,
  "testsRun": <number>,
  "testsPassed": <number>,
  "testsFailed": <number>,
  "failures": [{ "name": "test name", "error": "what failed" }],
  "summary": "Assessment of test quality, invariant coverage, and readiness"
}`,
      toolGuidance: `Query before testing:
1. specs_invariants (status == 'active') — MANDATORY: every invariant needs a test
2. execution_artifacts (type == 'test_report') — past test patterns
3. memory_semantic (lessons about testing) — known failure patterns`,
      mentorRuleInjection: false,
    },
    version: '1.0.0',
    updatedAt: now(),
  },

  // ─── VERIFIER ──────────────────────────────────────────────
  {
    _key: 'verifier',
    context: {
      tools: [{
        name: 'arango_query',
        description: 'Query the Factory knowledge graph via AQL',
        aqlExamples: [
          'FOR f IN specs_functions FILTER f._key == @id RETURN { key: f._key, name: f.name, lineage: f.source_refs }',
          'FOR inv IN specs_invariants RETURN { key: inv._key, description: inv.description, detector: inv.detector }',
          'FOR ep IN memory_episodic FILTER ep.functionId == @id SORT ep.timestamp DESC LIMIT 5 RETURN ep',
          'FOR r IN mentorscript_rules FILTER r.status == "active" RETURN { ruleId: r._key, rule: r.rule }',
        ],
      }],
      memoryAccess: ['memory_semantic', 'memory_episodic', 'mentorscript_rules', 'specs_functions', 'specs_invariants', 'gate_status'],
      environment: 'v8-isolate',
      permissions: ['read'],
      platform: {
        host: 'coordinator-do',
        hostClass: 'SynthesisCoordinator extends Agent (agents SDK)',
        runtime: 'gdk-agent-agentloop',
        executorDefault: 'gdk-agent',
      },
    },
    intent: {
      jtbd: 'When code has been produced, critiqued, and tested, I want to render a final verdict with clear reasoning based on evidence from the knowledge graph, so the synthesis can proceed, repair, or halt.',
      produces: 'Verdict',
      outputShape: {
        decision: '"pass" | "fail" | "patch" | "resample" | "interrupt"',
        confidence: 'number (0.0–1.0)',
        reason: 'string — why this decision',
        notes: 'string? — specific repair guidance (for patch/resample)',
      },
      successCriteria: [
        'Decision grounded in evidence: test results, critique, lineage, invariant coverage',
        'Confidence below 0.7 triggers CRP escalation (ontology C7)',
        'Patch decisions include actionable repair notes for the Coder',
        'Resample decisions explain WHY the approach is wrong, not just that it failed',
        'Pass decisions only when ALL checks clear — no optimistic passes on incomplete evidence',
      ],
    },
    engineering: {
      modelRoute: { provider: 'google', model: 'gemini-3.1-pro-preview' },
      fallbackRoute: { provider: 'anthropic', model: 'claude-opus-4.6' },
      taskKind: 'verifier',
      timeoutMs: 120_000,
      maxTokens: 4096,
      maxTurns: 5,
      inputFields: {
        workGraph: { type: 'Record<string, unknown>', required: true, description: 'WorkGraph specification' },
        plan: { type: 'Plan | null', required: true, description: 'Implementation plan' },
        code: { type: 'CodeArtifact | null', required: true, description: 'Code output' },
        critique: { type: 'CritiqueReport | null', required: true, description: 'Code review results' },
        tests: { type: 'TestReport | null', required: true, description: 'Test execution results' },
        repairCount: { type: 'number', required: true, description: 'Current repair iteration' },
        maxRepairs: { type: 'number', required: true, description: 'Maximum allowed repairs' },
        tokenUsage: { type: 'number', required: true, description: 'Tokens consumed so far' },
        maxTokens: { type: 'number', required: true, description: 'Token budget ceiling' },
      },
      outputValidation: {
        required: ['decision', 'confidence', 'reason'],
        types: { decision: 'string', confidence: 'number', reason: 'string' },
      },
    },
    prompts: {
      system: `You are the Verifier agent in the Function Factory synthesis pipeline. You make the FINAL decision.

You have the arango_query tool. USE IT to verify lineage, check invariant coverage, and confirm evidence before rendering a verdict. Do not pass on incomplete evidence.

DECISION CRITERIA:
- "pass" — code meets spec, tests pass, critique is clean, lineage traceable. Ship it.
- "patch" — fixable issues found. Provide specific repair notes for the Coder.
- "resample" — approach is fundamentally wrong. Restart from Planner.
- "interrupt" — budget exhausted or ambiguous spec. Needs architect input.
- "fail" — unfixable within budget. Stop.

Bias toward "pass" when issues are minor. Bias toward "patch" when issues are fixable.
Only "fail" when the approach is fundamentally broken AND budget is low.`,
      outputFormat: `Respond with ONLY a JSON object:
{
  "decision": "pass | patch | resample | interrupt | fail",
  "confidence": 0.0 to 1.0,
  "reason": "Why this decision, grounded in evidence",
  "notes": "Specific repair guidance (if patch/resample)"
}`,
      toolGuidance: `Query before deciding:
1. specs_invariants — are all invariants covered?
2. memory_episodic — how many repair attempts already?
3. mentorscript_rules — did the code comply?
4. gate_status — did prior gates pass?`,
      mentorRuleInjection: true,
    },
    version: '1.0.0',
    updatedAt: now(),
  },
]

// ═══════════════════════════════════════════════════════════════
// SEED + LOAD
// ═══════════════════════════════════════════════════════════════

export async function seedAgentDesigns(db: ArangoClient): Promise<{ seeded: number; errors: string[] }> {
  const errors: string[] = []
  let seeded = 0

  for (const design of AGENT_DESIGNS) {
    try {
      await db.save('agent_designs', design)
      seeded++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('unique constraint') || msg.includes('conflict')) {
        try {
          await db.save('agent_designs', design)
          seeded++
        } catch {
          errors.push(`${design._key}: ${msg}`)
        }
      } else {
        errors.push(`${design._key}: ${msg}`)
      }
    }
  }

  return { seeded, errors }
}

export async function loadAgentDesign(db: ArangoClient, roleKey: string): Promise<AgentDesign | null> {
  try {
    const results = await db.query<AgentDesign>(
      `FOR d IN agent_designs FILTER d._key == @key RETURN d`,
      { key: roleKey },
    )
    return results[0] ?? null
  } catch {
    return null
  }
}

export function buildSystemPrompt(design: AgentDesign): string {
  const parts = [design.prompts.system]

  if (design.prompts.toolGuidance) {
    parts.push(`\n${design.prompts.toolGuidance}`)
  }

  if (design.prompts.outputFormat) {
    parts.push(`\n${design.prompts.outputFormat}`)
  }

  return parts.join('\n')
}
