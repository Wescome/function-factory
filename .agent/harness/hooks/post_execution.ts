/**
 * Post-execution hook.
 *
 * Runs AFTER every action. Writes a structured entry to episodic memory
 * with lineage IDs, pain score, importance, and reflection.
 *
 * Every significant action the conductor takes must pass through this
 * hook. Untracked actions break the lineage contract.
 */

import { appendFileSync } from "node:fs"

const EPISODIC_PATH = ".agent/memory/episodic/AGENT_LEARNINGS.jsonl"

export interface Lineage {
  pressures?: string[]
  capabilities?: string[]
  functions?: string[]
  prds?: string[]
  workgraphs?: string[]
  invariants?: string[]
  coverage_reports?: string[]
}

export interface ExecutionLog {
  skill: string
  action: string
  result: string
  success: boolean
  reflection?: string
  context?: string
  lineage?: Lineage
  painScore?: number
  importance?: number
}

export default function logExecution(log: ExecutionLog): void {
  const painScore = log.painScore ?? (log.success ? 2 : 7)
  const importance = log.importance ?? 5

  const entry = {
    timestamp: new Date().toISOString(),
    skill: log.skill,
    action: log.action.slice(0, 200),
    result: log.success ? "success" : "failure",
    detail: log.result.slice(0, 500),
    pain_score: painScore,
    importance,
    reflection: log.reflection ?? "",
    context: (log.context ?? "").slice(0, 300),
    lineage: log.lineage ?? {},
  }

  appendFileSync(EPISODIC_PATH, JSON.stringify(entry) + "\n")
}
