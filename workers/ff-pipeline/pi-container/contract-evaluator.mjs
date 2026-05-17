/**
 * contract-evaluator.mjs — runs inside the pi Container to evaluate
 * `OutputContract[]` (see contract-types.mjs) against the workdir after pi
 * finishes (or after the deterministic pre-materialize shortcut for
 * exact_line). Pure I/O against the local filesystem — no network, no pi
 * RPC. The evaluator is invoked from server.mjs at three points:
 *
 *   1. After exact_line pre-materialize  (attempt: pre-prompt)
 *   2. After the initial pi prompt       (attempt: initial)
 *   3. After each repair pi prompt       (attempt: repair-N)
 *
 * The repair loop is bounded by `maxRepairRounds`; failed required artifacts
 * after the budget throws back to server.mjs as a hard error.
 *
 * Node-builtins only — the pi Container has no npm dependencies beyond pi
 * itself (see pi-container/package.json).
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * @typedef {import('./contract-types.mjs').OutputContract} OutputContract
 * @typedef {import('./contract-types.mjs').ContractBody}   ContractBody
 *
 * @typedef {{
 *   artifact: string,
 *   status: 'pass' | 'fail',
 *   kind: 'exact_line' | 'json' | 'markdown' | 'text',
 *   failureCode?: string,
 *   detail?: string,
 *   bytes?: number,
 * }} ContractFinding
 *
 * @typedef {{
 *   findings: ContractFinding[],
 *   missing: string[],
 *   contents: Record<string, string>,
 * }} EvaluationResult
 */

/**
 * Default contract used when the harness YAML declares an output but
 * supplies no `contract:` block. Mirrors NLAH's permissive default —
 * a non-empty text artifact — so existing harnesses (e.g. pi-smoke) keep
 * working unchanged.
 *
 * @param {string} artifactName
 * @returns {OutputContract}
 */
export function defaultContract(artifactName) {
  return {
    artifact: artifactName,
    required: true,
    body: { kind: 'text', nonEmpty: true },
  }
}

/**
 * Evaluate each contract against `workDir/<artifact>`. Returns ALL findings
 * (one per contract), the subset of required-failing artifact names, and
 * the raw contents of passing artifacts (consumed by server.mjs to build
 * the ContainerExecuteResponse.artifactContents map).
 *
 * Reads are best-effort: a missing file produces a `fail` finding rather
 * than a thrown error so the repair loop can act on it.
 *
 * @param {{ workDir: string, contracts: OutputContract[] }} args
 * @returns {Promise<EvaluationResult>}
 */
export async function evaluateContracts({ workDir, contracts }) {
  /** @type {ContractFinding[]} */
  const findings = []
  /** @type {Record<string, string>} */
  const contents = {}
  /** @type {string[]} */
  const missing = []

  for (const contract of contracts) {
    const finding = await evaluateOne(workDir, contract, contents)
    findings.push(finding)
    if (finding.status === 'fail' && contract.required === true) {
      missing.push(contract.artifact)
    }
  }

  return { findings, missing, contents }
}

/**
 * @param {string} workDir
 * @param {OutputContract} contract
 * @param {Record<string, string>} contents  Mutated when finding passes.
 * @returns {Promise<ContractFinding>}
 */
async function evaluateOne(workDir, contract, contents) {
  const { artifact, body } = contract
  const kind = body.kind

  /** @type {string | undefined} */
  let body_text
  try {
    body_text = await readFile(join(workDir, artifact), 'utf8')
  } catch {
    // File-not-found is encoded as kind-appropriate failure codes below
    // rather than a generic 'missing' so the repair prompt stays useful.
  }

  if (kind === 'exact_line') {
    if (body_text === undefined) {
      return { artifact, status: 'fail', kind, failureCode: 'exact_line_mismatch', detail: 'file not found' }
    }
    const stripped = body_text.endsWith('\n') ? body_text.slice(0, -1) : body_text
    if (stripped !== body.line) {
      return {
        artifact,
        status: 'fail',
        kind,
        failureCode: 'exact_line_mismatch',
        detail: `expected exactly: ${JSON.stringify(body.line)}`,
        bytes: Buffer.byteLength(body_text, 'utf8'),
      }
    }
    contents[artifact] = body_text
    return { artifact, status: 'pass', kind, bytes: Buffer.byteLength(body_text, 'utf8') }
  }

  if (kind === 'text') {
    if (body_text === undefined) {
      return { artifact, status: 'fail', kind, failureCode: 'empty', detail: 'file not found' }
    }
    if (body.nonEmpty !== false && body_text.trim().length === 0) {
      return { artifact, status: 'fail', kind, failureCode: 'empty', detail: 'whitespace-only or empty', bytes: 0 }
    }
    const missingPatterns = findMissingPatterns(body_text, body.requiredPatterns)
    if (missingPatterns.length > 0) {
      return {
        artifact,
        status: 'fail',
        kind,
        failureCode: 'missing_pattern',
        detail: `patterns: ${missingPatterns.join(', ')}`,
        bytes: Buffer.byteLength(body_text, 'utf8'),
      }
    }
    contents[artifact] = body_text
    return { artifact, status: 'pass', kind, bytes: Buffer.byteLength(body_text, 'utf8') }
  }

  if (kind === 'json') {
    if (body_text === undefined) {
      return { artifact, status: 'fail', kind, failureCode: 'invalid_json', detail: 'file not found' }
    }
    /** @type {unknown} */
    let parsed
    try {
      parsed = JSON.parse(body_text)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        artifact,
        status: 'fail',
        kind,
        failureCode: 'invalid_json',
        detail: msg,
        bytes: Buffer.byteLength(body_text, 'utf8'),
      }
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        artifact,
        status: 'fail',
        kind,
        failureCode: 'invalid_json',
        detail: 'top-level value must be a non-null, non-array object',
        bytes: Buffer.byteLength(body_text, 'utf8'),
      }
    }
    const obj = /** @type {Record<string, unknown>} */ (parsed)
    if (body.requiredFields && body.requiredFields.length > 0) {
      const missingFields = body.requiredFields.filter(
        (f) => !(f in obj) || obj[f] === null || obj[f] === undefined,
      )
      if (missingFields.length > 0) {
        return {
          artifact,
          status: 'fail',
          kind,
          failureCode: 'missing_field',
          detail: `fields: ${missingFields.join(', ')}`,
          bytes: Buffer.byteLength(body_text, 'utf8'),
        }
      }
    }
    contents[artifact] = body_text
    return { artifact, status: 'pass', kind, bytes: Buffer.byteLength(body_text, 'utf8') }
  }

  if (kind === 'markdown') {
    if (body_text === undefined) {
      return { artifact, status: 'fail', kind, failureCode: 'empty', detail: 'file not found' }
    }
    if (body_text.trim().length === 0) {
      return { artifact, status: 'fail', kind, failureCode: 'empty', detail: 'whitespace-only or empty', bytes: 0 }
    }
    const missingSections = findMissingSections(body_text, body.requiredSections)
    if (missingSections.length > 0) {
      return {
        artifact,
        status: 'fail',
        kind,
        failureCode: 'missing_section',
        detail: `sections: ${missingSections.join(', ')}`,
        bytes: Buffer.byteLength(body_text, 'utf8'),
      }
    }
    const missingPatterns = findMissingPatterns(body_text, body.requiredPatterns)
    if (missingPatterns.length > 0) {
      return {
        artifact,
        status: 'fail',
        kind,
        failureCode: 'missing_pattern',
        detail: `patterns: ${missingPatterns.join(', ')}`,
        bytes: Buffer.byteLength(body_text, 'utf8'),
      }
    }
    contents[artifact] = body_text
    return { artifact, status: 'pass', kind, bytes: Buffer.byteLength(body_text, 'utf8') }
  }

  // Defensive — unknown kind. server.mjs filters via isOutputContract before
  // calling, but we keep this branch so callers that bypass the validator
  // still get a structured failure.
  return {
    artifact,
    status: 'fail',
    kind: /** @type {ContractFinding['kind']} */ (/** @type {unknown} */ (kind)),
    failureCode: 'unknown_kind',
    detail: `unsupported contract kind: ${String(kind)}`,
  }
}

/**
 * @param {string} body_text
 * @param {string[] | undefined} patterns
 * @returns {string[]}
 */
function findMissingPatterns(body_text, patterns) {
  if (!patterns || patterns.length === 0) return []
  /** @type {string[]} */
  const out = []
  for (const p of patterns) {
    try {
      const re = new RegExp(p, 'im')
      if (!re.test(body_text)) out.push(p)
    } catch {
      // An unparseable pattern counts as missing — better to surface as a
      // failure than silently pass the artifact.
      out.push(p)
    }
  }
  return out
}

/**
 * @param {string} body_text
 * @param {string[] | undefined} sections
 * @returns {string[]}
 */
function findMissingSections(body_text, sections) {
  if (!sections || sections.length === 0) return []
  /** @type {string[]} */
  const out = []
  for (const heading of sections) {
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`^#{1,6}\\s+${escaped}\\s*$`, 'm')
    if (!re.test(body_text)) out.push(heading)
  }
  return out
}

/**
 * Build the prompt sent to pi when one or more required artifacts failed
 * their contract. Lists every failing finding with its artifact name, kind,
 * failureCode, and detail; instructs pi to fix and write files without
 * summarizing.
 *
 * Passing findings are intentionally omitted — they don't need attention.
 *
 * @param {ContractFinding[]} findings
 * @returns {string}
 */
export function buildContractRepairPrompt(findings) {
  const failing = findings.filter((f) => f.status === 'fail')
  const lines = []
  lines.push('Your previous output failed the artifact contract check.')
  lines.push('')
  if (failing.length === 0) {
    lines.push('Re-check every declared output file and ensure each one exists, is non-empty, and matches its contract.')
  } else {
    lines.push('Fix each failure below. Write the corrected file(s) to disk directly.')
    lines.push('Do not summarize the work in chat — the file contents are the only thing that counts.')
    lines.push('')
    for (const f of failing) {
      const parts = [
        `- artifact \`${f.artifact}\` (kind: ${f.kind})`,
        `    failureCode: ${f.failureCode ?? 'unknown'}`,
      ]
      if (f.detail) parts.push(`    detail: ${f.detail}`)
      lines.push(parts.join('\n'))
    }
  }
  lines.push('')
  lines.push('After every file is written, finish normally.')
  return lines.join('\n')
}
