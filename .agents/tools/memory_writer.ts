/**
 * Memory writer helper.
 *
 * Thin wrapper around the three memory hooks so callers don't reconstruct
 * the JSONL schema inline. Keeps episodic writes consistent across
 * skills.
 */

import logExecution, { type ExecutionLog, type Lineage } from "../harness/hooks/post_execution"
import onFailure, { type FailureInput } from "../harness/hooks/on_failure"

export function recordSuccess(
  skill: string,
  action: string,
  result: string,
  lineage?: Lineage,
  options?: { importance?: number; painScore?: number; reflection?: string; context?: string }
): void {
  const log: ExecutionLog = {
    skill,
    action,
    result,
    success: true,
    lineage,
    ...options,
  }
  logExecution(log)
}

export function recordFailure(
  skill: string,
  action: string,
  error: Error | string,
  lineage?: Lineage,
  context?: string
): { flaggedForRewrite: boolean; recentFailures: number } {
  const f: FailureInput = { skill, action, error, lineage, context }
  return onFailure(f)
}

export function recordDecision(
  skill: string,
  decision: string,
  rationale: string,
  lineage?: Lineage
): void {
  logExecution({
    skill,
    action: `DECISION: ${decision}`,
    result: rationale,
    success: true,
    painScore: 3,
    importance: 8,
    reflection: `Decision: ${decision}. Rationale: ${rationale}`,
    lineage,
  })
}

export function recordUncertainty(
  skill: string,
  question: string,
  context: string,
  lineage?: Lineage
): void {
  logExecution({
    skill,
    action: `UNCERTAIN: ${question}`,
    result: "halted for clarification",
    success: false,
    painScore: 6,
    importance: 7,
    reflection: `Uncertainty surfaced: ${question}. Context: ${context}`,
    lineage,
  })
}
