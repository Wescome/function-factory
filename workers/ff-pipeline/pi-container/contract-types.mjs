/**
 * contract-types.mjs — OutputContract union enforced inside the pi Container.
 *
 * Each `OutputContract` is the wire shape POSTed from the harness-dispatcher
 * Worker on `outputContracts[]`. The dispatcher derives them from the
 * NLAH `ArtifactSpec.contract` (see ../src/contract-compiler.ts), defaulting
 * to `{ kind: "text", nonEmpty: true }` when no contract is declared.
 *
 * The `exact_line` kind is Factory-specific (not in the upstream NLAH
 * schema) and is currently produced only via the compiler default-projection
 * path: dispatchers never emit it for upstream specs. server.mjs treats it
 * specially by issuing a deterministic bash pre-materialize before running
 * the prompt — this lets smoke harnesses pass without burning an LLM turn.
 *
 * @typedef {Object} ExactLineContract
 * @property {"exact_line"} kind
 * @property {string} line
 *
 * @typedef {Object} JsonContract
 * @property {"json"} kind
 * @property {string[]} [requiredFields]
 *
 * @typedef {Object} MarkdownContract
 * @property {"markdown"} kind
 * @property {string[]} [requiredSections]
 * @property {string[]} [requiredPatterns]
 *
 * @typedef {Object} TextContract
 * @property {"text"} kind
 * @property {boolean} [nonEmpty]
 * @property {string[]} [requiredPatterns]
 *
 * @typedef {ExactLineContract | JsonContract | MarkdownContract | TextContract} ContractBody
 *
 * @typedef {Object} OutputContract
 * @property {string} artifact
 * @property {boolean} required
 * @property {ContractBody} body
 */

export const KNOWN_KINDS = new Set(['exact_line', 'json', 'markdown', 'text'])

/**
 * Structural validator used to defend against malformed wire payloads.
 * The dispatcher always sends well-formed contracts, but server.mjs uses
 * this to fail loudly if a future caller posts garbage.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isOutputContract(value) {
  if (!value || typeof value !== 'object') return false
  const v = /** @type {Record<string, unknown>} */ (value)
  if (typeof v.artifact !== 'string' || v.artifact.length === 0) return false
  if (!v.body || typeof v.body !== 'object') return false
  const body = /** @type {Record<string, unknown>} */ (v.body)
  return typeof body.kind === 'string' && KNOWN_KINDS.has(body.kind)
}
