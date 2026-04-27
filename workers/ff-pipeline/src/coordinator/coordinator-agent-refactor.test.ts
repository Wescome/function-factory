/**
 * T9: SynthesisCoordinator Agent refactor tests — TDD.
 *
 * Strategy: Since coordinator.ts imports from 'cloudflare:workers' (via Agent
 * from 'agents' -> partyserver -> cloudflare:workers), we cannot import the
 * class directly in vitest. Instead we:
 *
 * 1. Verify the source code structure (import, extends, decorator) via text
 * 2. Verify typecheck passes (tsc --noEmit)
 * 3. Verify the graph-layer integration tests still pass unchanged
 * 4. Verify the agents SDK has the APIs we depend on
 *
 * This is the correct approach: the coordinator is a DO class that can only
 * be fully instantiated inside the Workers runtime. The tests that exercise
 * its logic (graph, deps, roles) already exist and do NOT import the
 * coordinator class.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const coordinatorSrc = readFileSync(
  resolve(__dirname, './coordinator.ts'),
  'utf-8',
)

// ────────────────────────────────────────────────────────────
// T9.1: SynthesisCoordinator extends Agent
// ────────────────────────────────────────────────────────────

describe('T9: coordinator source structure', () => {
  it('imports Agent from agents SDK', () => {
    expect(coordinatorSrc).toMatch(/import\s*\{[^}]*Agent[^}]*\}\s*from\s*['"]agents['"]/)
  })

  it('extends Agent<CoordinatorEnv> (not DurableObject)', () => {
    expect(coordinatorSrc).toMatch(/class\s+SynthesisCoordinator\s+extends\s+Agent<CoordinatorEnv>/)
    expect(coordinatorSrc).not.toMatch(/class\s+SynthesisCoordinator\s+extends\s+DurableObject/)
  })

  it('does NOT import DurableObject from cloudflare:workers', () => {
    // Agent from 'agents' extends DurableObject internally.
    // The coordinator should no longer import DurableObject directly.
    expect(coordinatorSrc).not.toMatch(/import\s*\{[^}]*DurableObject[^}]*\}\s*from\s*['"]cloudflare:workers['"]/)
  })
})

// ────────────────────────────────────────────────────────────
// T9.2: @callable decorator on synthesize()
// ────────────────────────────────────────────────────────────

describe('T9: @callable on synthesize()', () => {
  it('imports callable from agents SDK', () => {
    expect(coordinatorSrc).toMatch(/import\s*\{[^}]*callable[^}]*\}\s*from\s*['"]agents['"]/)
  })

  it('applies @callable() decorator to synthesize method', () => {
    // Look for @callable() immediately before the synthesize method
    expect(coordinatorSrc).toMatch(/@callable\(\)\s*\n\s*async\s+synthesize\b/)
  })
})

// ────────────────────────────────────────────────────────────
// T9.3: runFiber wraps synthesis execution
// ────────────────────────────────────────────────────────────

describe('T9: runFiber crash recovery', () => {
  it('uses this.runFiber() in the synthesize method', () => {
    // The synthesis loop should be wrapped in runFiber for crash recovery
    expect(coordinatorSrc).toMatch(/this\.runFiber\(/)
  })

  it('runFiber is called with a fiber name containing the workGraphId', () => {
    // The fiber name should identify which workGraph is being synthesized
    expect(coordinatorSrc).toMatch(/this\.runFiber\(\s*`synth-\$\{workGraphId\}`/)
  })

  it('uses ctx.stash() for checkpointing state inside fiber', () => {
    // Instead of (or in addition to) ctx.storage.put for graphState,
    // the fiber uses stash() for crash-recovery checkpoints
    expect(coordinatorSrc).toMatch(/\.stash\(/)
  })

  it('overrides onFiberRecovered for synthesis recovery', () => {
    // The coordinator should implement recovery logic for interrupted fibers
    expect(coordinatorSrc).toMatch(/override\s+async\s+onFiberRecovered\b/)
  })
})

// ────────────────────────────────────────────────────────────
// T9.4: fetch() handler preserved as fallback
// ────────────────────────────────────────────────────────────

describe('T9: backward compat — fetch handler preserved', () => {
  it('still has a fetch() override for /synthesize endpoint', () => {
    expect(coordinatorSrc).toMatch(/override\s+async\s+fetch\(/)
    expect(coordinatorSrc).toMatch(/\/synthesize/)
  })

  it('still has an alarm() override for wall-clock timeout', () => {
    expect(coordinatorSrc).toMatch(/override\s+async\s+alarm\(/)
  })

  it('exports CoordinatorEnv interface', () => {
    expect(coordinatorSrc).toMatch(/export\s+interface\s+CoordinatorEnv/)
  })

  it('exports SynthesisResult interface', () => {
    expect(coordinatorSrc).toMatch(/export\s+interface\s+SynthesisResult/)
  })
})
