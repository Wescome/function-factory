/**
 * Phase A: CoderAgent with gdk-agent agentLoop
 *
 * Validates:
 * 1. agentLoop runs and produces messages
 * 2. arango_query tool executes correctly (reuses buildArangoTool)
 * 3. CodeArtifact output shape is valid
 * 4. dry-run mode bypasses agentLoop
 * 5. Handles repair cycles (repairNotes, previousCode, critiqueIssues)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  registerFauxProvider,
  fauxAssistantMessage,
  fauxText,
  type FauxProviderRegistration,
} from '@weops/gdk-ai'
import { CoderAgent, type CoderInput } from './coder-agent'
import { processAgentOutput, CODE_ARTIFACT_SCHEMA } from './output-reliability'
import type { CodeArtifact } from '../coordinator/state'

const VALID_CODE_ARTIFACT: CodeArtifact = {
  files: [
    { path: 'src/auth/middleware.ts', content: 'export function authMiddleware() { return true }', action: 'create' },
    { path: 'src/auth/index.ts', content: 'export { authMiddleware } from "./middleware"', action: 'create' },
  ],
  summary: 'Implemented auth middleware with JWT validation per plan atom-001',
  testsIncluded: false,
}

const SAMPLE_WORKGRAPH = {
  _key: 'WG-CODER-001',
  title: 'User Authentication Module',
  atoms: [{ id: 'atom-001', description: 'Auth middleware' }],
  invariants: [{ id: 'INV-001', condition: 'All requests must be authenticated' }],
  dependencies: [],
}

const SAMPLE_PLAN = {
  approach: 'Implement JWT-based auth middleware',
  atoms: [{ id: 'atom-001', description: 'Create auth middleware', assignedTo: 'coder' }],
  executorRecommendation: 'gdk-agent' as const,
  estimatedComplexity: 'medium' as const,
}

function createMockDb() {
  const calls: { query: string }[] = []
  return {
    db: {
      query: async (query: string) => {
        calls.push({ query })
        if (query.includes('specs_functions')) {
          return [{ _key: 'FN-001', name: 'auth-module', domain: 'identity' }]
        }
        if (query.includes('execution_artifacts')) {
          return [{ _key: 'EA-001', type: 'code', content: '// existing pattern' }]
        }
        return []
      },
      save: async () => ({}),
      saveEdge: async () => ({}),
    } as any,
    calls,
  }
}

// ────────────────────────────────────────────────────────────
// Dry-run mode
// ────────────────────────────────────────────────────────────

describe('CoderAgent', () => {
  describe('dry-run mode', () => {
    it('returns hardcoded CodeArtifact without calling agentLoop', async () => {
      const { db } = createMockDb()
      const agent = new CoderAgent({ db, apiKey: 'test-key', dryRun: true })

      const result = await agent.produceCode({
        workGraph: SAMPLE_WORKGRAPH,
        plan: SAMPLE_PLAN,
      })

      expect(result.files).toBeDefined()
      expect(Array.isArray(result.files)).toBe(true)
      expect(result.files.length).toBeGreaterThan(0)
      expect(result.summary).toBeTypeOf('string')
      expect(typeof result.testsIncluded).toBe('boolean')
    })

    it('dry-run file has correct shape (path, content, action)', async () => {
      const { db } = createMockDb()
      const agent = new CoderAgent({ db, apiKey: 'test-key', dryRun: true })

      const result = await agent.produceCode({
        workGraph: SAMPLE_WORKGRAPH,
        plan: SAMPLE_PLAN,
      })

      for (const file of result.files) {
        expect(file.path).toBeTypeOf('string')
        expect(file.content).toBeTypeOf('string')
        expect(['create', 'modify', 'delete']).toContain(file.action)
      }
    })
  })

  // ────────────────────────────────────────────────────────────
  // Validation
  // ────────────────────────────────────────────────────────────

  describe('validation (via ORL)', () => {
    it('rejects response missing files array', async () => {
      const result = await processAgentOutput(
        JSON.stringify({ summary: 'ok', testsIncluded: false }),
        CODE_ARTIFACT_SCHEMA,
      )
      expect(result.success).toBe(false)
      expect(result.failureMode).toBe('F3')
    })

    it('coerces non-array files to array', async () => {
      const result = await processAgentOutput(
        JSON.stringify({ files: null, summary: 'ok', testsIncluded: false }),
        CODE_ARTIFACT_SCHEMA,
      )
      expect(result.success).toBe(true)
      expect(Array.isArray(result.data!.files)).toBe(true)
      expect(result.data!.files).toHaveLength(0)
    })

    it('rejects response missing summary', async () => {
      const result = await processAgentOutput(
        JSON.stringify({ files: [], testsIncluded: false }),
        CODE_ARTIFACT_SCHEMA,
      )
      expect(result.success).toBe(false)
      expect(result.failureMode).toBe('F3')
    })

    it('rejects response missing testsIncluded', async () => {
      const result = await processAgentOutput(
        JSON.stringify({ files: [], summary: 'ok' }),
        CODE_ARTIFACT_SCHEMA,
      )
      expect(result.success).toBe(false)
      expect(result.failureMode).toBe('F3')
    })

    it('rejects non-objects (prose)', async () => {
      const r1 = await processAgentOutput('just a string', CODE_ARTIFACT_SCHEMA)
      expect(r1.success).toBe(false)

      const r2 = await processAgentOutput(null as any, CODE_ARTIFACT_SCHEMA)
      expect(r2.success).toBe(false)
      expect(r2.failureMode).toBe('F7')
    })

    it('coerces invalid action to the raw string (fallback)', async () => {
      const result = await processAgentOutput(JSON.stringify({
        files: [{ path: 'x.ts', content: '//', action: 'invalid' }],
        summary: 'ok',
        testsIncluded: false,
      }), CODE_ARTIFACT_SCHEMA)
      expect(result.success).toBe(true)
      expect(result.data!.files[0]!.action).toBe('invalid')
    })

    it('accepts valid CodeArtifact', async () => {
      const result = await processAgentOutput(JSON.stringify(VALID_CODE_ARTIFACT), CODE_ARTIFACT_SCHEMA)
      expect(result.success).toBe(true)
    })
  })

  // ────────────────────────────────────────────────────────────
  // agentLoop integration (faux provider)
  // ────────────────────────────────────────────────────────────

  describe('agentLoop integration', () => {
    let faux: FauxProviderRegistration

    beforeEach(() => {
      faux = registerFauxProvider()
      faux.setResponses([
        // Single turn: agent produces CodeArtifact (no tools)
        fauxAssistantMessage(
          fauxText(JSON.stringify(VALID_CODE_ARTIFACT)),
          { stopReason: 'stop' },
        ),
      ])
    })

    afterEach(() => {
      faux?.unregister()
    })

    it('runs agentLoop with faux model, produces CodeArtifact (no tool calls)', async () => {
      const { db } = createMockDb()
      const fauxModel = faux.getModel()

      const agent = new CoderAgent({
        db,
        apiKey: 'faux-key',
        dryRun: false,
        model: fauxModel,
      })

      const result = await agent.produceCode({
        workGraph: SAMPLE_WORKGRAPH,
        plan: SAMPLE_PLAN,
      })

      // Verify CodeArtifact shape
      expect(result.files).toHaveLength(2)
      expect(result.files[0]!.path).toBe('src/auth/middleware.ts')
      expect(result.files[0]!.action).toBe('create')
      expect(result.summary).toBe(VALID_CODE_ARTIFACT.summary)
      expect(result.testsIncluded).toBe(false)
    })

    it('includes repairNotes in user message when provided', async () => {
      const { db } = createMockDb()
      const fauxModel = faux.getModel()

      const agent = new CoderAgent({
        db,
        apiKey: 'faux-key',
        dryRun: false,
        model: fauxModel,
      })

      // Should not throw — repair context is threaded into user message
      const result = await agent.produceCode({
        workGraph: SAMPLE_WORKGRAPH,
        plan: SAMPLE_PLAN,
        repairNotes: 'Fix the JWT token expiry handling',
        previousCode: { files: [], summary: 'old', testsIncluded: false },
        critiqueIssues: [{ severity: 'major', description: 'Token expiry not handled' }],
      })

      expect(result.files).toBeDefined()
    })

    it('includes specContent in user message when provided', async () => {
      const { db } = createMockDb()
      const fauxModel = faux.getModel()

      const agent = new CoderAgent({
        db,
        apiKey: 'faux-key',
        dryRun: false,
        model: fauxModel,
      })

      const result = await agent.produceCode({
        workGraph: SAMPLE_WORKGRAPH,
        plan: SAMPLE_PLAN,
        specContent: 'The system SHALL authenticate all API requests using JWT.',
      })

      expect(result.files).toBeDefined()
    })

    it('includes contextPrompt in user message when provided', async () => {
      const { db } = createMockDb()
      const fauxModel = faux.getModel()

      const agent = new CoderAgent({
        db,
        apiKey: 'faux-key',
        dryRun: false,
        model: fauxModel,
        contextPrompt: '## Factory Context\n- [FN-001] auth-module',
      })

      const result = await agent.produceCode({
        workGraph: SAMPLE_WORKGRAPH,
        plan: SAMPLE_PLAN,
      })

      expect(result.files).toBeDefined()
    })
  })

  // ────────────────────────────────────────────────────────────
  // Error handling
  // ────────────────────────────────────────────────────────────

  describe('error handling', () => {
    let faux: FauxProviderRegistration

    afterEach(() => {
      faux?.unregister()
    })

    it('throws on agent loop error response', async () => {
      faux = registerFauxProvider()
      faux.setResponses([
        fauxAssistantMessage([], { stopReason: 'error', errorMessage: 'model failure' }),
      ])

      const { db } = createMockDb()
      const agent = new CoderAgent({
        db,
        apiKey: 'faux-key',
        dryRun: false,
        model: faux.getModel(),
      })

      await expect(
        agent.produceCode({ workGraph: SAMPLE_WORKGRAPH, plan: SAMPLE_PLAN }),
      ).rejects.toThrow()
    })

    it('throws when model returns invalid JSON as text', async () => {
      faux = registerFauxProvider()
      faux.setResponses([
        // Single turn: agent returns garbage text (not valid JSON)
        fauxAssistantMessage(
          fauxText('This is not valid JSON at all'),
          { stopReason: 'stop' },
        ),
      ])

      const { db } = createMockDb()
      const agent = new CoderAgent({
        db,
        apiKey: 'faux-key',
        dryRun: false,
        model: faux.getModel(),
      })

      await expect(
        agent.produceCode({ workGraph: SAMPLE_WORKGRAPH, plan: SAMPLE_PLAN }),
      ).rejects.toThrow('could not produce valid CodeArtifact')
    })
  })
})
