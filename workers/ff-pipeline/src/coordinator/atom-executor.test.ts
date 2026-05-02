/**
 * Tests for AtomExecutor language validation gate.
 *
 * Verifies that validateCodeLanguage() rejects non-TypeScript code
 * and that the atom execution loop short-circuits on language violations.
 */

import { describe, expect, it, vi } from 'vitest'
import { validateCodeLanguage, executeAtomSlice } from './atom-executor'
import type { AtomSlice, AtomExecutorDeps } from './atom-executor'
import type { CodeArtifact, PipelineWorkGraph } from './state'

// ── validateCodeLanguage unit tests ────────────────────────────

describe('validateCodeLanguage', () => {
  it('accepts .ts files with valid TypeScript content', () => {
    const code: CodeArtifact = {
      files: [
        { path: 'src/index.ts', content: 'export function hello() { return "world" }', action: 'create' },
        { path: 'src/types.ts', content: 'export interface Foo { bar: string }', action: 'create' },
      ],
      summary: 'TS code',
      testsIncluded: false,
    }
    const result = validateCodeLanguage(code)
    expect(result.valid).toBe(true)
    expect(result.violations).toHaveLength(0)
  })

  it('accepts .json config files', () => {
    const code: CodeArtifact = {
      files: [
        { path: 'tsconfig.json', content: '{"compilerOptions":{}}', action: 'create' },
      ],
      summary: 'JSON config',
      testsIncluded: false,
    }
    const result = validateCodeLanguage(code)
    expect(result.valid).toBe(true)
  })

  it('accepts .md documentation files', () => {
    const code: CodeArtifact = {
      files: [
        { path: 'docs/README.md', content: '# Hello', action: 'create' },
      ],
      summary: 'Docs',
      testsIncluded: false,
    }
    const result = validateCodeLanguage(code)
    expect(result.valid).toBe(true)
  })

  it('skips delete actions', () => {
    const code: CodeArtifact = {
      files: [
        { path: 'old-file.py', action: 'delete' },
      ],
      summary: 'Delete Python file',
      testsIncluded: false,
    }
    const result = validateCodeLanguage(code)
    expect(result.valid).toBe(true)
  })

  it('rejects .py files', () => {
    const code: CodeArtifact = {
      files: [
        { path: 'src/main.py', content: 'print("hello")', action: 'create' },
      ],
      summary: 'Python file',
      testsIncluded: false,
    }
    const result = validateCodeLanguage(code)
    expect(result.valid).toBe(false)
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0]).toContain('non-TypeScript file extension')
  })

  it('rejects .java files', () => {
    const code: CodeArtifact = {
      files: [
        { path: 'src/Main.java', content: 'import java.util.List;', action: 'create' },
      ],
      summary: 'Java file',
      testsIncluded: false,
    }
    const result = validateCodeLanguage(code)
    expect(result.valid).toBe(false)
    expect(result.violations.some(v => v.includes('non-TypeScript file extension'))).toBe(true)
  })

  it('rejects .cpp files', () => {
    const code: CodeArtifact = {
      files: [
        { path: 'src/main.cpp', content: '#include <iostream>', action: 'create' },
      ],
      summary: 'C++ file',
      testsIncluded: false,
    }
    const result = validateCodeLanguage(code)
    expect(result.valid).toBe(false)
  })

  it('rejects .sh files', () => {
    const code: CodeArtifact = {
      files: [
        { path: 'deploy.sh', content: '#!/bin/bash\necho hello', action: 'create' },
      ],
      summary: 'Shell script',
      testsIncluded: false,
    }
    const result = validateCodeLanguage(code)
    expect(result.valid).toBe(false)
  })

  // Content marker checks — detect foreign language inside .ts files
  it('rejects shebang in a .ts file', () => {
    const code: CodeArtifact = {
      files: [
        { path: 'src/script.ts', content: '#!/usr/bin/env node\nconsole.log("hi")', action: 'create' },
      ],
      summary: 'TS with shebang',
      testsIncluded: false,
    }
    const result = validateCodeLanguage(code)
    expect(result.valid).toBe(false)
    expect(result.violations[0]).toContain('shebang')
  })

  it('rejects Python from-import in a .ts file', () => {
    const code: CodeArtifact = {
      files: [
        { path: 'src/adapter.ts', content: 'from typing import List\nclass Foo:\n  pass', action: 'create' },
      ],
      summary: 'Python disguised as TS',
      testsIncluded: false,
    }
    const result = validateCodeLanguage(code)
    expect(result.valid).toBe(false)
    expect(result.violations[0]).toContain('Python import')
  })

  it('rejects Java import in a .ts file', () => {
    const code: CodeArtifact = {
      files: [
        { path: 'src/main.ts', content: 'import java.util.HashMap;', action: 'create' },
      ],
      summary: 'Java in TS',
      testsIncluded: false,
    }
    const result = validateCodeLanguage(code)
    expect(result.valid).toBe(false)
    expect(result.violations[0]).toContain('Java import')
  })

  it('rejects C++ include in a .ts file', () => {
    const code: CodeArtifact = {
      files: [
        { path: 'src/ffi.ts', content: '#include <stdio.h>\nint main() {}', action: 'create' },
      ],
      summary: 'C++ in TS',
      testsIncluded: false,
    }
    const result = validateCodeLanguage(code)
    expect(result.valid).toBe(false)
    expect(result.violations[0]).toContain('C/C++ include')
  })

  it('rejects Python def in a .ts file', () => {
    const code: CodeArtifact = {
      files: [
        { path: 'src/lib.ts', content: 'def hello(name):\n  return f"Hello {name}"', action: 'create' },
      ],
      summary: 'Python def in TS',
      testsIncluded: false,
    }
    const result = validateCodeLanguage(code)
    expect(result.valid).toBe(false)
    expect(result.violations[0]).toContain('Python def')
  })

  it('rejects Python class syntax in a .ts file', () => {
    const code: CodeArtifact = {
      files: [
        { path: 'src/model.ts', content: 'class UserService(BaseService):\n  pass', action: 'create' },
      ],
      summary: 'Python class in TS',
      testsIncluded: false,
    }
    const result = validateCodeLanguage(code)
    expect(result.valid).toBe(false)
    expect(result.violations[0]).toContain('Python class')
  })

  it('reports multiple violations across files', () => {
    const code: CodeArtifact = {
      files: [
        { path: 'src/main.py', content: 'from os import path', action: 'create' },
        { path: 'src/App.java', content: 'import java.util.List;', action: 'create' },
        { path: 'src/valid.ts', content: 'export const x = 1', action: 'create' },
      ],
      summary: 'Mixed languages',
      testsIncluded: false,
    }
    const result = validateCodeLanguage(code)
    expect(result.valid).toBe(false)
    // .py has ext violation + content violation, .java has ext + content
    expect(result.violations.length).toBeGreaterThanOrEqual(2)
  })

  it('handles files with no content (modify action)', () => {
    const code: CodeArtifact = {
      files: [
        { path: 'src/existing.ts', action: 'modify', edits: [{ search: 'old', replace: 'new' }] },
      ],
      summary: 'Modify existing',
      testsIncluded: false,
    }
    const result = validateCodeLanguage(code)
    expect(result.valid).toBe(true)
  })
})

// ── Integration: language gate in atom execution loop ──────────

describe('executeAtomSlice language gate', () => {
  function makeSlice(overrides?: Partial<AtomSlice>): AtomSlice {
    return {
      atomId: 'atom-lang-test',
      atomSpec: { id: 'atom-lang-test', description: 'test', assignedTo: 'coder' },
      upstreamArtifacts: {},
      sharedContext: {
        workGraphId: 'WG-LANG',
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

  it('fails immediately when code contains Python files', async () => {
    const badCode: CodeArtifact = {
      files: [{ path: 'src/main.py', content: 'print("hello")', action: 'create' }],
      summary: 'Python code',
      testsIncluded: false,
    }

    const deps = makeDeps(badCode)
    const result = await executeAtomSlice(makeSlice(), deps, { maxRetries: 3, dryRun: false })

    expect(result.verdict.decision).toBe('fail')
    expect(result.verdict.reason).toContain('synthesis:language-violation')
    expect(result.verdict.reason).toContain('non-TypeScript file extension')

    // Critic, tester, verifier should NOT be called
    expect(deps.criticAgent.codeReview).not.toHaveBeenCalled()
    expect(deps.testerAgent.runTests).not.toHaveBeenCalled()
    expect(deps.verifierAgent.verify).not.toHaveBeenCalled()
  })

  it('fails immediately when .ts file contains Python markers', async () => {
    const badCode: CodeArtifact = {
      files: [{ path: 'src/service.ts', content: 'from typing import Dict\nclass Foo(Bar):\n  pass', action: 'create' }],
      summary: 'Python in TS',
      testsIncluded: false,
    }

    const deps = makeDeps(badCode)
    const result = await executeAtomSlice(makeSlice(), deps, { maxRetries: 3, dryRun: false })

    expect(result.verdict.decision).toBe('fail')
    expect(result.verdict.reason).toContain('synthesis:language-violation')

    // Should NOT proceed to critic/test/verify
    expect(deps.criticAgent.codeReview).not.toHaveBeenCalled()
  })

  it('proceeds normally for valid TypeScript code', async () => {
    const goodCode: CodeArtifact = {
      files: [{ path: 'src/index.ts', content: 'export const x = 42', action: 'create' }],
      summary: 'Valid TS',
      testsIncluded: false,
    }

    const deps = makeDeps(goodCode)
    const result = await executeAtomSlice(makeSlice(), deps, { maxRetries: 0, dryRun: false })

    expect(result.verdict.decision).toBe('pass')
    expect(deps.criticAgent.codeReview).toHaveBeenCalled()
    expect(deps.testerAgent.runTests).toHaveBeenCalled()
    expect(deps.verifierAgent.verify).toHaveBeenCalled()
  })

  it('language violation confidence is 1.0', async () => {
    const badCode: CodeArtifact = {
      files: [{ path: 'deploy.sh', content: '#!/bin/bash', action: 'create' }],
      summary: 'Shell script',
      testsIncluded: false,
    }

    const deps = makeDeps(badCode)
    const result = await executeAtomSlice(makeSlice(), deps, { maxRetries: 3, dryRun: false })

    expect(result.verdict.confidence).toBe(1.0)
  })

  it('language violation does not retry', async () => {
    const badCode: CodeArtifact = {
      files: [{ path: 'src/main.py', content: 'def hello(): pass', action: 'create' }],
      summary: 'Python',
      testsIncluded: false,
    }

    const deps = makeDeps(badCode)
    const result = await executeAtomSlice(makeSlice(), deps, { maxRetries: 5, dryRun: false })

    // Should fail immediately, retryCount stays 0
    expect(result.retryCount).toBe(0)
    expect(result.verdict.decision).toBe('fail')

    // produceCode called exactly once (no retries)
    expect(deps.coderAgent.produceCode).toHaveBeenCalledTimes(1)
  })
})
