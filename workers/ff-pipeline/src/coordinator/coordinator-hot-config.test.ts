/**
 * ADR-008: Hot-config wiring into SynthesisCoordinator — TDD tests.
 *
 * Since coordinator.ts imports from 'cloudflare:workers' (via Agent from 'agents'),
 * we verify source structure via text analysis (same pattern as coordinator-agent-refactor.test.ts).
 *
 * Tests verify:
 *   - HotConfigLoader is imported and instantiated
 *   - Agents receive aliasOverrides from hot config
 *   - Model overrides from hot-loaded routing
 *   - seedHotConfig called in synthesize flow
 *   - resolveAgentModel used with hot routing config
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const coordinatorSrc = readFileSync(
  resolve(__dirname, './coordinator.ts'),
  'utf-8',
)

// ── Agent sources (to verify they accept aliasOverrides) ──

const architectSrc = readFileSync(
  resolve(__dirname, '../agents/architect-agent.ts'),
  'utf-8',
)
const coderSrc = readFileSync(
  resolve(__dirname, '../agents/coder-agent.ts'),
  'utf-8',
)
const plannerSrc = readFileSync(
  resolve(__dirname, '../agents/planner-agent.ts'),
  'utf-8',
)
const testerSrc = readFileSync(
  resolve(__dirname, '../agents/tester-agent.ts'),
  'utf-8',
)
const verifierSrc = readFileSync(
  resolve(__dirname, '../agents/verifier-agent.ts'),
  'utf-8',
)
const criticSrc = readFileSync(
  resolve(__dirname, '../agents/critic-agent.ts'),
  'utf-8',
)
const resolveModelSrc = readFileSync(
  resolve(__dirname, '../agents/resolve-model.ts'),
  'utf-8',
)

// ────────────────────────────────────────────────────────────
// 1. Coordinator imports HotConfigLoader
// ────────────────────────────────────────────────────────────

describe('hot-config: coordinator imports', () => {
  it('imports HotConfigLoader from config/hot-config', () => {
    expect(coordinatorSrc).toMatch(/import\s*\{[^}]*HotConfigLoader[^}]*\}\s*from\s*['"]\.\.\/config\/hot-config['"]/)
  })

  it('imports seedHotConfig from config/hot-config', () => {
    expect(coordinatorSrc).toMatch(/import\s*\{[^}]*seedHotConfig[^}]*\}\s*from\s*['"]\.\.\/config\/hot-config['"]/)
  })

  it('imports resolveAgentModel from agents/resolve-model', () => {
    expect(coordinatorSrc).toMatch(/import\s*\{[^}]*resolveAgentModel[^}]*\}\s*from\s*['"]\.\.\/agents\/resolve-model['"]/)
  })
})

// ────────────────────────────────────────────────────────────
// 2. Coordinator has HotConfigLoader plumbing
// ────────────────────────────────────────────────────────────

describe('hot-config: coordinator plumbing', () => {
  it('has a configLoader private field', () => {
    expect(coordinatorSrc).toMatch(/private\s+configLoader/)
  })

  it('has a getConfigLoader method that creates HotConfigLoader', () => {
    expect(coordinatorSrc).toMatch(/getConfigLoader\(\)/)
    expect(coordinatorSrc).toMatch(/new\s+HotConfigLoader/)
  })

  it('has a configSeeded flag for one-time seed', () => {
    expect(coordinatorSrc).toMatch(/private\s+configSeeded/)
  })

  it('has ensureConfigSeeded method that calls seedHotConfig', () => {
    expect(coordinatorSrc).toMatch(/ensureConfigSeeded/)
    expect(coordinatorSrc).toMatch(/seedHotConfig/)
  })
})

// ────────────────────────────────────────────────────────────
// 3. synthesize() loads hot config before creating agents
// ────────────────────────────────────────────────────────────

describe('hot-config: synthesize() uses hot config', () => {
  it('calls ensureConfigSeeded in synthesize', () => {
    // ensureConfigSeeded should be called in synthesize or its fiber
    expect(coordinatorSrc).toMatch(/this\.ensureConfigSeeded\(\)/)
  })

  it('calls getConfigLoader().get() to load hot config', () => {
    expect(coordinatorSrc).toMatch(/this\.getConfigLoader\(\)\.get\(\)/)
  })

  it('uses resolveAgentModel with hotConfig.routing', () => {
    // The coordinator resolves models centrally with hot routing
    expect(coordinatorSrc).toMatch(/resolveAgentModel\(/)
    expect(coordinatorSrc).toMatch(/hotConfig\.routing/)
  })
})

// ────────────────────────────────────────────────────────────
// 4. Agents receive aliasOverrides in their opts
// ────────────────────────────────────────────────────────────

describe('hot-config: agents opts include aliasOverrides', () => {
  it('ArchitectAgentOpts has aliasOverrides field', () => {
    expect(architectSrc).toMatch(/aliasOverrides\??:\s*Record<string,\s*string\[\]>/)
  })

  it('CoderAgentOpts has aliasOverrides field', () => {
    expect(coderSrc).toMatch(/aliasOverrides\??:\s*Record<string,\s*string\[\]>/)
  })

  it('PlannerAgentOpts has aliasOverrides field', () => {
    expect(plannerSrc).toMatch(/aliasOverrides\??:\s*Record<string,\s*string\[\]>/)
  })

  it('TesterAgentOpts has aliasOverrides field', () => {
    expect(testerSrc).toMatch(/aliasOverrides\??:\s*Record<string,\s*string\[\]>/)
  })

  it('VerifierAgentOpts has aliasOverrides field', () => {
    expect(verifierSrc).toMatch(/aliasOverrides\??:\s*Record<string,\s*string\[\]>/)
  })

  it('CriticAgentOpts has aliasOverrides for both schemas', () => {
    // CriticAgent has two schemas (SemanticReview + CritiqueReport)
    expect(criticSrc).toMatch(/semanticReviewAliasOverrides\??:\s*Record<string,\s*string\[\]>/)
    expect(criticSrc).toMatch(/codeReviewAliasOverrides\??:\s*Record<string,\s*string\[\]>/)
  })
})

// ────────────────────────────────────────────────────────────
// 5. Agents pass aliasOverrides to processAgentOutput
// ────────────────────────────────────────────────────────────

describe('hot-config: agents pass aliasOverrides to ORL', () => {
  it('ArchitectAgent passes aliasOverrides to processAgentOutput', () => {
    expect(architectSrc).toMatch(/processAgentOutput\(.*BRIEFING_SCRIPT_SCHEMA.*aliasOverrides/s)
  })

  it('CoderAgent passes aliasOverrides to processAgentOutput', () => {
    expect(coderSrc).toMatch(/processAgentOutput\(.*CODE_ARTIFACT_SCHEMA.*aliasOverrides/s)
  })

  it('PlannerAgent passes aliasOverrides to processAgentOutput', () => {
    expect(plannerSrc).toMatch(/processAgentOutput\(.*PLAN_SCHEMA.*aliasOverrides/s)
  })

  it('TesterAgent passes aliasOverrides to processAgentOutput', () => {
    expect(testerSrc).toMatch(/processAgentOutput\(.*TEST_REPORT_SCHEMA.*aliasOverrides/s)
  })

  it('VerifierAgent passes aliasOverrides to processAgentOutput', () => {
    expect(verifierSrc).toMatch(/processAgentOutput\(.*VERDICT_SCHEMA.*aliasOverrides/s)
  })

  it('CriticAgent passes aliasOverrides for semantic review', () => {
    expect(criticSrc).toMatch(/processAgentOutput\(.*SEMANTIC_REVIEW_SCHEMA.*aliasOverrides/s)
  })

  it('CriticAgent passes aliasOverrides for code review', () => {
    expect(criticSrc).toMatch(/processAgentOutput\(.*CRITIQUE_REPORT_SCHEMA.*aliasOverrides/s)
  })
})

// ────────────────────────────────────────────────────────────
// 6. Coordinator passes aliasOverrides when constructing agents
// ────────────────────────────────────────────────────────────

describe('hot-config: coordinator passes overrides to agents', () => {
  it('passes aliasOverrides to ArchitectAgent (BriefingScript schema)', () => {
    expect(coordinatorSrc).toMatch(/new\s+ArchitectAgent\(\s*\{[^}]*aliasOverrides/)
  })

  it('passes aliasOverrides to CoderAgent (CodeArtifact schema)', () => {
    expect(coordinatorSrc).toMatch(/new\s+CoderAgent\(\s*\{[^}]*aliasOverrides/)
  })

  it('passes aliasOverrides to PlannerAgent (Plan schema)', () => {
    expect(coordinatorSrc).toMatch(/new\s+PlannerAgent\(\s*\{[^}]*aliasOverrides/)
  })

  it('passes aliasOverrides to TesterAgent (TestReport schema)', () => {
    expect(coordinatorSrc).toMatch(/new\s+TesterAgent\(\s*\{[^}]*aliasOverrides/)
  })

  it('passes aliasOverrides to VerifierAgent (Verdict schema)', () => {
    expect(coordinatorSrc).toMatch(/new\s+VerifierAgent\(\s*\{[^}]*aliasOverrides/)
  })

  it('passes both aliasOverrides to CriticAgent', () => {
    expect(coordinatorSrc).toMatch(/new\s+CriticAgent\(\s*\{[^}]*semanticReviewAliasOverrides/)
    expect(coordinatorSrc).toMatch(/new\s+CriticAgent\(\s*\{[^}]*codeReviewAliasOverrides/)
  })

  it('passes model override to each agent', () => {
    // Coordinator resolves models centrally and passes as overrides
    expect(coordinatorSrc).toMatch(/new\s+ArchitectAgent\(\s*\{[^}]*model:/)
    expect(coordinatorSrc).toMatch(/new\s+CoderAgent\(\s*\{[^}]*model:/)
    expect(coordinatorSrc).toMatch(/new\s+PlannerAgent\(\s*\{[^}]*model:/)
    expect(coordinatorSrc).toMatch(/new\s+TesterAgent\(\s*\{[^}]*model:/)
    expect(coordinatorSrc).toMatch(/new\s+VerifierAgent\(\s*\{[^}]*model:/)
    expect(coordinatorSrc).toMatch(/new\s+CriticAgent\(\s*\{[^}]*model:/)
  })
})

// ────────────────────────────────────────────────────────────
// 7. resolve-model accepts optional routing config
// ────────────────────────────────────────────────────────────

describe('hot-config: resolveAgentModel accepts routing config', () => {
  it('resolveAgentModel signature accepts optional routingConfig param', () => {
    expect(resolveModelSrc).toMatch(/resolveAgentModel\([^)]*routingConfig\??:\s*RoutingConfig/)
  })

  it('passes routingConfig to resolve() from task-routing', () => {
    expect(resolveModelSrc).toMatch(/resolve\([^)]*config:\s*routingConfig/)
  })
})
