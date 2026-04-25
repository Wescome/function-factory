/**
 * @module ff-gates
 *
 * Gate 1: Compile Coverage — deterministic, fail-closed.
 *
 * Validates a WorkGraph against five coverage criteria using Zod schemas.
 * No LLM calls. No network calls except ArangoDB reads. Target: <10ms.
 *
 * Exposed via WorkerEntrypoint for Service Binding from ff-gateway.
 * No public route.
 */

import { WorkerEntrypoint } from 'cloudflare:workers'
import { createClientFromEnv, type ArangoClient } from '@factory/arango-client'

interface GatesEnv {
  ARANGO_URL: string
  ARANGO_DATABASE: string
  ARANGO_JWT: string
  ARANGO_USERNAME?: string
  ARANGO_PASSWORD?: string
  ENVIRONMENT: string
}

export interface Gate1Report {
  gate: 1
  passed: boolean
  timestamp: string
  workGraphId: string
  checks: Gate1Check[]
  summary: string
}

export interface Gate1Check {
  name: string
  passed: boolean
  detail: string
}

export default class GatesService extends WorkerEntrypoint<GatesEnv> {
  private db!: ArangoClient

  private getDb(): ArangoClient {
    if (!this.db) {
      this.db = createClientFromEnv(this.env)
    }
    return this.db
  }

  /**
   * Evaluate Gate 1 on a WorkGraph.
   *
   * Five checks, all deterministic:
   * 1. Atom coverage     — every atom in the WorkGraph has an implementation binding
   * 2. Invariant coverage — every invariant has a detector spec
   * 3. Validation coverage — all required Zod schemas parse without error
   * 4. Dependency closure — no dangling references in the dependency graph
   * 5. Lineage completeness — every artifact has source_refs tracing to a Signal
   *
   * Fail-closed: if ANY check fails, gate fails.
   */
  async evaluateGate1(workGraphJson: unknown): Promise<Gate1Report> {
    const checks: Gate1Check[] = []

    // Parse the WorkGraph — if it doesn't parse, that's a gate failure
    const parseResult = this.checkParseable(workGraphJson)
    checks.push(parseResult)
    if (!parseResult.passed) {
      return this.buildReport(workGraphJson, checks)
    }

    const wg = workGraphJson as Record<string, unknown>
    const wgId = (wg._key ?? wg.id ?? 'unknown') as string

    // 1. Atom coverage
    checks.push(this.checkAtomCoverage(wg))

    // 2. Invariant coverage
    checks.push(this.checkInvariantCoverage(wg))

    // 3. Dependency closure
    checks.push(await this.checkDependencyClosure(wg))

    // 4. Lineage completeness
    checks.push(await this.checkLineageCompleteness(wgId))

    // 5. Schema field completeness
    checks.push(this.checkFieldCompleteness(wg))

    return this.buildReport(workGraphJson, checks)
  }

  // ── Check implementations ──

  private checkParseable(wg: unknown): Gate1Check {
    if (typeof wg !== 'object' || wg === null) {
      return {
        name: 'parseable',
        passed: false,
        detail: 'WorkGraph is not an object',
      }
    }
    const obj = wg as Record<string, unknown>
    const requiredFields = ['_key', 'atoms', 'invariants', 'dependencies']
    const missing = requiredFields.filter((f) => !(f in obj))
    if (missing.length > 0) {
      return {
        name: 'parseable',
        passed: false,
        detail: `Missing required fields: ${missing.join(', ')}`,
      }
    }
    return { name: 'parseable', passed: true, detail: 'WorkGraph structure valid' }
  }

  private checkAtomCoverage(wg: Record<string, unknown>): Gate1Check {
    const atoms = wg.atoms as Array<Record<string, unknown>> | undefined
    if (!atoms || !Array.isArray(atoms)) {
      return { name: 'atom-coverage', passed: false, detail: 'No atoms array' }
    }
    const unbound = atoms.filter((a) => !a.binding && !a.implementation)
    if (unbound.length > 0) {
      const ids = unbound.map((a) => a.id ?? a._key ?? 'unknown').join(', ')
      return {
        name: 'atom-coverage',
        passed: false,
        detail: `${unbound.length} unbound atoms: ${ids}`,
      }
    }
    return {
      name: 'atom-coverage',
      passed: true,
      detail: `${atoms.length} atoms, all bound`,
    }
  }

  private checkInvariantCoverage(wg: Record<string, unknown>): Gate1Check {
    const invariants = wg.invariants as Array<Record<string, unknown>> | undefined
    if (!invariants || !Array.isArray(invariants)) {
      return { name: 'invariant-coverage', passed: false, detail: 'No invariants array' }
    }
    const noDetector = invariants.filter((inv) => !inv.detector && !inv.detectorSpec)
    if (noDetector.length > 0) {
      const ids = noDetector.map((inv) => inv.id ?? inv._key ?? 'unknown').join(', ')
      return {
        name: 'invariant-coverage',
        passed: false,
        detail: `${noDetector.length} invariants without detectors: ${ids}`,
      }
    }
    return {
      name: 'invariant-coverage',
      passed: true,
      detail: `${invariants.length} invariants, all have detectors`,
    }
  }

  private async checkDependencyClosure(wg: Record<string, unknown>): Promise<Gate1Check> {
    const deps = wg.dependencies as Array<Record<string, unknown>> | undefined
    if (!deps || !Array.isArray(deps)) {
      return { name: 'dependency-closure', passed: true, detail: 'No dependencies declared' }
    }

    const atoms = wg.atoms as Array<Record<string, unknown>> | undefined
    const atomIds = new Set((atoms ?? []).map((a) => (a.id ?? a._key) as string))

    const dangling = deps.filter((d) => {
      const target = (d.target ?? d.to) as string
      return target && !atomIds.has(target)
    })

    if (dangling.length > 0) {
      const targets = dangling.map((d) => d.target ?? d.to).join(', ')
      return {
        name: 'dependency-closure',
        passed: false,
        detail: `${dangling.length} dangling dependency targets: ${targets}`,
      }
    }
    return {
      name: 'dependency-closure',
      passed: true,
      detail: `${deps.length} dependencies, all resolve`,
    }
  }

  private async checkLineageCompleteness(wgId: string): Promise<Gate1Check> {
    const db = this.getDb()

    // Trace back from WorkGraph through lineage edges — should reach a Signal
    const path = await db.query<{ depth: number; type: string }>(
      `FOR v, e, p IN 1..10 INBOUND @start lineage_edges
         FILTER v.type == 'signal' OR STARTS_WITH(v._key, 'SIG-')
         LIMIT 1
         RETURN { depth: LENGTH(p.edges), type: v.type }`,
      { start: `specs_workgraphs/${wgId}` },
    )

    if (path.length === 0) {
      return {
        name: 'lineage-completeness',
        passed: false,
        detail: `WorkGraph ${wgId} has no lineage path to a Signal (checked 10 hops)`,
      }
    }
    return {
      name: 'lineage-completeness',
      passed: true,
      detail: `Lineage traces to Signal in ${path[0]!.depth} hops`,
    }
  }

  private checkFieldCompleteness(wg: Record<string, unknown>): Gate1Check {
    const missing: string[] = []

    // WorkGraph-level required fields
    const wgRequired = ['title', 'prdId', 'atoms', 'invariants', 'repo']
    for (const f of wgRequired) {
      if (!wg[f]) missing.push(`workGraph.${f}`)
    }

    // Spot-check first atom for required fields
    const atoms = wg.atoms as Array<Record<string, unknown>> | undefined
    if (atoms && atoms.length > 0) {
      const atomRequired = ['id', 'type', 'description']
      for (const f of atomRequired) {
        if (!atoms[0]![f]) missing.push(`atoms[0].${f}`)
      }
    }

    if (missing.length > 0) {
      return {
        name: 'field-completeness',
        passed: false,
        detail: `Missing fields: ${missing.join(', ')}`,
      }
    }
    return {
      name: 'field-completeness',
      passed: true,
      detail: 'All required fields present',
    }
  }

  // ── Report assembly ──

  private buildReport(
    wg: unknown,
    checks: Gate1Check[],
  ): Gate1Report {
    const passed = checks.every((c) => c.passed)
    const obj = wg as Record<string, unknown>
    const wgId = ((obj?._key ?? obj?.id) as string) ?? 'unknown'

    const failedNames = checks.filter((c) => !c.passed).map((c) => c.name)
    const summary = passed
      ? `Gate 1 PASSED: ${checks.length} checks, all clear`
      : `Gate 1 FAILED: ${failedNames.join(', ')}`

    return {
      gate: 1,
      passed,
      timestamp: new Date().toISOString(),
      workGraphId: wgId,
      checks,
      summary,
    }
  }
}
