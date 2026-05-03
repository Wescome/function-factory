/**
 * Phase 2: ORL content coercion tests (Fix 1).
 *
 * RED tests that FAIL against current code. Engineer makes them pass.
 *
 * Fix 1: content coercion when edits are present
 *   CODE_ARTIFACT_SCHEMA postCoerce currently does:
 *     if (typeof file.content !== 'string') file.content = coerceToString(file.content)
 *
 *   This coerces undefined content to '' (empty string) even when the file
 *   has an edits[] array. That empty string then wins over the edits in
 *   generate-pr.ts because:
 *     1. hasLegacyContent becomes true (content is '' which is !== undefined)
 *     2. The legacy path writes '' to the file, destroying existing content
 *     3. The edits are never applied
 *
 *   The fix: postCoerce must NOT coerce content to '' when edits are present.
 *   Content should remain undefined/absent for edit-based modifications.
 */

import { describe, expect, it } from 'vitest'
import {
  processAgentOutput,
  CODE_ARTIFACT_SCHEMA,
} from './output-reliability'

// ── Fix 1: content coercion with edits ──────────────────────────────

describe('ORL CODE_ARTIFACT_SCHEMA: content coercion for modify-with-edits (Fix 1)', () => {

  it('does NOT coerce content to empty string when edits are present', async () => {
    // When a model returns a file with edits but no content field,
    // ORL must NOT coerce content to ''. The content field should stay
    // undefined so that generate-pr.ts takes the edit path, not the
    // legacy full-content path.
    const raw = JSON.stringify({
      files: [
        {
          path: 'src/existing.ts',
          action: 'modify',
          edits: [
            { search: 'const oldValue = 1', replace: 'const newValue = 2' },
          ],
          // content is intentionally ABSENT -- the model is using edits
        },
      ],
      summary: 'Modify via edits without content field',
      testsIncluded: false,
    })

    const result = await processAgentOutput(raw, CODE_ARTIFACT_SCHEMA)

    expect(result.success).toBe(true)
    const data = result.data as {
      files: Array<{
        path: string
        action: string
        content?: string
        edits?: Array<{ search: string; replace: string }>
      }>
    }
    const file = data.files[0]!

    // CURRENT BEHAVIOR: content is '' (coerced from undefined by postCoerce)
    // CORRECT BEHAVIOR: content is undefined or not present
    // The content field must NOT be an empty string when edits are the
    // intended modification mechanism.
    expect(file.content).toBeUndefined()
    expect(file.edits).toBeDefined()
    expect(file.edits!.length).toBe(1)
  })

  it('still coerces content to empty string for create action without edits', async () => {
    // Baseline: when a model returns action='create' with no edits and
    // content is a non-string (e.g., number or null), coercion to '' is
    // correct because create needs a content string.
    const raw = JSON.stringify({
      files: [
        {
          path: 'src/new-file.ts',
          action: 'create',
          content: null, // non-string, should be coerced to ''
          // no edits -- this is a create
        },
      ],
      summary: 'Create with null content',
      testsIncluded: false,
    })

    const result = await processAgentOutput(raw, CODE_ARTIFACT_SCHEMA)

    expect(result.success).toBe(true)
    const data = result.data as {
      files: Array<{ path: string; action: string; content?: string }>
    }
    const file = data.files[0]!

    // For create without edits, content SHOULD be coerced to '' (or some string)
    expect(typeof file.content).toBe('string')
  })

  it('preserves explicit content string even when edits are present', async () => {
    // Edge case: model provides BOTH content and edits. Both should be
    // preserved as-is (the caller decides which to use). The key thing
    // is content is not destroyed or replaced.
    const raw = JSON.stringify({
      files: [
        {
          path: 'src/dual.ts',
          action: 'modify',
          content: 'export const base = true',
          edits: [
            { search: 'const base = true', replace: 'const base = false' },
          ],
        },
      ],
      summary: 'Both content and edits provided',
      testsIncluded: false,
    })

    const result = await processAgentOutput(raw, CODE_ARTIFACT_SCHEMA)

    expect(result.success).toBe(true)
    const data = result.data as {
      files: Array<{
        path: string
        action: string
        content?: string
        edits?: Array<{ search: string; replace: string }>
      }>
    }
    const file = data.files[0]!

    // Both should be preserved
    expect(file.content).toBe('export const base = true')
    expect(file.edits).toBeDefined()
    expect(file.edits!.length).toBe(1)
  })
})
