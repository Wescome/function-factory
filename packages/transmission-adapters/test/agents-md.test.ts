/**
 * agents-md substrate tests — TDD RED phase.
 *
 * Validates:
 * 1. Produces valid markdown with required sections
 * 2. Includes build commands
 * 3. Includes conventions
 * 4. Includes artifact prefixes
 * 5. No Factory-internal vocabulary (no "atom", "ExecutableSpecification", "Pipeline" internals)
 * 6. Handles optional architectureDescription
 */

import { describe, it, expect } from 'vitest'
import { formatForAgentsMd } from '../src/substrates/agents-md'
import type { AgentsMdInput } from '../src/types'

// ── Fixtures ──

const fullInput: AgentsMdInput = {
  projectName: 'Function Factory',
  projectDescription: 'A closed-loop compiler that turns organizational pressures into executable functions.',
  buildCommands: {
    install: 'pnpm install',
    build: 'pnpm -r build',
    test: 'pnpm -r test',
    typecheck: 'pnpm -r typecheck',
  },
  conventions: {
    language: 'TypeScript only (.ts source, .json config)',
    monorepo: 'pnpm workspaces (packages/ and workers/)',
    commitFormat: 'FN-XXX | GATE-N | META | INFRA',
  },
  artifactPrefixes: {
    'PRS-*': 'Pressures',
    'BC-*': 'Capabilities',
    'FN-*': 'Functions',
    'IS-*': 'Intent Specifications',
    'ES-*': 'ExecutableSpecifications',
    'INV-*': 'Invariants',
    'VR-*': 'Verification Reports',
  },
  architectureDescription: 'Event-driven pipeline with verification checks. Pressures flow through compilation stages to produce verified Functions.',
}

const minimalInput: AgentsMdInput = {
  projectName: 'Test Project',
  projectDescription: 'A test project.',
  buildCommands: {
    install: 'npm install',
    build: 'npm run build',
    test: 'npm test',
    typecheck: 'npx tsc --noEmit',
  },
  conventions: {
    language: 'TypeScript',
    monorepo: 'npm workspaces',
    commitFormat: 'type: description',
  },
  artifactPrefixes: {
    'FEAT-*': 'Features',
  },
}

// ── Tests ──

describe('agents-md substrate', () => {
  describe('required sections', () => {
    it('produces markdown starting with project name as H1', () => {
      const result = formatForAgentsMd(fullInput)

      expect(result).toMatch(/^# Function Factory\n/)
    })

    it('includes Build & Test section with all commands', () => {
      const result = formatForAgentsMd(fullInput)

      expect(result).toContain('## Build & Test')
      expect(result).toContain('pnpm install')
      expect(result).toContain('pnpm -r build')
      expect(result).toContain('pnpm -r test')
      expect(result).toContain('pnpm -r typecheck')
    })

    it('includes Code Conventions section', () => {
      const result = formatForAgentsMd(fullInput)

      expect(result).toContain('## Code Conventions')
      expect(result).toContain('TypeScript only (.ts source, .json config)')
      expect(result).toContain('pnpm workspaces (packages/ and workers/)')
      expect(result).toContain('FN-XXX | GATE-N | META | INFRA')
    })

    it('includes Artifact IDs section with prefix table', () => {
      const result = formatForAgentsMd(fullInput)

      expect(result).toContain('## Artifact IDs')
      expect(result).toContain('PRS-*')
      expect(result).toContain('Pressures')
      expect(result).toContain('FN-*')
      expect(result).toContain('Functions')
    })

    it('includes Architecture section when description provided', () => {
      const result = formatForAgentsMd(fullInput)

      expect(result).toContain('## Architecture')
      expect(result).toContain('Event-driven pipeline with verification checks')
    })
  })

  describe('build commands', () => {
    it('formats commands as code spans', () => {
      const result = formatForAgentsMd(fullInput)

      expect(result).toContain('`pnpm install`')
      expect(result).toContain('`pnpm -r build`')
      expect(result).toContain('`pnpm -r test`')
      expect(result).toContain('`pnpm -r typecheck`')
    })
  })

  describe('conventions', () => {
    it('labels language, monorepo, and commit format', () => {
      const result = formatForAgentsMd(fullInput)

      expect(result).toMatch(/Language:/)
      expect(result).toMatch(/Monorepo:/)
      expect(result).toMatch(/Commit format:/)
    })
  })

  describe('artifact prefixes', () => {
    it('includes all provided prefixes', () => {
      const result = formatForAgentsMd(fullInput)

      for (const [prefix, desc] of Object.entries(fullInput.artifactPrefixes)) {
        expect(result).toContain(prefix)
        expect(result).toContain(desc)
      }
    })
  })

  describe('optional fields', () => {
    it('omits Architecture section when description is undefined', () => {
      const result = formatForAgentsMd(minimalInput)

      expect(result).not.toContain('## Architecture')
    })

    it('still produces all required sections with minimal input', () => {
      const result = formatForAgentsMd(minimalInput)

      expect(result).toContain('# Test Project')
      expect(result).toContain('## Build & Test')
      expect(result).toContain('## Code Conventions')
      expect(result).toContain('## Artifact IDs')
    })
  })

  describe('anti-corruption: no Factory-internal vocabulary', () => {
    it('does not contain internal Factory terms', () => {
      const result = formatForAgentsMd(fullInput)

      // These are internal implementation terms that should not leak
      expect(result).not.toMatch(/\bRequirementAtom\b/)
      expect(result).not.toMatch(/\bCodeArtifact\b/)
      expect(result).not.toMatch(/\bGraphState\b/)
      expect(result).not.toMatch(/\bPipelineExecutableSpecification\b/)
      expect(result).not.toMatch(/\bCoderAgent\b/)
      expect(result).not.toMatch(/\bCoderInput\b/)
      expect(result).not.toMatch(/\bFactorySpecification\b/)
      expect(result).not.toMatch(/\bCommunicableSpecification\b/)
    })
  })

  describe('output format', () => {
    it('returns a string (plain markdown)', () => {
      const result = formatForAgentsMd(fullInput)

      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('uses bullet lists for build commands', () => {
      const result = formatForAgentsMd(fullInput)

      expect(result).toMatch(/^- Install:/m)
      expect(result).toMatch(/^- Build:/m)
      expect(result).toMatch(/^- Test:/m)
      expect(result).toMatch(/^- Typecheck:/m)
    })
  })
})
