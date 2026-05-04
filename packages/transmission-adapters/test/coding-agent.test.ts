/**
 * coding-agent substrate tests — TDD RED phase.
 *
 * Validates:
 * 1. Produces ## Task section from spec.intent
 * 2. Produces ## Files to Modify with code blocks
 * 3. Produces ## Constraints from spec.constraints
 * 4. Includes repair notes when spec.repair is present
 * 5. NO Factory vocabulary in output (no "atom", "WorkGraph", "Plan", "CodeArtifact", "invariant")
 * 6. System prompt says "TypeScript developer" not "CodeProducer"
 * 7. System prompt includes CodeArtifact JSON output format
 * 8. Includes ## Approach section from spec.approach
 * 9. Includes ## Context section from spec.context
 * 10. Handles minimal spec (intent only)
 */

import { describe, it, expect } from 'vitest'
import { reformat } from '../src/index'
import type { FactorySpecification } from '../src/types'

// ── Fixtures ──

const fullSpec: FactorySpecification = {
  intent: 'Add user authentication endpoint that validates credentials and returns a JWT token',
  approach: 'Create auth route handler using existing middleware pattern. Add rate-limit middleware wrapping the login handler.',
  targetFiles: ['src/routes/auth.ts', 'src/middleware/rate-limit.ts'],
  constraints: [
    'All endpoints must validate input with Zod schemas',
    'No secrets in source code',
    'Rate-limit login attempts to 5 per minute',
  ],
  context: {
    fileContents: [
      {
        path: 'src/routes/health.ts',
        exports: ['healthHandler'],
        functions: ['healthHandler(req: Request)'],
        content: `export function healthHandler(req: Request): Response {
  return new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
}`,
      },
    ],
    decisions: ['Use Hono framework for all HTTP routes'],
    lessons: ['Always validate request body before processing'],
    mentorRules: ['Prefer composition over inheritance'],
  },
}

const repairSpec: FactorySpecification = {
  ...fullSpec,
  repair: {
    notes: 'Previous implementation missed rate limiting on the login handler.',
    previousFiles: ['src/routes/auth.ts'],
    issues: [
      'No rate limiting applied to login endpoint',
      'Missing JSDoc on exported handler',
    ],
  },
}

const minimalSpec: FactorySpecification = {
  intent: 'Add health check endpoint that returns 200 OK',
}

// ── Tests ──

describe('coding-agent substrate', () => {
  describe('body sections', () => {
    it('produces ## Task section from spec.intent', () => {
      const result = reformat(fullSpec, 'coding-agent')

      expect(result.body).toContain('## Task')
      expect(result.body).toContain('Add user authentication endpoint')
    })

    it('produces ## Approach section from spec.approach', () => {
      const result = reformat(fullSpec, 'coding-agent')

      expect(result.body).toContain('## Approach')
      expect(result.body).toContain('Create auth route handler using existing middleware pattern')
    })

    it('produces ## Files to Modify with file paths', () => {
      const result = reformat(fullSpec, 'coding-agent')

      expect(result.body).toContain('## Files to Modify')
      expect(result.body).toContain('src/routes/auth.ts')
      expect(result.body).toContain('src/middleware/rate-limit.ts')
    })

    it('includes file content in code blocks with language tags', () => {
      const result = reformat(fullSpec, 'coding-agent')

      expect(result.body).toContain('src/routes/health.ts')
      expect(result.body).toMatch(/```typescript/)
      expect(result.body).toContain('healthHandler')
    })

    it('includes exports and functions for file contexts', () => {
      const result = reformat(fullSpec, 'coding-agent')

      expect(result.body).toContain('Exports: healthHandler')
      expect(result.body).toContain('Functions: healthHandler(req: Request)')
    })

    it('produces ## Constraints from spec.constraints', () => {
      const result = reformat(fullSpec, 'coding-agent')

      expect(result.body).toContain('## Constraints')
      expect(result.body).toContain('All endpoints must validate input with Zod schemas')
      expect(result.body).toContain('No secrets in source code')
      expect(result.body).toContain('Rate-limit login attempts to 5 per minute')
    })

    it('produces ## Context with decisions, lessons, and mentor rules', () => {
      const result = reformat(fullSpec, 'coding-agent')

      expect(result.body).toContain('## Context')
      expect(result.body).toContain('Use Hono framework for all HTTP routes')
      expect(result.body).toContain('Always validate request body before processing')
      expect(result.body).toContain('Prefer composition over inheritance')
    })
  })

  describe('repair cycle', () => {
    it('includes ## Repair Notes when spec.repair is present', () => {
      const result = reformat(repairSpec, 'coding-agent')

      expect(result.body).toContain('## Repair Notes')
      expect(result.body).toContain('Previous implementation missed rate limiting')
    })

    it('lists repair issues', () => {
      const result = reformat(repairSpec, 'coding-agent')

      expect(result.body).toContain('No rate limiting applied to login endpoint')
      expect(result.body).toContain('Missing JSDoc on exported handler')
    })

    it('lists previous files that need fixes', () => {
      const result = reformat(repairSpec, 'coding-agent')

      expect(result.body).toContain('src/routes/auth.ts')
    })

    it('omits ## Repair Notes when not in repair cycle', () => {
      const result = reformat(fullSpec, 'coding-agent')

      expect(result.body).not.toContain('## Repair Notes')
    })
  })

  describe('minimal spec handling', () => {
    it('handles minimal spec with only intent', () => {
      const result = reformat(minimalSpec, 'coding-agent')

      expect(result.body).toContain('## Task')
      expect(result.body).toContain('Add health check endpoint')
      expect(result.systemPrompt.length).toBeGreaterThan(0)
    })

    it('omits ## Approach when spec.approach is undefined', () => {
      const result = reformat(minimalSpec, 'coding-agent')

      expect(result.body).not.toContain('## Approach')
    })

    it('omits ## Files to Modify when spec.targetFiles is undefined', () => {
      const result = reformat(minimalSpec, 'coding-agent')

      expect(result.body).not.toContain('## Files to Modify')
    })

    it('omits ## Constraints when spec.constraints is undefined', () => {
      const result = reformat(minimalSpec, 'coding-agent')

      expect(result.body).not.toContain('## Constraints')
    })

    it('omits ## Context when spec.context is undefined', () => {
      const result = reformat(minimalSpec, 'coding-agent')

      expect(result.body).not.toContain('## Context')
    })
  })

  describe('anti-corruption: no Factory vocabulary in output', () => {
    it('body does not contain Factory-internal terms', () => {
      const result = reformat(fullSpec, 'coding-agent')

      expect(result.body).not.toMatch(/\bWorkGraph\b/)
      expect(result.body).not.toMatch(/\bCodeArtifact\b/)
      expect(result.body).not.toMatch(/\bRequirementAtom\b/)
      expect(result.body).not.toMatch(/\bPipelineWorkGraph\b/)
      expect(result.body).not.toMatch(/\bGraphState\b/)
      expect(result.body).not.toMatch(/\bCoderInput\b/)
      expect(result.body).not.toMatch(/\bCoderAgent\b/)
      // "atom" as a standalone word (not inside another word like "atomic")
      expect(result.body).not.toMatch(/\batom\b/i)
      // "invariant" as Factory jargon
      expect(result.body).not.toMatch(/\binvariant\b/i)
    })

    it('repair output does not contain Factory-internal terms', () => {
      const result = reformat(repairSpec, 'coding-agent')

      expect(result.body).not.toMatch(/\bWorkGraph\b/)
      expect(result.body).not.toMatch(/\bCodeArtifact\b/)
      expect(result.body).not.toMatch(/\bRequirementAtom\b/)
      expect(result.body).not.toMatch(/\batom\b/i)
      expect(result.body).not.toMatch(/\binvariant\b/i)
    })
  })

  describe('system prompt', () => {
    it('says "TypeScript developer" not "CodeProducer"', () => {
      const result = reformat(fullSpec, 'coding-agent')

      expect(result.systemPrompt).toContain('TypeScript developer')
      expect(result.systemPrompt).not.toContain('CodeProducer')
    })

    it('does not contain Factory vocabulary', () => {
      const result = reformat(fullSpec, 'coding-agent')

      expect(result.systemPrompt).not.toMatch(/\bWorkGraph\b/)
      expect(result.systemPrompt).not.toMatch(/\bRequirementAtom\b/)
      expect(result.systemPrompt).not.toMatch(/\bPipelineWorkGraph\b/)
      expect(result.systemPrompt).not.toMatch(/\bGraphState\b/)
      expect(result.systemPrompt).not.toMatch(/\bFunction Factory\b/)
      expect(result.systemPrompt).not.toMatch(/\batom\b/i)
      expect(result.systemPrompt).not.toMatch(/\binvariant\b/i)
    })

    it('includes JSON output format specification', () => {
      const result = reformat(fullSpec, 'coding-agent')

      // Must describe the expected JSON output shape
      expect(result.systemPrompt).toContain('"files"')
      expect(result.systemPrompt).toContain('"summary"')
      expect(result.systemPrompt).toContain('"testsIncluded"')
      expect(result.systemPrompt).toContain('"action"')
      expect(result.systemPrompt).toContain('"path"')
    })

    it('describes create/modify/delete actions', () => {
      const result = reformat(fullSpec, 'coding-agent')

      expect(result.systemPrompt).toContain('create')
      expect(result.systemPrompt).toContain('modify')
      expect(result.systemPrompt).toContain('delete')
    })

    it('describes search/replace edits for existing files', () => {
      const result = reformat(fullSpec, 'coding-agent')

      expect(result.systemPrompt).toContain('search')
      expect(result.systemPrompt).toContain('replace')
    })
  })

  describe('token estimation', () => {
    it('returns estimatedTokens > 0', () => {
      const result = reformat(fullSpec, 'coding-agent')
      expect(result.estimatedTokens).toBeGreaterThan(0)
    })

    it('token estimate is roughly proportional to content length', () => {
      const result = reformat(fullSpec, 'coding-agent')
      const totalChars = result.systemPrompt.length + result.body.length
      const expectedApprox = Math.ceil(totalChars / 4)
      // Allow 20% variance
      expect(result.estimatedTokens).toBeGreaterThan(expectedApprox * 0.8)
      expect(result.estimatedTokens).toBeLessThan(expectedApprox * 1.2)
    })
  })

  describe('file content truncation', () => {
    it('truncates file content longer than 2000 characters', () => {
      const longContent = 'x'.repeat(5000)
      const specWithLongFile: FactorySpecification = {
        intent: 'Fix something',
        context: {
          fileContents: [{
            path: 'src/big-file.ts',
            content: longContent,
          }],
        },
      }

      const result = reformat(specWithLongFile, 'coding-agent')

      // The full 5000 chars should NOT appear
      expect(result.body).not.toContain(longContent)
      // But some content should be there (truncated)
      expect(result.body).toContain('src/big-file.ts')
    })
  })
})
