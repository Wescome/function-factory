/**
 * Semantic Grounding Tests (TDD — RED phase)
 *
 * Tests for the minimum viable pipeline semantic grounding fix.
 * specContent threads through the pipeline so Stage 4 and the Critic
 * have access to the original specification content.
 *
 * Test order follows the approved design:
 * 1. SignalInput accepts specContent
 * 2. ingestSignal persists specContent to ArangoDB
 * 3. specContent threads through pressure -> capability -> proposal
 * 4. proposeFunction includes specContent in LLM prompt when present
 * 5. semanticReview uses specContent as ground truth when present
 * 6. All stages work unchanged when specContent is absent (backwards compat)
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

// ── Mock cloudflare:workers (required for any pipeline import) ──
vi.mock('cloudflare:workers', () => {
  class WorkflowEntrypoint {}
  class DurableObject {
    env: unknown
    ctx: unknown
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx
      this.env = env
    }
  }
  return { WorkflowEntrypoint, DurableObject }
})

// ── Mock model-bridge so we can inspect prompts without real LLM calls ──
const mockCallModel = vi.fn(async (_taskKind: string, _system: string, _user: string, _env: unknown) => JSON.stringify({
  title: 'Mock title',
  description: 'Mock description',
  priority: 'high',
  category: 'infrastructure',
  evidence: [],
  sourceRefs: [],
  gapAnalysis: 'Mock gap',
  prd: {
    title: 'Mock PRD',
    objective: 'Mock objective',
    acceptanceCriteria: ['AC-1'],
    invariants: ['INV-1'],
    scope: { includes: ['in'], excludes: ['out'] },
  },
  birthGateScore: 0.85,
  alignment: 'aligned',
  confidence: 0.9,
  citations: [],
  rationale: 'Mock rationale',
}))

vi.mock('../model-bridge', () => ({
  callModel: (taskKind: string, system: string, user: string, env: unknown) =>
    mockCallModel(taskKind, system, user, env),
}))

// ── Mock ArangoDB client ──
function createMockDb() {
  return {
    save: vi.fn(async () => ({ _key: 'mock-key' })),
    saveEdge: vi.fn(async () => ({ _key: 'mock-edge' })),
    query: vi.fn(async () => []),
    queryOne: vi.fn(async () => null),
  }
}

function createMockEnv() {
  return {
    ARANGO_URL: 'http://localhost:8529',
    ARANGO_DATABASE: 'test',
    ARANGO_JWT: 'test-jwt',
    ENVIRONMENT: 'test',
    OFOX_API_KEY: 'test-key',
  } as any
}

// ── Imports (after mocks) ──
import { ingestSignal } from './ingest-signal'
import { synthesizePressure } from './synthesize-pressure'
import { mapCapability } from './map-capability'
import { proposeFunction } from './propose-function'
import { semanticReview } from './semantic-review'
import type { SignalInput } from '../types'


// ═══════════════════════════════════════════════════════════════════
// Test 1: SignalInput with specContent is persisted correctly
// ═══════════════════════════════════════════════════════════════════

describe('Semantic Grounding: Signal persistence', () => {
  let db: ReturnType<typeof createMockDb>

  beforeEach(() => {
    db = createMockDb()
    mockCallModel.mockClear()
  })

  it('persists specContent to ArangoDB when present on SignalInput', async () => {
    const input: SignalInput = {
      signalType: 'meta',
      source: 'architect',
      title: 'Phase 5 Hybrid Agent Sandbox',
      description: 'Specification for hybrid agent sandbox architecture',
      specContent: '# Phase 5\n\nThis is the full spec content with 800 lines of detail...',
    }

    const result = await ingestSignal(input, db as any)

    // The saved document should include specContent
    expect(db.save).toHaveBeenCalledOnce()
    const saveArgs = db.save.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(saveArgs[1].specContent).toBe(
      '# Phase 5\n\nThis is the full spec content with 800 lines of detail...',
    )
  })

  it('persists signal without specContent when not provided (backwards compat)', async () => {
    const input: SignalInput = {
      signalType: 'internal',
      source: 'test',
      title: 'Legacy signal',
      description: 'No spec content attached',
    }

    const result = await ingestSignal(input, db as any)

    expect(db.save).toHaveBeenCalledOnce()
    const saveArgs = db.save.mock.calls[0] as unknown as [string, Record<string, unknown>]
    // specContent should be undefined (not present) — not an error
    expect(saveArgs[1].specContent).toBeUndefined()
  })
})


// ═══════════════════════════════════════════════════════════════════
// Test 2: specContent threads through pressure -> capability -> proposal
// ═══════════════════════════════════════════════════════════════════

describe('Semantic Grounding: specContent threading', () => {
  let db: ReturnType<typeof createMockDb>
  let env: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    db = createMockDb()
    env = createMockEnv()
    mockCallModel.mockClear()
  })

  it('synthesizePressure forwards specContent from signal to pressure (dry-run)', async () => {
    const signal = {
      _key: 'SIG-001',
      signalType: 'meta',
      title: 'Test signal',
      description: 'Test desc',
      evidence: [],
      specContent: '# Full specification content here',
    }

    const pressure = await synthesizePressure(signal, db as any, env, true)

    expect(pressure.specContent).toBe('# Full specification content here')
  })

  it('synthesizePressure forwards specContent from signal to pressure (live)', async () => {
    const signal = {
      _key: 'SIG-001',
      signalType: 'meta',
      title: 'Test signal',
      description: 'Test desc',
      evidence: [],
      specContent: '# Full specification content here',
    }

    const pressure = await synthesizePressure(signal, db as any, env, false)

    expect(pressure.specContent).toBe('# Full specification content here')
  })

  it('mapCapability forwards specContent from pressure to capability (dry-run)', async () => {
    const pressure = {
      _key: 'PRS-001',
      title: 'Test pressure',
      description: 'Test desc',
      category: 'infrastructure',
      specContent: '# Full specification content here',
    }

    const capability = await mapCapability(pressure, db as any, env, true)

    expect(capability.specContent).toBe('# Full specification content here')
  })

  it('mapCapability forwards specContent from pressure to capability (live)', async () => {
    const pressure = {
      _key: 'PRS-001',
      title: 'Test pressure',
      description: 'Test desc',
      category: 'infrastructure',
      specContent: '# Full specification content here',
    }

    const capability = await mapCapability(pressure, db as any, env, false)

    expect(capability.specContent).toBe('# Full specification content here')
  })

  it('proposeFunction forwards specContent from capability to proposal (dry-run)', async () => {
    const capability = {
      _key: 'BC-001',
      title: 'Test capability',
      description: 'Test desc',
      category: 'infrastructure',
      gapAnalysis: 'Test gap',
      specContent: '# Full specification content here',
    }

    const proposal = await proposeFunction(capability, db as any, env, true)

    expect(proposal.specContent).toBe('# Full specification content here')
  })

  it('proposeFunction forwards specContent from capability to proposal (live)', async () => {
    const capability = {
      _key: 'BC-001',
      title: 'Test capability',
      description: 'Test desc',
      category: 'infrastructure',
      gapAnalysis: 'Test gap',
      specContent: '# Full specification content here',
    }

    const proposal = await proposeFunction(capability, db as any, env, false)

    expect(proposal.specContent).toBe('# Full specification content here')
  })
})


// ═══════════════════════════════════════════════════════════════════
// Test 3: proposeFunction includes specContent in LLM prompt
// ═══════════════════════════════════════════════════════════════════

describe('Semantic Grounding: Stage 4 prompt enrichment', () => {
  let db: ReturnType<typeof createMockDb>
  let env: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    db = createMockDb()
    env = createMockEnv()
    mockCallModel.mockClear()
  })

  it('includes specContent in LLM user message when present', async () => {
    const specText = '# Phase 5 Hybrid Agent Sandbox\n\n## Requirements\n- Must support sandboxed execution\n- Must provide resource isolation'

    const capability = {
      _key: 'BC-001',
      title: 'Hybrid Agent Sandbox',
      description: 'System must support sandboxed agent execution',
      category: 'infrastructure',
      gapAnalysis: 'No sandbox exists',
      specContent: specText,
    }

    await proposeFunction(capability, db as any, env, false)

    // callModel receives (taskKind, system, user, env)
    expect(mockCallModel).toHaveBeenCalledOnce()
    const callArgs = mockCallModel.mock.calls[0] as unknown as [string, string, string, unknown]
    const userMessage = callArgs[2]

    // The user message should contain the spec content
    expect(userMessage).toContain('## Original Specification')
    expect(userMessage).toContain(specText)
  })

  it('does NOT include specContent section in LLM prompt when absent', async () => {
    const capability = {
      _key: 'BC-001',
      title: 'Legacy capability',
      description: 'No spec attached',
      category: 'infrastructure',
      gapAnalysis: 'Some gap',
    }

    await proposeFunction(capability, db as any, env, false)

    expect(mockCallModel).toHaveBeenCalledOnce()
    const callArgs = mockCallModel.mock.calls[0] as unknown as [string, string, string, unknown]
    const userMessage = callArgs[2]

    // Should NOT contain spec section
    expect(userMessage).not.toContain('## Original Specification')
  })
})


// ═══════════════════════════════════════════════════════════════════
// Test 3b: Stage 4 uses SPEC_GROUNDED_PROMPT for full decomposition
// ═══════════════════════════════════════════════════════════════════

describe('Semantic Grounding: Stage 4 full-spec decomposition', () => {
  let db: ReturnType<typeof createMockDb>
  let env: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    db = createMockDb()
    env = createMockEnv()
    mockCallModel.mockClear()
  })

  it('uses SPEC_GROUNDED_PROMPT (not generic SYSTEM_PROMPT) when specContent is present', async () => {
    const multiSectionSpec = [
      '# Phase 5 Hybrid Agent Sandbox',
      '',
      '## 1. Sandbox Lifecycle',
      'Requirements for sandbox creation and teardown.',
      '',
      '## 2. Resource Isolation',
      'Requirements for CPU/memory/network isolation.',
      '',
      '## 3. Agent Communication',
      'Requirements for inter-agent messaging.',
    ].join('\n')

    const capability = {
      _key: 'BC-001',
      title: 'Hybrid Agent Sandbox',
      description: 'Full sandbox architecture',
      category: 'infrastructure',
      gapAnalysis: 'No sandbox exists',
      specContent: multiSectionSpec,
    }

    await proposeFunction(capability, db as any, env, false)

    expect(mockCallModel).toHaveBeenCalledOnce()
    const callArgs = mockCallModel.mock.calls[0] as unknown as [string, string, string, unknown]
    const systemPrompt = callArgs[1]

    // The system prompt must instruct full decomposition, not single-Function proposal
    expect(systemPrompt).toContain('EVERY')
    expect(systemPrompt).toContain('section')
    // Must NOT be the generic "propose a Function" prompt
    expect(systemPrompt).not.toContain('propose a Function — a\nconcrete, implementable unit of work')
  })

  it('system prompt instructs covering all sections, not narrowing to one subsystem', async () => {
    const multiSectionSpec = [
      '## 1. Sandbox Lifecycle',
      'Create and destroy sandboxes.',
      '',
      '## 2. Resource Isolation',
      'CPU and memory limits.',
      '',
      '## 3. Agent Communication',
      'Message passing between agents.',
    ].join('\n')

    const capability = {
      _key: 'BC-001',
      title: 'Test capability',
      description: 'Test desc',
      category: 'infrastructure',
      gapAnalysis: 'Test gap',
      specContent: multiSectionSpec,
    }

    await proposeFunction(capability, db as any, env, false)

    const callArgs = mockCallModel.mock.calls[0] as unknown as [string, string, string, unknown]
    const systemPrompt = callArgs[1]

    // Must instruct: do NOT narrow to a single subsystem
    expect(systemPrompt).toContain('Do NOT narrow to a single subsystem')
    // Must instruct: decompose the COMPLETE specification
    expect(systemPrompt).toContain('COMPLETE specification')
    // Must instruct: dependencies should reflect spec ordering
    expect(systemPrompt).toContain('ordering')
  })

  it('user message includes instruction to cover all sections when specContent has multiple sections', async () => {
    const multiSectionSpec = [
      '## 1. Section Alpha',
      'Alpha details.',
      '',
      '## 2. Section Beta',
      'Beta details.',
      '',
      '## 3. Section Gamma',
      'Gamma details.',
    ].join('\n')

    const capability = {
      _key: 'BC-001',
      title: 'Multi-section capability',
      description: 'Covers alpha, beta, gamma',
      category: 'infrastructure',
      gapAnalysis: 'Test gap',
      specContent: multiSectionSpec,
    }

    await proposeFunction(capability, db as any, env, false)

    const callArgs = mockCallModel.mock.calls[0] as unknown as [string, string, string, unknown]
    const userMessage = callArgs[2]

    // User message must still contain the full spec content
    expect(userMessage).toContain('Section Alpha')
    expect(userMessage).toContain('Section Beta')
    expect(userMessage).toContain('Section Gamma')
  })

  it('uses original SYSTEM_PROMPT when specContent is absent (backwards compat)', async () => {
    const capability = {
      _key: 'BC-001',
      title: 'No spec capability',
      description: 'No spec attached',
      category: 'infrastructure',
      gapAnalysis: 'Test gap',
    }

    await proposeFunction(capability, db as any, env, false)

    const callArgs = mockCallModel.mock.calls[0] as unknown as [string, string, string, unknown]
    const systemPrompt = callArgs[1]

    // Original prompt should be used — contains the generic instruction
    expect(systemPrompt).toContain('propose a Function')
    // Must NOT contain spec-grounded instructions
    expect(systemPrompt).not.toContain('EVERY')
    expect(systemPrompt).not.toContain('Do NOT narrow')
  })

  it('uses original SYSTEM_PROMPT when specContent is empty string', async () => {
    const capability = {
      _key: 'BC-001',
      title: 'Empty spec capability',
      description: 'Empty spec',
      category: 'infrastructure',
      gapAnalysis: 'Test gap',
      specContent: '',
    }

    await proposeFunction(capability, db as any, env, false)

    const callArgs = mockCallModel.mock.calls[0] as unknown as [string, string, string, unknown]
    const systemPrompt = callArgs[1]

    // Empty specContent = treat as absent, use original prompt
    expect(systemPrompt).toContain('propose a Function')
    expect(systemPrompt).not.toContain('Do NOT narrow')
  })
})


// ═══════════════════════════════════════════════════════════════════
// Test 4: semanticReview uses specContent as ground truth
// ═══════════════════════════════════════════════════════════════════

describe('Semantic Grounding: Critic review with ground truth', () => {
  let db: ReturnType<typeof createMockDb>
  let env: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    db = createMockDb()
    env = createMockEnv()
    mockCallModel.mockClear()
  })

  it('includes specContent as ground truth in Critic prompt when present', async () => {
    const specText = '# Phase 5 Spec\n\nDetailed requirements for sandbox architecture'

    const proposal = {
      _key: 'FP-001',
      title: 'Sandbox Function',
      prd: {
        title: 'PRD: Sandbox',
        objective: 'Build sandbox',
        acceptanceCriteria: ['AC-1'],
        invariants: ['INV-1'],
        scope: { includes: ['in'], excludes: ['out'] },
      },
      sourceCapabilityId: 'BC-001',
      sourceRefs: ['BC:BC-001'],
      specContent: specText,
    }

    await semanticReview(proposal, db as any, env, false)

    expect(mockCallModel).toHaveBeenCalledOnce()

    // Check the system prompt was updated for ground truth review
    const callArgs = mockCallModel.mock.calls[0] as unknown as [string, string, string, unknown]
    const systemPrompt = callArgs[1]
    expect(systemPrompt).toContain('ORIGINAL SPECIFICATION')

    // Check the user message includes the spec content (inside JSON payload)
    const userMessage = callArgs[2]
    const parsed = JSON.parse(userMessage)
    expect(parsed.originalSpecification).toBe(specText)
  })

  it('uses standard Critic prompt when specContent is absent', async () => {
    const proposal = {
      _key: 'FP-001',
      title: 'Legacy Function',
      prd: {
        title: 'PRD: Legacy',
        objective: 'Build legacy',
        acceptanceCriteria: ['AC-1'],
        invariants: [],
        scope: { includes: ['in'], excludes: [] },
      },
      sourceCapabilityId: 'BC-001',
      sourceRefs: ['BC:BC-001'],
    }

    await semanticReview(proposal, db as any, env, false)

    expect(mockCallModel).toHaveBeenCalledOnce()

    // Standard prompt should NOT mention ORIGINAL SPECIFICATION
    const callArgs = mockCallModel.mock.calls[0] as unknown as [string, string, string, unknown]
    const systemPrompt = callArgs[1]
    expect(systemPrompt).not.toContain('ORIGINAL SPECIFICATION')
  })
})


// ═══════════════════════════════════════════════════════════════════
// Test 5: Backwards compatibility — all stages work without specContent
// ═══════════════════════════════════════════════════════════════════

describe('Semantic Grounding: Backwards compatibility', () => {
  let db: ReturnType<typeof createMockDb>
  let env: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    db = createMockDb()
    env = createMockEnv()
    mockCallModel.mockClear()
  })

  it('ingestSignal works without specContent', async () => {
    const input: SignalInput = {
      signalType: 'internal',
      source: 'test',
      title: 'No spec',
      description: 'Test without spec content',
    }

    // Should not throw
    const result = await ingestSignal(input, db as any)
    expect(result._key).toBeDefined()
  })

  it('synthesizePressure works without specContent on signal (dry-run)', async () => {
    const signal = {
      _key: 'SIG-001',
      signalType: 'internal',
      title: 'No spec',
      description: 'Test',
      evidence: [],
    }

    const pressure = await synthesizePressure(signal, db as any, env, true)
    expect(pressure._key).toBeDefined()
    expect(pressure.specContent).toBeUndefined()
  })

  it('synthesizePressure works without specContent on signal (live)', async () => {
    const signal = {
      _key: 'SIG-001',
      signalType: 'internal',
      title: 'No spec',
      description: 'Test',
      evidence: [],
    }

    const pressure = await synthesizePressure(signal, db as any, env, false)
    expect(pressure._key).toBeDefined()
    // specContent should not appear (undefined, not null)
    expect(pressure.specContent).toBeUndefined()
  })

  it('mapCapability works without specContent on pressure (dry-run)', async () => {
    const pressure = {
      _key: 'PRS-001',
      title: 'No spec',
      description: 'Test',
      category: 'test',
    }

    const capability = await mapCapability(pressure, db as any, env, true)
    expect(capability._key).toBeDefined()
    expect(capability.specContent).toBeUndefined()
  })

  it('mapCapability works without specContent on pressure (live)', async () => {
    const pressure = {
      _key: 'PRS-001',
      title: 'No spec',
      description: 'Test',
      category: 'test',
    }

    const capability = await mapCapability(pressure, db as any, env, false)
    expect(capability._key).toBeDefined()
    expect(capability.specContent).toBeUndefined()
  })

  it('proposeFunction works without specContent on capability (dry-run)', async () => {
    const capability = {
      _key: 'BC-001',
      title: 'No spec',
      description: 'Test',
      category: 'test',
      gapAnalysis: 'Test gap',
    }

    const proposal = await proposeFunction(capability, db as any, env, true)
    expect(proposal._key).toBeDefined()
    expect(proposal.specContent).toBeUndefined()
  })

  it('proposeFunction works without specContent on capability (live)', async () => {
    const capability = {
      _key: 'BC-001',
      title: 'No spec',
      description: 'Test',
      category: 'test',
      gapAnalysis: 'Test gap',
    }

    const proposal = await proposeFunction(capability, db as any, env, false)
    expect(proposal._key).toBeDefined()
    expect(proposal.specContent).toBeUndefined()
  })

  it('semanticReview works without specContent on proposal (dry-run)', async () => {
    const proposal = {
      _key: 'FP-001',
      title: 'No spec',
      prd: {
        title: 'PRD',
        objective: 'Test',
        acceptanceCriteria: ['AC-1'],
        invariants: [],
        scope: { includes: ['in'], excludes: [] },
      },
      sourceCapabilityId: 'BC-001',
      sourceRefs: ['BC:BC-001'],
    }

    const result = await semanticReview(proposal, db as any, env, true)
    expect(result.alignment).toBe('aligned')
  })

  it('semanticReview works without specContent on proposal (live)', async () => {
    const proposal = {
      _key: 'FP-001',
      title: 'No spec',
      prd: {
        title: 'PRD',
        objective: 'Test',
        acceptanceCriteria: ['AC-1'],
        invariants: [],
        scope: { includes: ['in'], excludes: [] },
      },
      sourceCapabilityId: 'BC-001',
      sourceRefs: ['BC:BC-001'],
    }

    const result = await semanticReview(proposal, db as any, env, false)
    expect(result.alignment).toBeDefined()
  })
})
