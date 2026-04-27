/**
 * T13: Persistence boundary tests — TDD.
 *
 * Verifies that persistSynthesisResult() and buildResult() correctly
 * surface briefingScript, semanticReview, gate1Report, and full
 * roleHistory to ArangoDB and the SynthesisResult return type.
 *
 * Root cause: 9-node graph nodes write these fields to GraphState
 * correctly, but persistSynthesisResult() and buildResult() drop
 * them at the exit boundary.
 *
 * Strategy: coordinator.ts imports 'agents' (cloudflare:workers) so
 * we cannot directly instantiate it in vitest. Instead we verify:
 *
 * 1. Source structure: persistSynthesisResult includes the fields
 * 2. Source structure: buildResult includes the fields
 * 3. Source structure: SynthesisResult interface has optional fields
 * 4. Source structure: roleHistory persisted with full output
 *
 * For behavioral tests, we extract the method logic patterns from
 * the source and verify them structurally.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const coordinatorSrc = readFileSync(
  resolve(__dirname, './coordinator.ts'),
  'utf-8',
)

// ────────────────────────────────────────────────────────────
// T13.1: persistSynthesisResult writes briefingScript to synthesis_summary
// ────────────────────────────────────────────────────────────

describe('T13: persistence boundary — persistSynthesisResult', () => {
  it('T13.1a: persistSynthesisResult includes briefingScript in synthesis_summary content', () => {
    // The JSON.stringify block for synthesis_summary must include briefingScript
    // Find the synthesis_summary save block and verify briefingScript is in it
    const synthesisSaveBlock = extractSynthesisSummaryBlock(coordinatorSrc)
    expect(synthesisSaveBlock).toContain('briefingScript')
  })

  it('T13.1b: persistSynthesisResult includes semanticReview in synthesis_summary content', () => {
    const synthesisSaveBlock = extractSynthesisSummaryBlock(coordinatorSrc)
    expect(synthesisSaveBlock).toContain('semanticReview')
  })

  it('T13.1c: persistSynthesisResult includes gate1Report in synthesis_summary content', () => {
    const synthesisSaveBlock = extractSynthesisSummaryBlock(coordinatorSrc)
    expect(synthesisSaveBlock).toContain('gate1Report')
  })

  it('T13.1d: persistSynthesisResult persists FULL roleHistory with output to ArangoDB', () => {
    // The synthesis_summary's roleHistory must NOT strip .output
    // It should use state.roleHistory directly (or include output explicitly)
    const synthesisSaveBlock = extractSynthesisSummaryBlock(coordinatorSrc)

    // Must NOT have the stripped form: .map(r => ({ role: r.role, timestamp: r.timestamp }))
    // The old code strips output. The new code should include output.
    expect(synthesisSaveBlock).not.toMatch(
      /roleHistory:\s*state\.roleHistory\.map\(\s*r\s*=>\s*\(\{\s*role:\s*r\.role,\s*timestamp:\s*r\.timestamp\s*\}\)\s*\)/,
    )

    // Must include roleHistory (either directly or with output preserved)
    expect(synthesisSaveBlock).toContain('roleHistory')
  })
})

// ────────────────────────────────────────────────────────────
// T13.2: buildResult includes briefingScript/semanticReview
// ────────────────────────────────────────────────────────────

describe('T13: persistence boundary — buildResult', () => {
  it('T13.2a: buildResult includes briefingScript in the returned object', () => {
    const buildResultBlock = extractBuildResultBlock(coordinatorSrc)
    expect(buildResultBlock).toContain('briefingScript')
  })

  it('T13.2b: buildResult includes semanticReview in the returned object', () => {
    const buildResultBlock = extractBuildResultBlock(coordinatorSrc)
    expect(buildResultBlock).toContain('semanticReview')
  })

  it('T13.2c: buildResult uses nullish coalescing for briefingScript (backward compat)', () => {
    const buildResultBlock = extractBuildResultBlock(coordinatorSrc)
    // Should have briefingScript: state.briefingScript ?? undefined
    expect(buildResultBlock).toMatch(/briefingScript.*\?\?\s*undefined/)
  })

  it('T13.2d: buildResult uses nullish coalescing for semanticReview (backward compat)', () => {
    const buildResultBlock = extractBuildResultBlock(coordinatorSrc)
    // Should have semanticReview: state.semanticReview ?? undefined
    expect(buildResultBlock).toMatch(/semanticReview.*\?\?\s*undefined/)
  })

  it('T13.2e: buildResult strips output from roleHistory (return value stays lean)', () => {
    const buildResultBlock = extractBuildResultBlock(coordinatorSrc)
    // The return value should still strip .output for the caller
    // i.e., roleHistory: state.roleHistory.map(r => ({ role, tokenUsage, timestamp }))
    expect(buildResultBlock).toMatch(/roleHistory.*\.map/)
    // Confirm role, tokenUsage, timestamp are in the map
    expect(buildResultBlock).toMatch(/r\.role/)
    expect(buildResultBlock).toMatch(/r\.tokenUsage/)
    expect(buildResultBlock).toMatch(/r\.timestamp/)
  })
})

// ────────────────────────────────────────────────────────────
// T13.3: SynthesisResult interface has optional fields
// ────────────────────────────────────────────────────────────

describe('T13: persistence boundary — SynthesisResult interface', () => {
  it('T13.3a: SynthesisResult has optional briefingScript field', () => {
    const interfaceBlock = extractSynthesisResultInterface(coordinatorSrc)
    expect(interfaceBlock).toMatch(/briefingScript\?/)
  })

  it('T13.3b: SynthesisResult has optional semanticReview field', () => {
    const interfaceBlock = extractSynthesisResultInterface(coordinatorSrc)
    expect(interfaceBlock).toMatch(/semanticReview\?/)
  })
})

// ────────────────────────────────────────────────────────────
// Helpers — extract code blocks from source
// ────────────────────────────────────────────────────────────

/**
 * Extracts the synthesis_summary db.save block from persistSynthesisResult.
 * This is the block that writes type: 'synthesis_summary' to ArangoDB.
 */
function extractSynthesisSummaryBlock(src: string): string {
  // Find the persistSynthesisResult method
  const persistStart = src.indexOf('persistSynthesisResult')
  if (persistStart === -1) throw new Error('persistSynthesisResult not found in source')

  // Find the synthesis_summary save within that method
  const afterPersist = src.slice(persistStart)
  const summaryIdx = afterPersist.indexOf("'synthesis_summary'")
  if (summaryIdx === -1) throw new Error("synthesis_summary save not found in persistSynthesisResult")

  // Extract a generous block around it (up to next .catch or method end)
  const blockStart = summaryIdx
  const blockEnd = afterPersist.indexOf('.catch', summaryIdx)
  if (blockEnd === -1) return afterPersist.slice(blockStart)
  return afterPersist.slice(blockStart, blockEnd)
}

/**
 * Extracts the buildResult method body.
 */
function extractBuildResultBlock(src: string): string {
  const match = src.match(/private\s+buildResult\s*\([^)]*\):\s*SynthesisResult\s*\{/)
  if (!match || match.index === undefined) throw new Error('buildResult method not found in source')

  const startIdx = match.index
  // Find the matching closing brace by counting braces
  let depth = 0
  let foundOpen = false
  for (let i = startIdx; i < src.length; i++) {
    if (src[i] === '{') { depth++; foundOpen = true }
    if (src[i] === '}') { depth-- }
    if (foundOpen && depth === 0) {
      return src.slice(startIdx, i + 1)
    }
  }
  return src.slice(startIdx)
}

/**
 * Extracts the SynthesisResult interface block.
 */
function extractSynthesisResultInterface(src: string): string {
  const match = src.match(/export\s+interface\s+SynthesisResult\s*\{/)
  if (!match || match.index === undefined) throw new Error('SynthesisResult interface not found in source')

  const startIdx = match.index
  let depth = 0
  let foundOpen = false
  for (let i = startIdx; i < src.length; i++) {
    if (src[i] === '{') { depth++; foundOpen = true }
    if (src[i] === '}') { depth-- }
    if (foundOpen && depth === 0) {
      return src.slice(startIdx, i + 1)
    }
  }
  return src.slice(startIdx)
}
