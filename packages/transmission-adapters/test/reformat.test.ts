/**
 * reformat() tests — TDD RED phase.
 *
 * Validates:
 * 1. Routes to correct substrate formatter
 * 2. Unknown substrate throws
 * 3. Returns estimatedTokens > 0
 */

import { describe, it, expect } from 'vitest'
import { reformat } from '../src/index'
import type { FactorySpecification, Substrate } from '../src/types'

const minimalSpec: FactorySpecification = {
  intent: 'Add health check endpoint that returns 200 OK',
}

describe('reformat', () => {
  it('routes to coding-agent substrate and returns a CommunicableSpecification', () => {
    const result = reformat(minimalSpec, 'coding-agent')

    expect(result).toHaveProperty('systemPrompt')
    expect(result).toHaveProperty('body')
    expect(result).toHaveProperty('estimatedTokens')
    expect(typeof result.systemPrompt).toBe('string')
    expect(typeof result.body).toBe('string')
    expect(typeof result.estimatedTokens).toBe('number')
  })

  it('throws on unknown substrate', () => {
    expect(() => reformat(minimalSpec, 'unknown-thing' as Substrate)).toThrow(
      'not yet implemented',
    )
  })

  it('throws on agents-md substrate (stub)', () => {
    expect(() => reformat(minimalSpec, 'agents-md')).toThrow('not yet implemented')
  })

  it('throws on claude-md substrate (stub)', () => {
    expect(() => reformat(minimalSpec, 'claude-md')).toThrow('not yet implemented')
  })

  it('throws on skill-md substrate (stub)', () => {
    expect(() => reformat(minimalSpec, 'skill-md')).toThrow('not yet implemented')
  })

  it('throws on a2a substrate (stub)', () => {
    expect(() => reformat(minimalSpec, 'a2a')).toThrow('not yet implemented')
  })

  it('returns estimatedTokens > 0 for any non-trivial spec', () => {
    const result = reformat(minimalSpec, 'coding-agent')
    expect(result.estimatedTokens).toBeGreaterThan(0)
  })
})
