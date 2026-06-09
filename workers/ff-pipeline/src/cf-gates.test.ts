import { describe, expect, it, vi } from 'vitest'
import {
  buildCfGateRegistry,
  cfJsonFieldEquals,
  cfJsonFieldType,
  cfPatchAppliesCleanly,
  installCfGateRegistryForCompile,
  validateUnifiedDiff,
} from './cf-gates'

const validPatch = [
  'diff --git a/src/coding-adapter-smoke.ts b/src/coding-adapter-smoke.ts',
  'new file mode 100644',
  'index 0000000..1111111',
  '--- /dev/null',
  '+++ b/src/coding-adapter-smoke.ts',
  '@@ -0,0 +1 @@',
  '+coding-adapter smoke',
  '',
].join('\n')

const seedWorkspace = JSON.stringify({
  schemaVersion: '1.0',
  files: [
    {
      path: 'src/coding-adapter-smoke.ts',
      content: 'coding-adapter smoke\n',
    },
  ],
})

describe('validateUnifiedDiff', () => {
  it('accepts a syntactically valid unified diff', () => {
    expect(validateUnifiedDiff(validPatch)).toEqual({ passed: true })
  })

  it('rejects content without a hunk header', () => {
    expect(validateUnifiedDiff(validPatch.replace('@@ -0,0 +1 @@\n', ''))).toEqual({
      passed: false,
      message: 'patch missing unified hunk header',
    })
  })
})

describe('cfPatchAppliesCleanly', () => {
  it('reads the requested artifact from R2-compatible ArtifactManager', async () => {
    const artifacts = {
      readText: vi.fn(async () => validPatch),
      status: vi.fn(async () => ({ name: 'SeedWorkspace', exists: false })),
    }

    const result = await cfPatchAppliesCleanly({} as never, artifacts as never, 'FinalPatch')

    expect(artifacts.readText).toHaveBeenCalledWith('FinalPatch')
    expect(result).toMatchObject({ gate: 'patch_applies_cleanly', passed: true })
  })

  it('validates the patch against SeedWorkspace when that artifact is present', async () => {
    const artifacts = {
      status: vi.fn(async (name: string) => ({
        name,
        exists: true,
        sizeBytes: name === 'SeedWorkspace' ? seedWorkspace.length : validPatch.length,
      })),
      readText: vi.fn(async (name: string) => name === 'SeedWorkspace' ? seedWorkspace : validPatch),
    }

    const result = await cfPatchAppliesCleanly({} as never, artifacts as never, 'CandidatePatch')

    expect(artifacts.readText).toHaveBeenCalledWith('SeedWorkspace')
    expect(result).toMatchObject({
      gate: 'patch_applies_cleanly',
      passed: false,
    })
    expect(result.message).toContain('target file')
  })
})

describe('json field gates', () => {
  it('checks a JSON field against runtime state', async () => {
    const artifacts = {
      readText: vi.fn(async () => JSON.stringify({ status: 'ok', runId: 'run-123', elapsedMs: 42 })),
    }

    const result = await cfJsonFieldEquals(
      { runId: 'run-123' } as never,
      artifacts as never,
      { artifact: 'SmokeJsonArtifact', field: 'runId', valueFrom: 'runId' },
    )

    expect(artifacts.readText).toHaveBeenCalledWith('SmokeJsonArtifact')
    expect(result).toMatchObject({ gate: 'json_field_equals', passed: true })
  })

  it('fails when a JSON field does not match runtime state', async () => {
    const artifacts = {
      readText: vi.fn(async () => JSON.stringify({ status: 'ok', runId: 'wrong', elapsedMs: 42 })),
    }

    const result = await cfJsonFieldEquals(
      { runId: 'run-123' } as never,
      artifacts as never,
      { artifact: 'SmokeJsonArtifact', field: 'runId', valueFrom: 'runId' },
    )

    expect(result).toMatchObject({
      gate: 'json_field_equals',
      passed: false,
      failureClass: 'gate_abort',
    })
    expect(result.message).toContain('expected "run-123"')
    expect(result.message).toContain('found "wrong"')
  })

  it('checks a JSON field type', async () => {
    const artifacts = {
      readText: vi.fn(async () => JSON.stringify({ status: 'ok', runId: 'run-123', elapsedMs: 42 })),
    }

    const result = await cfJsonFieldType(
      {} as never,
      artifacts as never,
      { artifact: 'SmokeJsonArtifact', field: 'elapsedMs', type: 'number' },
    )

    expect(result).toMatchObject({ gate: 'json_field_type', passed: true })
  })

  it('fails when a JSON field type does not match', async () => {
    const artifacts = {
      readText: vi.fn(async () => JSON.stringify({ status: 'ok', runId: 'run-123', elapsedMs: '42' })),
    }

    const result = await cfJsonFieldType(
      {} as never,
      artifacts as never,
      { artifact: 'SmokeJsonArtifact', field: 'elapsedMs', type: 'number' },
    )

    expect(result).toMatchObject({
      gate: 'json_field_type',
      passed: false,
      failureClass: 'gate_abort',
    })
    expect(result.message).toContain('expected type number')
    expect(result.message).toContain('found string')
  })
})

describe('buildCfGateRegistry', () => {
  it('preserves base gates and overrides patch_applies_cleanly', () => {
    const existing = vi.fn()
    const registry = buildCfGateRegistry({ exists: existing as never, patch_applies_cleanly: existing as never })

    expect(registry.exists).toBe(existing)
    expect(registry.patch_applies_cleanly).toBe(cfPatchAppliesCleanly)
    expect(registry.json_field_equals).toBe(cfJsonFieldEquals)
    expect(registry.json_field_type).toBe(cfJsonFieldType)
  })

  it('installs custom gates into the compile-time registry without replacing existing gates', () => {
    const existing = vi.fn()
    const registry: Record<string, never> = {
      exists: existing as never,
      json_field_equals: existing as never,
    }

    installCfGateRegistryForCompile(registry)

    expect(registry.exists).toBe(existing)
    expect(registry.json_field_equals).toBe(existing)
    expect(registry.json_field_type).toBe(cfJsonFieldType)
  })
})
