import { describe, it, expect } from 'vitest'
import { validateArtifact } from './index'

// ─── C1: Lineage Completeness ──────────────────────────────────────

describe('C1 — Lineage completeness', () => {
  const LINEAGE_COLLECTIONS = [
    'specs_pressures',
    'specs_capabilities',
    'specs_functions',
    'specs_workgraphs',
    'specs_coverage_reports',
  ]

  for (const collection of LINEAGE_COLLECTIONS) {
    it(`rejects ${collection} with empty source_refs`, () => {
      const result = validateArtifact(collection, {
        _key: 'TEST-001',
        title: 'Test artifact',
        source_refs: [],
      })
      expect(result.valid).toBe(false)
      expect(result.violations).toContainEqual(
        expect.objectContaining({
          constraint: 'C1-lineage',
          severity: 'violation',
        }),
      )
    })

    it(`rejects ${collection} with missing source_refs`, () => {
      const result = validateArtifact(collection, {
        _key: 'TEST-001',
        title: 'Test artifact',
      })
      expect(result.valid).toBe(false)
      expect(result.violations).toContainEqual(
        expect.objectContaining({
          constraint: 'C1-lineage',
          severity: 'violation',
        }),
      )
    })

    it(`passes ${collection} with populated source_refs`, () => {
      const result = validateArtifact(collection, {
        _key: 'TEST-001',
        title: 'Test artifact',
        source_refs: ['SIG:SIG-001'],
      })
      // C1 should not fire
      const c1Violations = result.violations.filter(
        (v) => v.constraint === 'C1-lineage' && v.severity === 'violation',
      )
      expect(c1Violations).toHaveLength(0)
    })
  }

  it('skips lineage check for specs_signals (Stage 1 origin)', () => {
    const result = validateArtifact('specs_signals', {
      _key: 'SIG-001',
      title: 'A raw signal',
      source_refs: [],
    })
    const c1Violations = result.violations.filter(
      (v) => v.constraint === 'C1-lineage',
    )
    expect(c1Violations).toHaveLength(0)
  })

  it('skips lineage check for execution_artifacts', () => {
    const result = validateArtifact('execution_artifacts', {
      _key: 'EA-001',
      content: 'some code',
    })
    const c1Violations = result.violations.filter(
      (v) => v.constraint === 'C1-lineage',
    )
    expect(c1Violations).toHaveLength(0)
  })

  it('skips lineage check for memory_episodic', () => {
    const result = validateArtifact('memory_episodic', {
      _key: 'ep-001',
      action: 'test',
    })
    const c1Violations = result.violations.filter(
      (v) => v.constraint === 'C1-lineage',
    )
    expect(c1Violations).toHaveLength(0)
  })

  it('skips lineage check for gate_status', () => {
    const result = validateArtifact('gate_status', {
      _key: 'gate:1:WG-001',
      passed: true,
    })
    const c1Violations = result.violations.filter(
      (v) => v.constraint === 'C1-lineage',
    )
    expect(c1Violations).toHaveLength(0)
  })

  it('skips lineage check for agent_designs', () => {
    const result = validateArtifact('agent_designs', {
      _key: 'AD-001',
      name: 'ArchitectAgent',
    })
    const c1Violations = result.violations.filter(
      (v) => v.constraint === 'C1-lineage',
    )
    expect(c1Violations).toHaveLength(0)
  })

  it('also checks sourceRefs (camelCase variant)', () => {
    const result = validateArtifact('specs_pressures', {
      _key: 'PRS-001',
      title: 'Pressure',
      sourceRefs: ['SIG:SIG-001'],
    })
    const c1Violations = result.violations.filter(
      (v) => v.constraint === 'C1-lineage' && v.severity === 'violation',
    )
    expect(c1Violations).toHaveLength(0)
  })
})

// ─── C7: CRP on Low Confidence ──────────────────────────────────────

describe('C7 — CRP on low confidence', () => {
  it('flags crpRequired when confidence < 0.7', () => {
    const result = validateArtifact('execution_artifacts', {
      _key: 'EA-001',
      confidence: 0.5,
      content: 'low confidence output',
    })
    expect(result.crpRequired).toBe(true)
    expect(result.violations).toContainEqual(
      expect.objectContaining({
        constraint: 'C7-confidence',
        severity: 'warning',
      }),
    )
  })

  it('does not flag crpRequired when confidence >= 0.7', () => {
    const result = validateArtifact('execution_artifacts', {
      _key: 'EA-001',
      confidence: 0.8,
      content: 'high confidence output',
    })
    expect(result.crpRequired).toBeFalsy()
    const c7Warnings = result.violations.filter(
      (v) => v.constraint === 'C7-confidence',
    )
    expect(c7Warnings).toHaveLength(0)
  })

  it('does not flag crpRequired when confidence is exactly 0.7', () => {
    const result = validateArtifact('execution_artifacts', {
      _key: 'EA-001',
      confidence: 0.7,
      content: 'borderline output',
    })
    expect(result.crpRequired).toBeFalsy()
  })

  it('does not flag crpRequired when confidence field is absent', () => {
    const result = validateArtifact('execution_artifacts', {
      _key: 'EA-001',
      content: 'no confidence field',
    })
    expect(result.crpRequired).toBeFalsy()
  })
})

// ─── C9: Gate Fail-Closed ───────────────────────────────────────────

describe('C9 — Gate fail-closed', () => {
  it('rejects coverage report without passed field', () => {
    const result = validateArtifact('specs_coverage_reports', {
      _key: 'CR-001',
      type: 'gate-1',
      summary: 'Missing passed field',
      source_refs: ['FP:FP-001'],
    })
    expect(result.valid).toBe(false)
    expect(result.violations).toContainEqual(
      expect.objectContaining({
        constraint: 'C9-gate-fail-closed',
        severity: 'violation',
      }),
    )
  })

  it('rejects coverage report with non-boolean passed field', () => {
    const result = validateArtifact('specs_coverage_reports', {
      _key: 'CR-001',
      type: 'gate-1',
      passed: 'yes',
      source_refs: ['FP:FP-001'],
    })
    expect(result.valid).toBe(false)
    expect(result.violations).toContainEqual(
      expect.objectContaining({
        constraint: 'C9-gate-fail-closed',
        severity: 'violation',
      }),
    )
  })

  it('passes coverage report with passed: true', () => {
    const result = validateArtifact('specs_coverage_reports', {
      _key: 'CR-001',
      type: 'gate-1',
      passed: true,
      source_refs: ['FP:FP-001'],
    })
    const c9Violations = result.violations.filter(
      (v) => v.constraint === 'C9-gate-fail-closed',
    )
    expect(c9Violations).toHaveLength(0)
  })

  it('passes coverage report with passed: false', () => {
    const result = validateArtifact('specs_coverage_reports', {
      _key: 'CR-001',
      type: 'gate-1',
      passed: false,
      source_refs: ['FP:FP-001'],
    })
    const c9Violations = result.violations.filter(
      (v) => v.constraint === 'C9-gate-fail-closed',
    )
    expect(c9Violations).toHaveLength(0)
  })

  it('does not apply to non-coverage-report collections', () => {
    const result = validateArtifact('specs_pressures', {
      _key: 'PRS-001',
      source_refs: ['SIG:SIG-001'],
    })
    const c9Violations = result.violations.filter(
      (v) => v.constraint === 'C9-gate-fail-closed',
    )
    expect(c9Violations).toHaveLength(0)
  })
})

// ─── C15: No Secrets ────────────────────────────────────────────────

describe('C15 — No secrets', () => {
  const SECRET_PATTERNS = [
    { name: 'Anthropic key', value: 'sk-ant-api03-abc123' },
    { name: 'OpenAI project key', value: 'sk-proj-abc123' },
    { name: 'Google OAuth', value: 'GOCSPX-abc123' },
    { name: 'Bearer JWT', value: 'Bearer eyJhbGciOiJIUzI1NiJ9.token' },
    { name: 'AWS access key', value: 'AKIAIOSFODNN7EXAMPLE' },
    { name: 'RSA private key', value: '-----BEGIN RSA PRIVATE KEY-----' },
    { name: 'OpenSSH private key', value: '-----BEGIN OPENSSH PRIVATE KEY-----' },
    { name: 'GitHub PAT', value: 'ghp_abcdefghijk1234567890' },
    { name: 'GitLab PAT', value: 'glpat-abcdefghijk' },
    { name: 'Slack bot token', value: 'xoxb-123-456-abc' },
    { name: 'GCP token', value: 'ya29.a0Af_something' },
  ]

  for (const { name, value } of SECRET_PATTERNS) {
    it(`detects ${name} in top-level field`, () => {
      const result = validateArtifact('specs_signals', {
        _key: 'SIG-001',
        content: `Some text with ${value} embedded`,
      })
      expect(result.valid).toBe(false)
      expect(result.violations).toContainEqual(
        expect.objectContaining({
          constraint: 'C15-secrets',
          severity: 'violation',
        }),
      )
    })
  }

  it('detects secret in nested field', () => {
    const result = validateArtifact('specs_signals', {
      _key: 'SIG-001',
      metadata: {
        nested: {
          deep: {
            apiKey: 'sk-ant-api03-secret-here',
          },
        },
      },
    })
    expect(result.valid).toBe(false)
    expect(result.violations).toContainEqual(
      expect.objectContaining({
        constraint: 'C15-secrets',
        severity: 'violation',
      }),
    )
  })

  it('detects secret in array elements', () => {
    const result = validateArtifact('specs_signals', {
      _key: 'SIG-001',
      evidence: ['normal text', 'has ghp_secrettoken123 in it'],
    })
    expect(result.valid).toBe(false)
    expect(result.violations).toContainEqual(
      expect.objectContaining({
        constraint: 'C15-secrets',
        severity: 'violation',
      }),
    )
  })

  it('passes clean document with no secrets', () => {
    const result = validateArtifact('specs_signals', {
      _key: 'SIG-001',
      title: 'Clean signal',
      description: 'No secrets here',
      evidence: ['observation 1', 'observation 2'],
      metadata: { source: 'github-webhook', tag: 'build-event' },
    })
    const c15Violations = result.violations.filter(
      (v) => v.constraint === 'C15-secrets',
    )
    expect(c15Violations).toHaveLength(0)
  })

  it('applies to ALL collections (universal constraint)', () => {
    const result = validateArtifact('memory_episodic', {
      _key: 'ep-001',
      detail: { leaked: 'xoxb-slack-bot-token' },
    })
    expect(result.valid).toBe(false)
    expect(result.violations).toContainEqual(
      expect.objectContaining({
        constraint: 'C15-secrets',
        severity: 'violation',
      }),
    )
  })
})

// ─── Combined violations ────────────────────────────────────────────

describe('Combined violations', () => {
  it('reports multiple violations from different constraints', () => {
    const result = validateArtifact('specs_coverage_reports', {
      _key: 'CR-BAD',
      // C1: empty source_refs
      source_refs: [],
      // C9: missing passed field
      // C15: secret in content
      summary: 'Report with sk-ant-api03-leaked in text',
    })
    expect(result.valid).toBe(false)
    const constraints = result.violations
      .filter((v) => v.severity === 'violation')
      .map((v) => v.constraint)
    expect(constraints).toContain('C1-lineage')
    expect(constraints).toContain('C9-gate-fail-closed')
    expect(constraints).toContain('C15-secrets')
    expect(constraints.length).toBeGreaterThanOrEqual(3)
  })

  it('warnings do not block validity when no violations exist', () => {
    const result = validateArtifact('execution_artifacts', {
      _key: 'EA-001',
      confidence: 0.5,
      content: 'low confidence but clean',
    })
    // C7 is a warning, not a violation
    expect(result.valid).toBe(true)
    expect(result.crpRequired).toBe(true)
    expect(result.violations).toContainEqual(
      expect.objectContaining({
        constraint: 'C7-confidence',
        severity: 'warning',
      }),
    )
  })

  it('returns valid: true for a fully compliant artifact', () => {
    const result = validateArtifact('specs_pressures', {
      _key: 'PRS-001',
      title: 'Well-formed pressure',
      description: 'Properly sourced',
      source_refs: ['SIG:SIG-001'],
      sourceRefs: ['SIG:SIG-001'],
      confidence: 0.9,
    })
    expect(result.valid).toBe(true)
    expect(result.violations.filter((v) => v.severity === 'violation')).toHaveLength(0)
  })
})

// ─── Edge cases ─────────────────────────────────────────────────────

describe('Edge cases', () => {
  it('handles null/undefined values in document fields gracefully', () => {
    const result = validateArtifact('specs_pressures', {
      _key: 'PRS-001',
      title: null,
      description: undefined,
      source_refs: ['SIG:SIG-001'],
    })
    // Should not throw, should validate what it can
    expect(result).toBeDefined()
    expect(result.violations).toBeDefined()
  })

  it('handles empty document', () => {
    const result = validateArtifact('specs_pressures', {})
    expect(result).toBeDefined()
    // C1 should fire for empty source_refs
    expect(result.valid).toBe(false)
  })

  it('handles unknown collection gracefully', () => {
    const result = validateArtifact('unknown_collection', {
      _key: 'X-001',
      content: 'clean',
    })
    // C15 always runs, but no C1/C9 applies
    expect(result.valid).toBe(true)
  })
})
