/**
 * Phase B: file action validation tests.
 *
 * RED tests for discrepancies #5 and #6 from the structural audit.
 *
 * Discrepancy #5 (HIGH):
 *   resolveTargetFiles() in atom-executor-do.ts does not check
 *   atomSpec.binding.target for the file path. The binding pass
 *   produces { binding: { target: 'src/foo.ts' } } on every atom,
 *   but resolveTargetFiles only checks .targetFiles, .suggestedFiles,
 *   and .file — never .binding.target. This means atoms that SHOULD
 *   get file context (because the compiler told them which file to
 *   modify) never do.
 *
 * Discrepancy #6 (HIGH):
 *   There is no validateFileActions() gate in the atom executor
 *   pipeline. After the CoderAgent produces a CodeArtifact, there is
 *   no check that the file actions are consistent with the available
 *   file contexts. If fileContexts include 'src/foo.ts' (file exists)
 *   but the CodeArtifact says action='create' for 'src/foo.ts', that
 *   is a conflict. A validation gate should force action='modify'.
 *
 * These tests describe the CORRECT behavior. They will FAIL against
 * the current codebase (RED phase). The Engineer writes code to make
 * them pass (GREEN phase).
 */

import { describe, expect, it, vi } from 'vitest'

// ── Mock cloudflare:workers (transitive dep) ───
vi.mock('cloudflare:workers', () => ({
  WorkflowEntrypoint: class {},
  DurableObject: class {},
}))

vi.mock('agents', () => ({
  Agent: class {},
  callable: () => (t: unknown) => t,
}))

import { executeAtomSlice, validateCodeLanguage } from './atom-executor'
import type { AtomSlice, AtomExecutorDeps } from './atom-executor'
import type { CodeArtifact } from './state'
import type { FileContext } from '@factory/file-context'

// ── Helpers ─────────────────────────────────────────────────────────

function makeFileContext(path: string, content: string): FileContext {
  return {
    path,
    language: 'typescript',
    rawContent: content,
    structure: {
      exports: [],
      imports: [],
      functions: [],
      types: [],
      classes: [],
    },
    confidence: 'extracted',
    targetSlice: content,
  }
}

function makeSlice(overrides?: Partial<AtomSlice>): AtomSlice {
  return {
    atomId: 'atom-fileaction-test',
    atomSpec: {
      id: 'atom-fileaction-test',
      description: 'test atom',
      assignedTo: 'coder',
    },
    upstreamArtifacts: {},
    sharedContext: {
      workGraphId: 'WG-FILEACTION',
      specContent: null,
      briefingScript: {},
    },
    ...overrides,
  }
}

function makeDeps(codeArtifact: CodeArtifact): AtomExecutorDeps {
  return {
    coderAgent: {
      produceCode: vi.fn().mockResolvedValue(codeArtifact),
    },
    criticAgent: {
      codeReview: vi.fn().mockResolvedValue({
        passed: true,
        issues: [],
        mentorRuleCompliance: [],
        overallAssessment: 'OK',
      }),
    },
    testerAgent: {
      runTests: vi.fn().mockResolvedValue({
        passed: true,
        testsRun: 1,
        testsPassed: 1,
        testsFailed: 0,
        failures: [],
        summary: 'OK',
      }),
    },
    verifierAgent: {
      verify: vi.fn().mockResolvedValue({
        decision: 'pass',
        confidence: 1.0,
        reason: 'OK',
      }),
    },
    fetchMentorRules: vi.fn().mockResolvedValue([]),
  }
}

// ── Discrepancy #5 tests ────────────────────────────────────────────

describe('resolveTargetFiles: extract path from binding.target (discrepancy #5)', () => {
  /**
   * NOTE: resolveTargetFiles is a private method on the DO class, so we
   * test its effect indirectly. The test verifies that when an atomSpec
   * has binding.target set, the downstream fetchFileContexts would use it.
   *
   * For unit-level testing, we need the function to be extracted or
   * we test through the public interface. We import and test the
   * standalone version that the Engineer will extract.
   */

  it('resolveTargetFiles extracts path from atomSpec.binding.target', async () => {
    // The fix should extract resolveTargetFiles as a standalone function
    // and make it check binding.target. We import the fixed version.
    const { resolveTargetFiles } = await import('./atom-executor-do')

    const atomSpec = {
      id: 'atom-001',
      description: 'Update the compile stage',
      binding: {
        type: 'code',
        language: 'typescript',
        target: 'workers/ff-pipeline/src/stages/compile.ts',
      },
    }

    const result = resolveTargetFiles(atomSpec)
    expect(result).toContain('workers/ff-pipeline/src/stages/compile.ts')
  })

  it('resolveTargetFiles prefers explicit targetFiles over binding.target', async () => {
    const { resolveTargetFiles } = await import('./atom-executor-do')

    const atomSpec = {
      id: 'atom-002',
      targetFiles: ['src/explicit.ts'],
      binding: {
        type: 'code',
        language: 'typescript',
        target: 'src/from-binding.ts',
      },
    }

    const result = resolveTargetFiles(atomSpec)
    // Explicit targetFiles should win over binding.target
    expect(result).toEqual(['src/explicit.ts'])
  })

  it('resolveTargetFiles returns binding.target when no targetFiles/suggestedFiles/file', async () => {
    const { resolveTargetFiles } = await import('./atom-executor-do')

    const atomSpec = {
      id: 'atom-003',
      description: 'No explicit target fields',
      binding: {
        type: 'code',
        language: 'typescript',
        target: 'src/inferred-from-binding.ts',
      },
    }

    const result = resolveTargetFiles(atomSpec)
    expect(result).toContain('src/inferred-from-binding.ts')
    expect(result.length).toBeGreaterThan(0)
  })

  it('resolveTargetFiles still returns [] when no binding.target and no other fields', async () => {
    const { resolveTargetFiles } = await import('./atom-executor-do')

    const atomSpec = {
      id: 'atom-004',
      description: 'No targets anywhere',
    }

    const result = resolveTargetFiles(atomSpec)
    expect(result).toEqual([])
  })

  it('resolveTargetFiles ignores binding.target when target is TBD', async () => {
    const { resolveTargetFiles } = await import('./atom-executor-do')

    const atomSpec = {
      id: 'atom-005',
      binding: {
        type: 'code',
        language: 'typescript',
        target: 'TBD',
      },
    }

    const result = resolveTargetFiles(atomSpec)
    expect(result).toEqual([])
  })
})

// ── Discrepancy #6 tests ────────────────────────────────────────────

describe('validateFileActions: gate in atom executor (discrepancy #6)', () => {
  /**
   * A new validateFileActions() function should exist and be called
   * in the atom execution pipeline. It checks that file actions are
   * consistent with the available file contexts:
   *
   * - If fileContexts includes path X and code says action='create' for X,
   *   force action to 'modify' (file exists, cannot create).
   *
   * - If fileContexts does NOT include path X and code says action='modify',
   *   that is ok (could be modifying a file not in context).
   */

  it('forces action to modify when file exists in fileContexts', async () => {
    // The CoderAgent produces create action for a file that is KNOWN to exist
    // (because it appears in fileContexts). The validation gate should fix this.
    const existingFileContent = 'export const x = 1;\nexport function hello() { return "world" }\n'
    const fileContexts: FileContext[] = [
      makeFileContext('src/existing-module.ts', existingFileContent),
    ]

    const codeArtifact: CodeArtifact = {
      files: [
        {
          path: 'src/existing-module.ts',
          content: '// completely new content that overwrites',
          action: 'create', // WRONG — file exists, should be 'modify'
        },
      ],
      summary: 'Incorrectly creates an existing file',
      testsIncluded: false,
    }

    const deps = makeDeps(codeArtifact)
    const slice = makeSlice({ fileContexts })

    const result = await executeAtomSlice(slice, deps, { maxRetries: 0, dryRun: false })

    // The pipeline should have corrected the action. To verify, we check
    // that the codeArtifact in the result has action='modify' for the
    // file that was in fileContexts.
    expect(result.codeArtifact).not.toBeNull()
    const file = result.codeArtifact!.files.find(f => f.path === 'src/existing-module.ts')
    expect(file).toBeDefined()
    expect(file!.action).toBe('modify')
  })

  it('leaves action as create when file is NOT in fileContexts', async () => {
    // File is genuinely new — no file context for it. Create is correct.
    const fileContexts: FileContext[] = [
      makeFileContext('src/other-file.ts', 'export const y = 2'),
    ]

    const codeArtifact: CodeArtifact = {
      files: [
        {
          path: 'src/brand-new.ts',
          content: 'export const fresh = true',
          action: 'create', // CORRECT — this file is not in fileContexts
        },
      ],
      summary: 'Creates a genuinely new file',
      testsIncluded: false,
    }

    const deps = makeDeps(codeArtifact)
    const slice = makeSlice({ fileContexts })

    const result = await executeAtomSlice(slice, deps, { maxRetries: 0, dryRun: false })

    expect(result.codeArtifact).not.toBeNull()
    const file = result.codeArtifact!.files.find(f => f.path === 'src/brand-new.ts')
    expect(file).toBeDefined()
    expect(file!.action).toBe('create')
  })

  it('does not mutate files with explicit modify action', async () => {
    // File correctly says modify and is in fileContexts. No change needed.
    const fileContexts: FileContext[] = [
      makeFileContext('src/module.ts', 'export const a = 1'),
    ]

    const codeArtifact: CodeArtifact = {
      files: [
        {
          path: 'src/module.ts',
          action: 'modify',
          edits: [{ search: 'const a = 1', replace: 'const a = 2' }],
        },
      ],
      summary: 'Correctly modifies existing file',
      testsIncluded: false,
    }

    const deps = makeDeps(codeArtifact)
    const slice = makeSlice({ fileContexts })

    const result = await executeAtomSlice(slice, deps, { maxRetries: 0, dryRun: false })

    expect(result.codeArtifact).not.toBeNull()
    const file = result.codeArtifact!.files.find(f => f.path === 'src/module.ts')
    expect(file).toBeDefined()
    expect(file!.action).toBe('modify')
  })

  it('handles mixed files: some existing, some new', async () => {
    // Two files: one exists in context (should be modify), one does not (create ok)
    const fileContexts: FileContext[] = [
      makeFileContext('src/existing.ts', 'export const old = true'),
    ]

    const codeArtifact: CodeArtifact = {
      files: [
        {
          path: 'src/existing.ts',
          content: '// overwrite',
          action: 'create', // WRONG — should be forced to modify
        },
        {
          path: 'src/new-module.ts',
          content: '// new file',
          action: 'create', // CORRECT — file does not exist
        },
      ],
      summary: 'Mixed existing and new files',
      testsIncluded: false,
    }

    const deps = makeDeps(codeArtifact)
    const slice = makeSlice({ fileContexts })

    const result = await executeAtomSlice(slice, deps, { maxRetries: 0, dryRun: false })

    expect(result.codeArtifact).not.toBeNull()
    const existingFile = result.codeArtifact!.files.find(f => f.path === 'src/existing.ts')
    const newFile = result.codeArtifact!.files.find(f => f.path === 'src/new-module.ts')

    expect(existingFile!.action).toBe('modify')
    expect(newFile!.action).toBe('create')
  })

  it('validateFileActions function exists and is importable', async () => {
    // The fix should export a validateFileActions function from atom-executor.ts
    // that can be called independently for testing.
    const mod = await import('./atom-executor')
    expect(typeof (mod as any).validateFileActions).toBe('function')
  })

  it('validateFileActions returns list of corrected paths', async () => {
    // The function should return which files had their action corrected
    const { validateFileActions } = await import('./atom-executor') as any

    const code: CodeArtifact = {
      files: [
        { path: 'src/a.ts', content: '// a', action: 'create' },
        { path: 'src/b.ts', content: '// b', action: 'create' },
        { path: 'src/c.ts', content: '// c', action: 'modify', edits: [{ search: 'x', replace: 'y' }] },
      ],
      summary: 'test',
      testsIncluded: false,
    }

    const fileContexts: FileContext[] = [
      makeFileContext('src/a.ts', 'export const a = 1'),
      // src/b.ts is NOT in contexts — create is fine
    ]

    const corrections = validateFileActions(code, fileContexts)

    // Should report that src/a.ts was corrected from create to modify
    expect(corrections).toContain('src/a.ts')
    // src/b.ts should NOT be corrected (not in contexts)
    expect(corrections).not.toContain('src/b.ts')
    // src/c.ts should NOT be corrected (already modify)
    expect(corrections).not.toContain('src/c.ts')

    // The code object should be mutated: src/a.ts now has action='modify'
    expect(code.files[0]!.action).toBe('modify')
  })
})
