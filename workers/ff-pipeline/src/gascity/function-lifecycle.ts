export type FunctionState =
  | "proposed"
  | "specified"
  | "dispatched"
  | "accepted"
  | "rejected"
  | "retired"

export const ALLOWED_FUNCTION_TRANSITIONS: Record<FunctionState, FunctionState[]> = {
  proposed: ["specified", "retired"],
  specified: ["dispatched", "retired"],
  dispatched: ["accepted", "rejected", "retired"],
  accepted: ["retired"],
  rejected: ["retired"],
  retired: [],
}

export class FunctionLifecycleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "FunctionLifecycleError"
  }
}

export function isFunctionState(value: unknown): value is FunctionState {
  return typeof value === "string" && value in ALLOWED_FUNCTION_TRANSITIONS
}

export function assertFunctionTransition(from: FunctionState, to: FunctionState): void {
  if (!ALLOWED_FUNCTION_TRANSITIONS[from].includes(to)) {
    throw new FunctionLifecycleError(`Invalid Function state transition: ${from} -> ${to}`)
  }
}

interface LifecycleDb {
  update(collection: string, key: string, patch: Record<string, unknown>): Promise<unknown>
  saveEdge(collection: string, from: string, to: string, data: Record<string, unknown>): Promise<unknown>
}

export async function transitionFunctionState(
  db: LifecycleDb,
  input: {
    functionId: string
    from: FunctionState
    to: FunctionState
    evidenceKey: string
    trigger: string
    timestamp: string
  },
): Promise<{ from: FunctionState; to: FunctionState; evidenceKey: string }> {
  assertFunctionTransition(input.from, input.to)
  await db.update("specs_functions", input.functionId, {
    state: input.to,
    state_updated_at: input.timestamp,
    state_evidence_key: input.evidenceKey,
  })
  await db.saveEdge(
    "lifecycle_transitions",
    `specs_functions/${input.functionId}`,
    `specs_functions/${input.functionId}`,
    {
      from: input.from,
      to: input.to,
      trigger: input.trigger,
      evidence_key: input.evidenceKey,
      timestamp: input.timestamp,
    },
  )
  return { from: input.from, to: input.to, evidenceKey: input.evidenceKey }
}

