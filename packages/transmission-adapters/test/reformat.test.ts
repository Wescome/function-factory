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
import type { FactorySpecification, Substrate, AgentsMdInput } from '../src/types'

const minimalSpec: FactorySpecification = {
  intent: 'Add health check endpoint that returns 200 OK',
}

const agentsMdInput: AgentsMdInput = {
  projectName: 'Test Project',
  projectDescription: 'A test project.',
  buildCommands: {
    install: 'pnpm install',
    build: 'pnpm -r build',
    test: 'pnpm -r test',
    typecheck: 'pnpm -r typecheck',
  },
  conventions: {
    language: 'TypeScript',
    monorepo: 'pnpm workspaces',
    commitFormat: 'type: description',
  },
  artifactPrefixes: {
    'FEAT-*': 'Features',
  },
}

describe('reformat', () => {
  it('throws on coding-agent substrate with bypass message', () => {
    expect(() => reformat(minimalSpec, 'coding-agent')).toThrow(
      'coding-agent substrate is bypass',
    )
  })

  it('throws on unknown substrate', () => {
    expect(() => reformat(minimalSpec, 'unknown-thing' as Substrate)).toThrow(
      'not yet implemented',
    )
  })

  it('routes to agents-md substrate and returns a CommunicableSpecification', () => {
    const result = reformat(agentsMdInput, 'agents-md')

    expect(result).toHaveProperty('systemPrompt')
    expect(result).toHaveProperty('body')
    expect(result).toHaveProperty('estimatedTokens')
    expect(typeof result.systemPrompt).toBe('string')
    expect(typeof result.body).toBe('string')
    expect(typeof result.estimatedTokens).toBe('number')
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

  it('returns estimatedTokens > 0 for agents-md substrate', () => {
    const result = reformat(agentsMdInput, 'agents-md')
    expect(result.estimatedTokens).toBeGreaterThan(0)
  })
})
