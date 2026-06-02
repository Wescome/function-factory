/**
 * Gas City pi-rpc → PI container execute bridge normalization.
 *
 * Implements IS-GC-RUNTIME-PROVIDER-CONTRACT AC-PI1/AC-PI4: the Gas City pi-rpc
 * HarnessProvider posts an execution request to POST /__pi-container/execute on
 * this Worker. The body may already be a WorkerInput (the Gas City Go provider
 * applies the AC-PI1 field renames before posting) or an AC-RQ1 execution
 * request envelope (snake_case). Either shape is normalized to a WorkerInput so
 * the PI container DO sees runId/stageName at the top level (readRunRequestMeta
 * requires both). Fails closed when neither can be resolved.
 */

/** WorkerInput is the shape the PI container server.mjs handleExecute expects. */
export interface WorkerInput {
  stageName: string
  roleName: string
  runId: string
  context: { inputArtifacts: Record<string, unknown>; taskText?: string; contextRefs?: Record<string, unknown> }
  declaredOutputs: unknown[]
  outputContracts?: Array<{ artifact: string; kind: string }>
  model?: { id: string }
  modelCandidates?: unknown[]
  maxRepairRounds?: number
  executionSurface?: string
  [key: string]: unknown
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/**
 * normalizePiContainerExecuteInput accepts either a WorkerInput (camelCase) or
 * an AC-RQ1 execution request envelope (snake_case) and returns a WorkerInput.
 * Returns null when neither a step/stage name nor a session/run id can be
 * resolved (fail closed — the DO requires both, AC-FC-style precondition).
 */
export function normalizePiContainerExecuteInput(
  body: Record<string, unknown>,
): WorkerInput | null {
  const stageName = str(body.stageName) || str(body.step_name)
  const runId = str(body.runId) || str(body.session_id)
  if (!stageName || !runId) return null

  // Pass through when already WorkerInput-shaped.
  if (typeof body.stageName === 'string' && typeof body.runId === 'string') {
    return body as WorkerInput
  }

  // Translate the AC-RQ1 envelope (snake_case) → WorkerInput (AC-PI1).
  const roleName = str(body.role_name) || str(body.roleName) || 'Agent'
  const inputs = body.inputs && typeof body.inputs === 'object' ? (body.inputs as Record<string, unknown>) : {}
  const declaredOutputs = Array.isArray(body.declared_outputs)
    ? body.declared_outputs
    : Array.isArray(body.declaredOutputs)
      ? body.declaredOutputs
      : []
  const verifier =
    body.verifier_contract && typeof body.verifier_contract === 'object'
      ? (body.verifier_contract as Record<string, unknown>)
      : null
  const outputContracts =
    verifier && Array.isArray(verifier.declared_output_match)
      ? (verifier.declared_output_match as Array<Record<string, unknown>>).map((rule) => ({
          artifact: str(rule.artifact),
          kind: str(rule.kind),
        }))
      : undefined
  const runtimeConfig =
    body.runtime_config && typeof body.runtime_config === 'object'
      ? (body.runtime_config as Record<string, unknown>)
      : {}
  const contextRefs =
    body.context_refs && typeof body.context_refs === 'object'
      ? (body.context_refs as Record<string, unknown>)
      : {}
  const taskText = str(body.purpose)

  const workerInput: WorkerInput = {
    stageName,
    roleName,
    runId,
    context: { inputArtifacts: inputs, ...(taskText ? { taskText } : {}), contextRefs },
    declaredOutputs,
  }
  if (outputContracts) workerInput.outputContracts = outputContracts
  if (typeof runtimeConfig.model_route === 'string') workerInput.model = { id: runtimeConfig.model_route }
  if (Array.isArray(runtimeConfig.model_candidates)) workerInput.modelCandidates = runtimeConfig.model_candidates
  if (typeof runtimeConfig.max_repair_rounds === 'number') workerInput.maxRepairRounds = runtimeConfig.max_repair_rounds
  if (typeof runtimeConfig.execution_surface === 'string') workerInput.executionSurface = runtimeConfig.execution_surface
  return workerInput
}
