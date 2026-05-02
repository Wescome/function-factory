/**
 * AtomExecutor — per-atom 4-node pipeline: code → critic → test → verify.
 *
 * v5 implementation: runs as a function within the coordinator's execution
 * context. Each atom gets independent retry logic with configurable max retries.
 *
 * NOT a separate Durable Object (that's v5.1). This runs in-process via
 * Promise.all for concurrent I/O on LLM calls.
 */

import type { CodeArtifact, CritiqueReport, TestReport, Verdict, PipelineWorkGraph } from './state'
import type { FileContext } from '@factory/file-context'

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export interface AtomSlice {
  atomId: string
  atomSpec: Record<string, unknown>
  upstreamArtifacts: Record<string, unknown>
  sharedContext: {
    workGraphId: string
    specContent: string | null
    briefingScript: unknown
  }
  fileContexts?: FileContext[]
}

export interface AtomResult {
  atomId: string
  verdict: {
    decision: 'pass' | 'fail' | 'patch'
    confidence: number
    reason: string
    disagreement_class?: string | null
    requires_human_approval?: boolean
    escalation_score?: number
  }
  codeArtifact: CodeArtifact | null
  testReport: TestReport | null
  critiqueReport: CritiqueReport | null
  retryCount: number
}

/**
 * Dependencies injected from the coordinator. These are the same agent
 * instances — agents are stateless between calls.
 */
export interface AtomExecutorDeps {
  coderAgent: {
    produceCode: (input: {
      workGraph: PipelineWorkGraph
      plan: Record<string, unknown>
      specContent?: string
      repairNotes?: string
      previousCode?: CodeArtifact
      critiqueIssues?: CritiqueReport['issues']
      fileContexts?: FileContext[]
    }) => Promise<CodeArtifact>
  }
  criticAgent: {
    codeReview: (input: {
      code: unknown
      plan: unknown
      workGraph: PipelineWorkGraph
      mentorRules?: string[]
    }) => Promise<CritiqueReport>
  }
  testerAgent: {
    runTests: (input: {
      workGraph: PipelineWorkGraph
      plan: Record<string, unknown>
      code: Record<string, unknown>
      critique?: CritiqueReport | Record<string, unknown>
    }) => Promise<TestReport>
  }
  verifierAgent: {
    verify: (input: {
      workGraph: PipelineWorkGraph
      plan: Record<string, unknown> | null
      code: CodeArtifact | null
      critique: CritiqueReport | null
      tests: TestReport | null
      repairCount: number
      maxRepairs: number
      tokenUsage: number
      maxTokens: number
    }) => Promise<Verdict>
  }
  fetchMentorRules: () => Promise<{ ruleId: string; rule: string }[]>
}

// ────────────────────────────────────────────────────────────
// Language validation — post-generation, pre-critic gate
// ────────────────────────────────────────────────────────────

const ALLOWED_EXTENSIONS = ['.ts', '.json', '.md']

const NON_TS_MARKERS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /^#!\//m, label: 'shebang' },
  { pattern: /^from\s+\w+\s+import/m, label: 'Python import' },
  { pattern: /^import\s+java\./m, label: 'Java import' },
  { pattern: /^#include\s/m, label: 'C/C++ include' },
  { pattern: /^def\s+\w+\s*\(/m, label: 'Python def' },
  { pattern: /^class\s+\w+\(\w+\)\s*:/m, label: 'Python class' },
]

/**
 * Validate that a CodeArtifact contains only TypeScript/JSON/Markdown files
 * and no foreign language markers. Runs after CoderAgent.produceCode()
 * and before the CriticAgent — prevents non-TS code from reaching PR generation.
 */
export function validateCodeLanguage(code: CodeArtifact): { valid: boolean; violations: string[] } {
  const violations: string[] = []
  for (const file of code.files) {
    if (file.action === 'delete') continue

    // Check file extension
    const hasAllowedExt = ALLOWED_EXTENSIONS.some(ext => file.path.endsWith(ext))
    if (!hasAllowedExt) {
      violations.push(`${file.path}: non-TypeScript file extension`)
    }

    // Check content for non-TS markers
    const content = file.content ?? ''
    for (const { pattern, label } of NON_TS_MARKERS) {
      if (pattern.test(content)) {
        violations.push(`${file.path}: contains ${label} marker`)
        break // one violation per file is sufficient
      }
    }
  }
  return { valid: violations.length === 0, violations }
}

// ────────────────────────────────────────────────────────────
// Execute one atom through the 4-node pipeline with retry
// ────────────────────────────────────────────────────────────

export async function executeAtomSlice(
  slice: AtomSlice,
  deps: AtomExecutorDeps,
  opts: { maxRetries: number; dryRun: boolean },
): Promise<AtomResult> {
  let retryCount = 0
  let code: CodeArtifact | null = null
  let critique: CritiqueReport | null = null
  let tests: TestReport | null = null
  let verdict: Verdict | null = null
  let repairNotes: string | undefined
  let previousCode: CodeArtifact | undefined

  // Build a minimal workGraph-like object for the atom
  const atomWorkGraph: PipelineWorkGraph = {
    _key: slice.sharedContext.workGraphId,
    id: slice.sharedContext.workGraphId,
    title: `Atom: ${slice.atomId}`,
    atoms: [slice.atomSpec],
    invariants: [],
    dependencies: [],
    ...slice.upstreamArtifacts,
  }

  // Build a minimal plan for the atom
  const atomPlan: Record<string, unknown> = {
    approach: `Execute atom ${slice.atomId}`,
    atoms: [slice.atomSpec],
    executorRecommendation: 'gdk-agent',
    estimatedComplexity: 'low',
  }

  const maxAttempts = 1 + opts.maxRetries // initial + retries

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Node 1: Code
    code = await deps.coderAgent.produceCode({
      workGraph: atomWorkGraph,
      plan: atomPlan,
      ...(slice.sharedContext.specContent ? { specContent: slice.sharedContext.specContent } : {}),
      ...(repairNotes ? { repairNotes } : {}),
      ...(previousCode ? { previousCode } : {}),
      ...(critique?.issues?.length ? { critiqueIssues: critique.issues } : {}),
      ...(slice.fileContexts?.length ? { fileContexts: slice.fileContexts } : {}),
    })

    // Language gate: enforce TypeScript-only before proceeding to critic
    const langCheck = validateCodeLanguage(code)
    if (!langCheck.valid) {
      verdict = {
        decision: 'fail',
        confidence: 1.0,
        reason: `synthesis:language-violation: ${langCheck.violations.join('; ')}`,
      }
      break
    }

    // Node 2: Code-critic
    const mentorRules = await deps.fetchMentorRules()
    critique = await deps.criticAgent.codeReview({
      code,
      plan: atomPlan,
      workGraph: atomWorkGraph,
      mentorRules: mentorRules.map(r => `${r.ruleId}: ${r.rule}`),
    })

    // Node 3: Test
    tests = await deps.testerAgent.runTests({
      workGraph: atomWorkGraph,
      plan: atomPlan,
      code: code as unknown as Record<string, unknown>,
      ...(critique ? { critique } : {}),
    })

    // Node 4: Verify
    verdict = await deps.verifierAgent.verify({
      workGraph: atomWorkGraph,
      plan: atomPlan,
      code,
      critique,
      tests,
      repairCount: retryCount,
      maxRepairs: opts.maxRetries,
      tokenUsage: 0,
      maxTokens: 150_000,
    })

    // Decision routing
    if (verdict.decision === 'pass' || verdict.decision === 'fail') {
      break
    }

    if (verdict.decision === 'patch' || verdict.decision === 'resample') {
      // Check if we have retries remaining BEFORE incrementing
      if (retryCount >= opts.maxRetries) {
        // Exceeded retry budget — force fail
        verdict = {
          decision: 'fail',
          confidence: 1.0,
          reason: `Atom ${slice.atomId} exceeded retry budget (${opts.maxRetries} retries)`,
        }
        break
      }
      retryCount++
      // Prepare repair context for next iteration
      repairNotes = verdict.notes ?? verdict.reason
      previousCode = code
      continue
    }

    // interrupt or unknown → treat as fail
    break
  }

  return {
    atomId: slice.atomId,
    verdict: {
      decision: (verdict?.decision === 'pass' || verdict?.decision === 'fail')
        ? verdict.decision
        : 'fail',
      confidence: verdict?.confidence ?? 0,
      reason: verdict?.reason ?? 'No verdict',
      ...(verdict?.disagreement_class ? { disagreement_class: verdict.disagreement_class } : {}),
      ...(verdict?.requires_human_approval !== undefined ? { requires_human_approval: verdict.requires_human_approval } : {}),
      ...(verdict?.escalation_score !== undefined ? { escalation_score: verdict.escalation_score } : {}),
    },
    codeArtifact: code,
    testReport: tests,
    critiqueReport: critique,
    retryCount,
  }
}
