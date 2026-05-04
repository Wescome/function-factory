/**
 * coding-agent substrate tests.
 *
 * The coding-agent substrate is BYPASSED in reformat() — the CoderAgent
 * uses its own prompt path directly. This test validates:
 * 1. reformat() throws with a clear bypass message
 * 2. formatForCodingAgent() still works as a standalone function
 *    (it exists in the codebase, just not routed through reformat)
 */

import { describe, it, expect } from 'vitest'
import { reformat } from '../src/index'
import { formatForCodingAgent } from '../src/substrates/coding-agent'
import type { FactorySpecification } from '../src/types'

const minimalSpec: FactorySpecification = {
  intent: 'Add health check endpoint that returns 200 OK',
}

const fullSpec: FactorySpecification = {
  intent: 'Add user authentication endpoint that validates credentials and returns a JWT token',
  approach: 'Create auth route handler using existing middleware pattern.',
  targetFiles: ['src/routes/auth.ts'],
  constraints: ['All endpoints must validate input with Zod schemas'],
  context: {
    fileContents: [
      {
        path: 'src/routes/health.ts',
        exports: ['healthHandler'],
        functions: ['healthHandler(req: Request)'],
        content: 'export function healthHandler() { return new Response("ok") }',
      },
    ],
    decisions: ['Use Hono framework for all HTTP routes'],
    lessons: ['Always validate request body before processing'],
    mentorRules: ['Prefer composition over inheritance'],
  },
}

describe('coding-agent substrate bypass', () => {
  it('reformat() throws with bypass message for coding-agent substrate', () => {
    expect(() => reformat(minimalSpec, 'coding-agent')).toThrow(
      'coding-agent substrate is bypass',
    )
  })

  it('bypass message includes guidance to use CoderAgent prompt path', () => {
    expect(() => reformat(minimalSpec, 'coding-agent')).toThrow(
      'use the working CoderAgent prompt path directly',
    )
  })

  it('bypass message clarifies adapter is for external substrates only', () => {
    expect(() => reformat(minimalSpec, 'coding-agent')).toThrow(
      'The adapter is for external substrates only',
    )
  })
})

describe('formatForCodingAgent (standalone)', () => {
  it('still produces a valid CommunicableSpecification', () => {
    const result = formatForCodingAgent(minimalSpec)

    expect(result).toHaveProperty('systemPrompt')
    expect(result).toHaveProperty('body')
    expect(result).toHaveProperty('estimatedTokens')
    expect(result.body).toContain('## Task')
  })

  it('includes all sections from a full spec', () => {
    const result = formatForCodingAgent(fullSpec)

    expect(result.body).toContain('## Task')
    expect(result.body).toContain('## Approach')
    expect(result.body).toContain('## Files to Modify')
    expect(result.body).toContain('## Constraints')
    expect(result.body).toContain('## Context')
  })

  it('does not contain Factory vocabulary', () => {
    const result = formatForCodingAgent(fullSpec)

    expect(result.body).not.toMatch(/\bWorkGraph\b/)
    expect(result.body).not.toMatch(/\bCodeArtifact\b/)
    expect(result.body).not.toMatch(/\bRequirementAtom\b/)
    expect(result.body).not.toMatch(/\batom\b/i)
    expect(result.systemPrompt).not.toMatch(/\bWorkGraph\b/)
    expect(result.systemPrompt).not.toMatch(/\batom\b/i)
  })
})
