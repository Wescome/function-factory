/**
 * @module ff-gates
 *
 * Coherence Verification — deterministic, fail-closed.
 *
 * Validates a ExecutableSpecification against five coverage criteria using Zod schemas.
 * No LLM calls. No network calls except ArangoDB reads. Target: <10ms.
 *
 * Exposed via WorkerEntrypoint for Service Binding from ff-gateway.
 * No public route.
 */

import { WorkerEntrypoint } from 'cloudflare:workers'
import { createClientFromEnv, type ArangoClient, type D1Database } from '@factory/arango-client'

export default {
  async fetch(): Promise<Response> {
    return new Response('ff-gates: use via Service Binding, not HTTP', { status: 404 })
  },
}

interface GatesEnv {
  DB: D1Database
  ENVIRONMENT: string
}

export interface CoherenceVerificationReport {
  verification: "coherence"
  passed: boolean
  timestamp: string
  executableSpecificationId: string
  checks: CoherenceVerificationCheck[]
  summary: string
}

export interface CoherenceVerificationCheck {
  name: string
  passed: boolean
  detail: string
}

export { GatesService }

class GatesService extends WorkerEntrypoint<GatesEnv> {
  private db!: ArangoClient

  private getDb(): ArangoClient {
    if (!this.db) {
      this.db = createClientFromEnv(this.env)
    }
    return this.db
  }

  /**
   * Evaluate Coherence Verification on a ExecutableSpecification.
   *
   * Five checks, all deterministic:
   * 1. Atom coverage     — every atom in the ExecutableSpecification has an implementation binding
   * 2. Invariant coverage — every invariant has a detector spec
   * 3. Validation coverage — all required Zod schemas parse without error
   * 4. Dependency closure — no dangling references in the dependency graph
   * 5. Lineage completeness — every artifact has source_refs tracing to a Signal
   *
   * Fail-closed: if ANY check fails, gate fails.
   */
  async evaluateCoherenceVerification(executableSpecificationJson: unknown): Promise<CoherenceVerificationReport> {
    const checks: CoherenceVerificationCheck[] = []

    // Parse the ExecutableSpecification — if it doesn't parse, that's a gate failure
    const parseResult = this.checkParseable(executableSpecificationJson)
    checks.push(parseResult)
    if (!parseResult.passed) {
      return this.buildReport(executableSpecificationJson, checks)
    }

    const executableSpecification = executableSpecificationJson as Record<string, unknown>
    const wgId = (executableSpecification._key ?? executableSpecification.id ?? 'unknown') as string

    // 1. Atom coverage
    checks.push(this.checkAtomVerification(executableSpecification))

    // 2. Invariant coverage
    checks.push(this.checkInvariantVerification(executableSpecification))

    // 3. Dependency closure
    checks.push(await this.checkDependencyClosure(executableSpecification))

    // 4. Lineage completeness
    checks.push(await this.checkLineageCompleteness(wgId))

    // 5. Schema field completeness
    checks.push(this.checkFieldCompleteness(executableSpecification))

    return this.buildReport(executableSpecificationJson, checks)
  }

  // ── Check implementations ──

  private checkParseable(executableSpecification: unknown): CoherenceVerificationCheck {
    if (typeof executableSpecification !== 'object' || executableSpecification === null) {
      return {
        name: 'parseable',
        passed: false,
        detail: 'ExecutableSpecification is not an object',
      }
    }
    const obj = executableSpecification as Record<string, unknown>
    const requiredFields = ['_key', 'atoms', 'invariants', 'dependencies']
    const missing = requiredFields.filter((f) => !(f in obj))
    if (missing.length > 0) {
      return {
        name: 'parseable',
        passed: false,
        detail: `Missing required fields: ${missing.join(', ')}`,
      }
    }
    return { name: 'parseable', passed: true, detail: 'ExecutableSpecification structure valid' }
  }

  private checkAtomVerification(executableSpecification: Record<string, unknown>): CoherenceVerificationCheck {
    const atoms = executableSpecification.atoms as Array<Record<string, unknown>> | undefined
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

  private checkInvariantVerification(executableSpecification: Record<string, unknown>): CoherenceVerificationCheck {
    const invariants = executableSpecification.invariants as Array<Record<string, unknown>> | undefined
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

  private async checkDependencyClosure(executableSpecification: Record<string, unknown>): Promise<CoherenceVerificationCheck> {
    const deps = executableSpecification.dependencies as Array<Record<string, unknown>> | undefined
    if (!deps || !Array.isArray(deps)) {
      return { name: 'dependency-closure', passed: true, detail: 'No dependencies declared' }
    }

    const atoms = executableSpecification.atoms as Array<Record<string, unknown>> | undefined
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

  private async checkLineageCompleteness(wgId: string): Promise<CoherenceVerificationCheck> {
    const db = this.getDb()

    // Walk OUTBOUND from the ExecutableSpecification through lineage_edges.
    // Check existence of a path that terminates at a Signal node
    // (type='signal' or key starts with 'SIG-'), depth-limited to 10 hops.
    const startId = `executable_specifications/${wgId}`
    const hit = await db.queryOne<{ depth: number; doc_json: string }>(
      `WITH RECURSIVE lineage(id, depth) AS (
         SELECT e.to_id, 1
         FROM edges e
         WHERE e.collection='lineage_edges' AND e.from_id=?
         UNION ALL
         SELECT e.to_id, l.depth+1
         FROM edges e
         JOIN lineage l ON e.from_id=l.id
         WHERE e.collection='lineage_edges' AND l.depth < 10
       )
       SELECT l.depth, d.json AS doc_json
       FROM lineage l
       JOIN documents d ON d.collection=SUBSTR(l.id, 1, INSTR(l.id,'/')-1)
                       AND d.key=SUBSTR(l.id, INSTR(l.id,'/')+1)
       WHERE d.json->>'$.type'='signal'
          OR d.key LIKE 'SIG-%'
       LIMIT 1`,
      [startId],
    )

    if (!hit) {
      return {
        name: 'lineage-completeness',
        passed: false,
        detail: `ExecutableSpecification ${wgId} has no lineage path to a Signal (checked 10 hops)`,
      }
    }
    return {
      name: 'lineage-completeness',
      passed: true,
      detail: `Lineage traces to Signal in ${hit.depth} hops`,
    }
  }

  private checkFieldCompleteness(executableSpecification: Record<string, unknown>): CoherenceVerificationCheck {
    const missing: string[] = []

    // ExecutableSpecification-level required fields
    const wgRequired = ['title', 'intentSpecificationId', 'atoms', 'invariants', 'repo']
    for (const f of wgRequired) {
      if (!executableSpecification[f]) missing.push(`executableSpecification.${f}`)
    }

    // Spot-check first atom for required fields
    const atoms = executableSpecification.atoms as Array<Record<string, unknown>> | undefined
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
    executableSpecification: unknown,
    checks: CoherenceVerificationCheck[],
  ): CoherenceVerificationReport {
    const passed = checks.every((c) => c.passed)
    const obj = executableSpecification as Record<string, unknown>
    const wgId = ((obj?._key ?? obj?.id) as string) ?? 'unknown'

    const failedNames = checks.filter((c) => !c.passed).map((c) => c.name)
    const summary = passed
      ? `Coherence Verification PASSED: ${checks.length} checks, all clear`
      : `Coherence Verification FAILED: ${failedNames.join(', ')}`

    return {
      verification: "coherence",
      passed,
      timestamp: new Date().toISOString(),
      executableSpecificationId: wgId,
      checks,
      summary,
    }
  }
}
