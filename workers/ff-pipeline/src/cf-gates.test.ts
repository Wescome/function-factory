import { describe, expect, it, vi } from 'vitest'
import { buildCfGateRegistry, cfPatchAppliesCleanly, validateUnifiedDiff } from './cf-gates'

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
    }

    const result = await cfPatchAppliesCleanly({} as never, artifacts as never, 'FinalPatch')

    expect(artifacts.readText).toHaveBeenCalledWith('FinalPatch')
    expect(result).toMatchObject({ gate: 'patch_applies_cleanly', passed: true })
  })
})

describe('buildCfGateRegistry', () => {
  it('preserves base gates and overrides patch_applies_cleanly', () => {
    const existing = vi.fn()
    const registry = buildCfGateRegistry({ exists: existing as never, patch_applies_cleanly: existing as never })

    expect(registry.exists).toBe(existing)
    expect(registry.patch_applies_cleanly).toBe(cfPatchAppliesCleanly)
  })
})
