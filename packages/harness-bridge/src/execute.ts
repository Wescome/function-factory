/**
 * harness_execute- Stage 6 execution Function orchestrator.
 *
 * Pure-plan / adapter-dispatch discipline per PRD-META-HARNESS-EXECUTE.
 * Consumes a WorkGraph, a named HarnessAdapter identifier, and optional
 * adapter configuration. Derives a deterministic dispatch plan. Invokes
 * the adapter per node. Records outcomes. Returns an in-memory
 * ExecutionLog — emission to disk is the caller's responsibility
 * (see emit.ts for the IO wrapper, parallel to coverage-gates' split).
 *
 * Fail-closed behaviors-
 *   - WorkGraph fails WorkGraph.safeParse -> throws before any adapter
 *     invocation.
 *   - Adapter identifier not registered -> ExecutionLog with summary
 *     status `adapter_unavailable`, zero nodes dispatched, rationale
 *     naming the identifier and the registry's known identifiers.
 *   - Per-node adapter throw -> status `failed`, rationale naming the
 *     thrown error's message. The harness does not retry, fall back,
 *     or roll back.
 *
 * Determinism- plan fields (nodeId ordering, adapterId, workGraphId)
 * are identical across invocations with identical inputs. Outcome
 * fields (status, outcome payload, timing) are not required to be
 * identical; runtime non-determinism is expected.
 */

import {
  ExecutionLog,
  type ExecutionNodeRecord,
  WorkGraph,
  type ArtifactId,
} from "@factory/schemas"
import { derivePlan } from "./plan.js"
import type { HarnessAdapter, HarnessAdapterRegistry } from "./types.js"

export interface HarnessExecuteInput {
  readonly workgraph: unknown
  readonly adapterId: string
  readonly adapterConfig?: Readonly<Record<string, unknown>>
  readonly registry: HarnessAdapterRegistry
  /** Injectable clock for deterministic testing. */
  readonly now?: () => Date
}

export interface HarnessExecuteResult {
  readonly log: ExecutionLog
}

function normalizeTimestamp(isoString: string): string {
  // Replace : and . in the timestamp with - so the ID string is safe
  // across filesystems and matches AC 5's hyphen-normalized convention.
  return isoString.replace(/:/g, "-").replace(/\./g, "-")
}

export async function harnessExecute(
  input: HarnessExecuteInput
): Promise<HarnessExecuteResult> {
  // Defensive schema check at the boundary (PRD AC 3). Upstream
  // validation is assumed but corrupted inputs must not slip past.
  const parsedWorkgraph = WorkGraph.safeParse(input.workgraph)
  if (!parsedWorkgraph.success) {
    throw new Error(
      `harnessExecute- WorkGraph schema validation failed- ${parsedWorkgraph.error.message}`
    )
  }
  const workgraph = parsedWorkgraph.data

  const now = input.now ?? (() => new Date())
  const invocationTimestamp = now().toISOString()
  const normalizedTs = normalizeTimestamp(invocationTimestamp)
  const logId = `EL-${workgraph.id}-${normalizedTs}`

  // Adapter resolution is the fail-closed boundary. A missing adapter
  // produces an ExecutionLog, never a thrown exception; absence of an
  // ExecutionLog would be ambiguous per AC 11.
  const adapter = input.registry.get(input.adapterId)
  if (!adapter) {
    const known = Array.from(input.registry.keys()).sort().join(", ")
    const log: ExecutionLog = ExecutionLog.parse({
      id: logId,
      source_refs: [workgraph.id] as ArtifactId[],
      explicitness: "explicit",
      rationale: `adapter ${input.adapterId} not registered; known- [${known}]`,
      workGraphId: workgraph.id,
      adapterId: input.adapterId,
      timestamp: invocationTimestamp,
      status: "adapter_unavailable",
      nodes: [],
    })
    return { log }
  }

  const plan = derivePlan(workgraph)
  const adapterConfig = input.adapterConfig ?? {}
  const nodeRecords: ExecutionNodeRecord[] = []

  for (const node of plan) {
    const startedAt = now().toISOString()
    try {
      const outcome = await adapter.execute(node, adapterConfig)
      const completedAt = now().toISOString()
      nodeRecords.push({
        nodeId: node.id,
        status: outcome.status,
        outcome: outcome.outcome,
        startedAt,
        completedAt,
        rationale: outcome.rationale,
      })
    } catch (err) {
      const completedAt = now().toISOString()
      const message = err instanceof Error ? err.message : String(err)
      nodeRecords.push({
        nodeId: node.id,
        status: "failed",
        startedAt,
        completedAt,
        rationale: `adapter ${adapter.id} threw on node ${node.id}- ${message}`,
      })
    }
  }

  // Summary status mechanically derived from per-node statuses (AC 9).
  // completed iff every node is completed or simulated; failed iff any
  // node is failed or unknown; partial iff mixed non-failure + skipped
  // but no failures. adapter_unavailable is handled on the early-return
  // path above.
  const summaryStatus = deriveSummaryStatus(nodeRecords)

  const log: ExecutionLog = ExecutionLog.parse({
    id: logId,
    source_refs: [workgraph.id] as ArtifactId[],
    explicitness: "explicit",
    rationale: `harness_execute dispatched ${nodeRecords.length} nodes via ${adapter.id} adapter`,
    workGraphId: workgraph.id,
    adapterId: input.adapterId,
    timestamp: invocationTimestamp,
    status: summaryStatus,
    nodes: nodeRecords,
  })
  return { log }
}

function deriveSummaryStatus(
  records: readonly ExecutionNodeRecord[]
): ExecutionLog["status"] {
  if (records.some((r) => r.status === "failed" || r.status === "unknown")) {
    return "failed"
  }
  const anyNonTerminal = records.some((r) => r.status === "skipped")
  if (anyNonTerminal) return "partial"
  // All remaining records are completed or simulated.
  return "completed"
}

export function registerAdapter(
  registry: Map<string, HarnessAdapter>,
  adapter: HarnessAdapter
): Map<string, HarnessAdapter> {
  registry.set(adapter.id, adapter)
  return registry
}
