/**
 * ADR-007 Phase 1: Output Reliability Layer tests
 *
 * Tests the unified processAgentOutput pipeline:
 *   Guard -> Parse -> Detect Tool Calls -> Validate -> Coerce -> Repair
 *
 * Covers failure classes F1-F7 from the ADR.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  processAgentOutput,
  extractJSON,
  BRIEFING_SCRIPT_SCHEMA,
  PLAN_SCHEMA,
  CODE_ARTIFACT_SCHEMA,
  SEMANTIC_REVIEW_SCHEMA,
  CRITIQUE_REPORT_SCHEMA,
  TEST_REPORT_SCHEMA,
  VERDICT_SCHEMA,
  type ORLResult,
  type OutputSchema,
} from './output-reliability'

// ── Parse Tests ────────────────────────────────────────────────

describe('extractJSON', () => {
  it('tier 1: parses valid JSON directly', () => {
    const result = extractJSON('{"goal":"test"}')
    expect(result).toEqual({ json: { goal: 'test' }, tier: 1 })
  })

  it('tier 2: extracts JSON from markdown fences (F5)', () => {
    const input = '```json\n{"goal":"test"}\n```'
    const result = extractJSON(input)
    expect(result).toEqual({ json: { goal: 'test' }, tier: 2 })
  })

  it('tier 2: extracts JSON from bare fences', () => {
    const input = '```\n{"goal":"test"}\n```'
    const result = extractJSON(input)
    expect(result).toEqual({ json: { goal: 'test' }, tier: 2 })
  })

  it('tier 3: extracts JSON mixed with prose (F1) via brace extraction', () => {
    const input = 'Here is my response:\n{"goal":"test","items":[1,2]}\nHope this helps!'
    const result = extractJSON(input)
    expect(result).toEqual({ json: { goal: 'test', items: [1, 2] }, tier: 3 })
  })

  it('tier 4: extracts array JSON', () => {
    const input = 'Result: [{"id":1},{"id":2}]'
    const result = extractJSON(input)
    expect(result).toEqual({ json: [{ id: 1 }, { id: 2 }], tier: 4 })
  })

  it('recovers truncated JSON via Tier 5 (close open braces)', () => {
    const input = '{"goal":"test","items":[1,2'
    const result = extractJSON(input)
    expect(result).not.toBeNull()
    expect(result!.tier).toBe(5)
    expect((result!.json as any).goal).toBe('test')
  })

  it('returns null for pure prose with no JSON', () => {
    const result = extractJSON('This is just text with no JSON at all.')
    expect(result).toBeNull()
  })

  it('returns null for empty string', () => {
    const result = extractJSON('')
    expect(result).toBeNull()
  })
})

// ── processAgentOutput: Guard Stage ────────────────────────────

describe('processAgentOutput — Guard (F7)', () => {
  const schema: OutputSchema<{ goal: string }> = {
    name: 'TestSchema',
    requiredFields: ['goal'],
    fieldTypes: { goal: 'string' },
  }

  it('returns F7 failure for null response', async () => {
    const result = await processAgentOutput(null as unknown as string, schema)
    expect(result.success).toBe(false)
    expect(result.failureMode).toBe('F7')
    expect(result.data).toBeNull()
  })

  it('returns F7 failure for undefined response', async () => {
    const result = await processAgentOutput(undefined as unknown as string, schema)
    expect(result.success).toBe(false)
    expect(result.failureMode).toBe('F7')
  })

  it('returns F7 failure for empty string response', async () => {
    const result = await processAgentOutput('', schema)
    expect(result.success).toBe(false)
    expect(result.failureMode).toBe('F7')
  })

  it('returns F7 failure for whitespace-only response', async () => {
    const result = await processAgentOutput('   \n  \t  ', schema)
    expect(result.success).toBe(false)
    expect(result.failureMode).toBe('F7')
  })

  it('attempts repair for F7 when repairFn is provided', async () => {
    const repairFn = vi.fn().mockResolvedValue('{"goal":"repaired"}')
    const result = await processAgentOutput('', schema, { repairFn })
    expect(result.success).toBe(true)
    expect(result.data).toEqual({ goal: 'repaired' })
    expect(result.repairAttempts).toBe(1)
    expect(repairFn).toHaveBeenCalledTimes(1)
  })
})

// ── processAgentOutput: Parse Stage ────────────────────────────

describe('processAgentOutput — Parse', () => {
  const schema: OutputSchema<{ goal: string }> = {
    name: 'TestSchema',
    requiredFields: ['goal'],
    fieldTypes: { goal: 'string' },
  }

  it('valid JSON -> success, no coercions', async () => {
    const result = await processAgentOutput('{"goal":"test"}', schema)
    expect(result.success).toBe(true)
    expect(result.data).toEqual({ goal: 'test' })
    expect(result.coercions).toEqual([])
    expect(result.repairAttempts).toBe(0)
  })

  it('JSON in markdown fences (F5) -> success', async () => {
    const result = await processAgentOutput('```json\n{"goal":"test"}\n```', schema)
    expect(result.success).toBe(true)
    expect(result.data).toEqual({ goal: 'test' })
  })

  it('JSON mixed with prose (F1) -> success via brace extraction', async () => {
    const input = 'Here is the briefing:\n{"goal":"test"}\nEnd of response.'
    const result = await processAgentOutput(input, schema)
    expect(result.success).toBe(true)
    expect(result.data).toEqual({ goal: 'test' })
  })

  it('truncated JSON (F2) -> recovered via Tier 5', async () => {
    const result = await processAgentOutput('{"goal":"test","successCriteria":["a"],"architecturalContext":"ctx","strategicAdvice":"adv","knownGotchas":["g"],"validationLoop":"val', schema)
    expect(result.success).toBe(true)
    expect((result.data as any).goal).toBe('test')
  })

  it('pure prose (F1 total) -> failure when no JSON found', async () => {
    const result = await processAgentOutput('I cannot produce JSON right now.', schema)
    expect(result.success).toBe(false)
    expect(result.failureMode).toBe('F1')
  })
})

// ── processAgentOutput: Tool Call Detection ────────────────────

describe('processAgentOutput — Tool Call Detection (F6)', () => {
  const schema: OutputSchema<{ goal: string }> = {
    name: 'TestSchema',
    requiredFields: ['goal'],
    fieldTypes: { goal: 'string' },
  }

  it('detects text tool calls when availableTools provided', async () => {
    const input = '{"name":"arango_query","arguments":{"query":"FOR d IN docs RETURN d"}}'
    const result = await processAgentOutput(input, schema, {
      availableTools: ['arango_query'],
    })
    expect(result.success).toBe(true)
    expect(result.failureMode).toBe('F6')
    expect(result.data).not.toBeNull()
    // The data should contain tool call info
    const data = result.data as any
    expect(data.toolCalls).toBeDefined()
    expect(data.toolCalls[0].name).toBe('arango_query')
  })

  it('does not detect tool calls when no availableTools', async () => {
    const input = '{"name":"arango_query","arguments":{"query":"test"}}'
    const result = await processAgentOutput(input, schema)
    // Without availableTools, this is just a failed validation (missing 'goal')
    expect(result.failureMode).not.toBe('F6')
  })
})

// ── processAgentOutput: Coercion Tests ─────────────────────────

describe('processAgentOutput — Coercion', () => {
  it('coerces string field from array -> joined string', async () => {
    const schema: OutputSchema<{ goal: string }> = {
      name: 'Test',
      requiredFields: ['goal'],
      fieldTypes: { goal: 'string' },
    }
    const result = await processAgentOutput('{"goal":["line1","line2"]}', schema)
    expect(result.success).toBe(true)
    expect(result.data!.goal).toBe('line1. line2')
    expect(result.coercions).toContain('goal')
  })

  it('coerces array field from string -> split array', async () => {
    const schema: OutputSchema<{ items: string[] }> = {
      name: 'Test',
      requiredFields: ['items'],
      fieldTypes: { items: 'array' },
    }
    const result = await processAgentOutput('{"items":"a, b, c"}', schema)
    expect(result.success).toBe(true)
    expect(result.data!.items).toEqual(['a', 'b', 'c'])
    expect(result.coercions).toContain('items')
  })

  it('coerces number field from string -> number', async () => {
    const schema: OutputSchema<{ count: number }> = {
      name: 'Test',
      requiredFields: ['count'],
      fieldTypes: { count: 'number' },
    }
    const result = await processAgentOutput('{"count":"42"}', schema)
    expect(result.success).toBe(true)
    expect(result.data!.count).toBe(42)
    expect(result.coercions).toContain('count')
  })

  it('coerces boolean field from string -> boolean', async () => {
    const schema: OutputSchema<{ active: boolean }> = {
      name: 'Test',
      requiredFields: ['active'],
      fieldTypes: { active: 'boolean' },
    }
    const result = await processAgentOutput('{"active":"true"}', schema)
    expect(result.success).toBe(true)
    expect(result.data!.active).toBe(true)
    expect(result.coercions).toContain('active')
  })

  it('maps aliased field names', async () => {
    const schema: OutputSchema<{ title: string }> = {
      name: 'Test',
      requiredFields: ['title'],
      fieldTypes: { title: 'string' },
      fieldAliases: { title: ['name', 'function_name'] },
    }
    const result = await processAgentOutput('{"name":"hello"}', schema)
    expect(result.success).toBe(true)
    expect(result.data!.title).toBe('hello')
  })

  it('does not coerce when coerce is disabled', async () => {
    const schema: OutputSchema<{ goal: string }> = {
      name: 'Test',
      requiredFields: ['goal'],
      fieldTypes: { goal: 'string' },
      coerce: false,
    }
    // Array where string expected — should fail validation, not coerce
    const result = await processAgentOutput('{"goal":["line1","line2"]}', schema)
    expect(result.success).toBe(false)
    expect(result.coercions).toEqual([])
  })
})

// ── processAgentOutput: Schema Validation Tests ────────────────

describe('processAgentOutput — Schema Validation', () => {
  const schema: OutputSchema<{ goal: string; items: string[] }> = {
    name: 'Test',
    requiredFields: ['goal', 'items'],
    fieldTypes: { goal: 'string', items: 'array' },
  }

  it('all required fields present -> valid', async () => {
    const result = await processAgentOutput('{"goal":"test","items":["a"]}', schema)
    expect(result.success).toBe(true)
  })

  it('missing required field -> invalid', async () => {
    const result = await processAgentOutput('{"goal":"test"}', schema)
    expect(result.success).toBe(false)
    expect(result.failureMode).toContain('F3')
  })

  it('enum field with invalid value -> coerced to default', async () => {
    const schema: OutputSchema<{ decision: string }> = {
      name: 'Test',
      requiredFields: ['decision'],
      fieldTypes: { decision: 'string' },
      enumFields: { decision: ['pass', 'fail', 'patch'] },
      defaults: { decision: 'fail' },
    }
    const result = await processAgentOutput('{"decision":"invalid_value"}', schema)
    expect(result.success).toBe(true)
    expect(result.data!.decision).toBe('fail')
  })

  it('extra fields are preserved (not rejected)', async () => {
    const result = await processAgentOutput('{"goal":"test","items":["a"],"extra":"field"}', schema)
    expect(result.success).toBe(true)
    expect((result.data as any).extra).toBe('field')
  })
})

// ── processAgentOutput: Repair Tests ───────────────────────────

describe('processAgentOutput — Repair', () => {
  const schema: OutputSchema<{ goal: string }> = {
    name: 'Test',
    requiredFields: ['goal'],
    fieldTypes: { goal: 'string' },
  }

  it('first attempt invalid, repairFn returns valid -> success with repairAttempts: 1', async () => {
    const repairFn = vi.fn().mockResolvedValueOnce('{"goal":"fixed"}')
    const result = await processAgentOutput('not json at all', schema, {
      repairFn,
      maxRepairAttempts: 2,
    })
    expect(result.success).toBe(true)
    expect(result.data).toEqual({ goal: 'fixed' })
    expect(result.repairAttempts).toBe(1)
    expect(repairFn).toHaveBeenCalledTimes(1)
  })

  it('both repair attempts invalid -> failure with repairAttempts: 2', async () => {
    const repairFn = vi.fn()
      .mockResolvedValueOnce('still not json')
      .mockResolvedValueOnce('nope still broken')
    const result = await processAgentOutput('not json at all', schema, {
      repairFn,
      maxRepairAttempts: 2,
    })
    expect(result.success).toBe(false)
    expect(result.repairAttempts).toBe(2)
    expect(repairFn).toHaveBeenCalledTimes(2)
  })

  it('repair respects maxRepairAttempts limit', async () => {
    const repairFn = vi.fn().mockResolvedValue('invalid')
    const result = await processAgentOutput('not json', schema, {
      repairFn,
      maxRepairAttempts: 1,
    })
    expect(result.repairAttempts).toBe(1)
    expect(repairFn).toHaveBeenCalledTimes(1)
  })

  it('does not attempt repair when no repairFn provided', async () => {
    const result = await processAgentOutput('not json at all', schema)
    expect(result.success).toBe(false)
    expect(result.repairAttempts).toBe(0)
  })

  it('repair receives error description and schema name', async () => {
    const repairFn = vi.fn().mockResolvedValue('{"goal":"fixed"}')
    await processAgentOutput('not json', schema, { repairFn })
    expect(repairFn).toHaveBeenCalledWith(
      expect.stringContaining('Test'),  // schema name in error
      expect.stringContaining('Test'),  // schema name in schema description
    )
  })
})

// ── Integration: Agent Schema Tests ────────────────────────────

describe('processAgentOutput — BRIEFING_SCRIPT_SCHEMA', () => {
  it('accepts valid BriefingScript data', async () => {
    const valid = {
      goal: 'Implement auth module',
      successCriteria: ['Tests pass', 'Auth works'],
      architecturalContext: 'Uses JWT per DECISIONS.md',
      strategicAdvice: 'Start with middleware',
      knownGotchas: ['Token expiry edge case'],
      validationLoop: 'Run pnpm test',
    }
    const result = await processAgentOutput(JSON.stringify(valid), BRIEFING_SCRIPT_SCHEMA)
    expect(result.success).toBe(true)
    expect(result.data).toEqual(valid)
  })

  it('coerces wrong types in BriefingScript', async () => {
    const mistyped = {
      goal: 123,  // number instead of string
      successCriteria: 'single criterion',  // string instead of array
      architecturalContext: ['line1', 'line2'],  // array instead of string
      strategicAdvice: 'ok',
      knownGotchas: 'gotcha1, gotcha2',  // string instead of array
      validationLoop: 'ok',
    }
    const result = await processAgentOutput(JSON.stringify(mistyped), BRIEFING_SCRIPT_SCHEMA)
    expect(result.success).toBe(true)
    expect(typeof result.data!.goal).toBe('string')
    expect(Array.isArray(result.data!.successCriteria)).toBe(true)
    expect(typeof result.data!.architecturalContext).toBe('string')
    expect(Array.isArray(result.data!.knownGotchas)).toBe(true)
  })
})

describe('processAgentOutput — VERDICT_SCHEMA', () => {
  it('accepts valid Verdict data', async () => {
    const valid = {
      decision: 'pass',
      confidence: 0.95,
      reason: 'All checks passed',
    }
    const result = await processAgentOutput(JSON.stringify(valid), VERDICT_SCHEMA)
    expect(result.success).toBe(true)
    expect(result.data).toEqual(valid)
  })

  it('coerces invalid decision to default and clamps confidence', async () => {
    const invalid = {
      decision: 'approve',  // not in enum
      confidence: 1.5,  // out of range
      reason: 'ok',
    }
    const result = await processAgentOutput(JSON.stringify(invalid), VERDICT_SCHEMA)
    expect(result.success).toBe(true)
    expect(result.data!.decision).toBe('interrupt')  // default for invalid enum
    expect(result.data!.confidence).toBe(0.5)  // clamped
  })
})

describe('processAgentOutput — PLAN_SCHEMA', () => {
  it('accepts valid Plan data', async () => {
    const valid = {
      approach: 'Implement in order',
      atoms: [{ id: 'a1', description: 'Do thing', assignedTo: 'coder' }],
      executorRecommendation: 'gdk-agent',
      estimatedComplexity: 'low',
    }
    const result = await processAgentOutput(JSON.stringify(valid), PLAN_SCHEMA)
    expect(result.success).toBe(true)
    expect(result.data).toEqual(valid)
  })

  it('applies defaults for missing optional-ish fields', async () => {
    const minimal = {
      approach: 'Do it',
      atoms: [],
      executorRecommendation: '',
      estimatedComplexity: '',
    }
    const result = await processAgentOutput(JSON.stringify(minimal), PLAN_SCHEMA)
    expect(result.success).toBe(true)
    // Empty strings should get defaults applied
    expect(result.data!.executorRecommendation).toBe('gdk-agent')
    expect(result.data!.estimatedComplexity).toBe('medium')
  })
})

describe('processAgentOutput — CODE_ARTIFACT_SCHEMA', () => {
  it('accepts valid CodeArtifact data', async () => {
    const valid = {
      files: [{ path: 'src/index.ts', content: 'console.log("hi")', action: 'create' }],
      summary: 'Added index',
      testsIncluded: true,
    }
    const result = await processAgentOutput(JSON.stringify(valid), CODE_ARTIFACT_SCHEMA)
    expect(result.success).toBe(true)
    expect(result.data).toEqual(valid)
  })

  it('coerces action aliases (add -> create, update -> modify)', async () => {
    const aliased = {
      files: [{ path: 'src/index.ts', content: 'hi', action: 'add' }],
      summary: 'Added index',
      testsIncluded: false,
    }
    const result = await processAgentOutput(JSON.stringify(aliased), CODE_ARTIFACT_SCHEMA)
    expect(result.success).toBe(true)
    expect(result.data!.files[0].action).toBe('create')
  })
})

describe('processAgentOutput — TEST_REPORT_SCHEMA', () => {
  it('accepts valid TestReport data', async () => {
    const valid = {
      passed: true,
      testsRun: 10,
      testsPassed: 10,
      testsFailed: 0,
      failures: [],
      summary: 'All pass',
    }
    const result = await processAgentOutput(JSON.stringify(valid), TEST_REPORT_SCHEMA)
    expect(result.success).toBe(true)
    expect(result.data).toEqual(valid)
  })
})

describe('processAgentOutput — SEMANTIC_REVIEW_SCHEMA', () => {
  it('accepts valid SemanticReview data', async () => {
    const valid = {
      alignment: 'aligned',
      confidence: 0.9,
      citations: ['spec-1'],
      rationale: 'Matches spec',
      timestamp: '2026-04-27T00:00:00Z',
    }
    const result = await processAgentOutput(JSON.stringify(valid), SEMANTIC_REVIEW_SCHEMA)
    expect(result.success).toBe(true)
    expect(result.data).toEqual(valid)
  })
})

describe('processAgentOutput — CRITIQUE_REPORT_SCHEMA', () => {
  it('accepts valid CritiqueReport data', async () => {
    const valid = {
      passed: true,
      issues: [],
      mentorRuleCompliance: [],
      overallAssessment: 'Clean',
    }
    const result = await processAgentOutput(JSON.stringify(valid), CRITIQUE_REPORT_SCHEMA)
    expect(result.success).toBe(true)
    expect(result.data).toEqual(valid)
  })
})

// ── processAgentOutput: rawResponse tracking ───────────────────

describe('processAgentOutput — rawResponse tracking', () => {
  it('always includes the rawResponse in the result', async () => {
    const schema: OutputSchema<{ goal: string }> = {
      name: 'Test',
      requiredFields: ['goal'],
      fieldTypes: { goal: 'string' },
    }
    const raw = '{"goal":"test"}'
    const result = await processAgentOutput(raw, schema)
    expect(result.rawResponse).toBe(raw)
  })
})
