/**
 * Failure hook.
 *
 * Runs when any action fails. Adds structured failure context to episodic
 * memory with elevated pain_score, counts recent failures per skill, and
 * flags a skill for self-rewrite if it has failed 3+ times in the
 * configured window.
 */

import { readFileSync, appendFileSync, existsSync } from "node:fs"
import type { Lineage } from "./post_execution"

const EPISODIC_PATH = ".agent/memory/episodic/AGENT_LEARNINGS.jsonl"
const FAILURE_THRESHOLD = 3
const WINDOW_DAYS = 14

export interface FailureInput {
  skill: string
  action: string
  error: Error | string
  context?: string
  lineage?: Lineage
}

export default function onFailure(f: FailureInput): {
  flaggedForRewrite: boolean
  recentFailures: number
} {
  const errText =
    f.error instanceof Error
      ? `${f.error.name}: ${f.error.message}`
      : String(f.error)

  const recentFailures = countRecentFailures(f.skill)
  const shouldFlag = recentFailures + 1 >= FAILURE_THRESHOLD

  const entry = {
    timestamp: new Date().toISOString(),
    skill: f.skill,
    action: f.action.slice(0, 200),
    result: "failure",
    detail: errText.slice(0, 500),
    pain_score: shouldFlag ? 10 : 8,
    importance: 7,
    reflection: shouldFlag
      ? `FAILURE in ${f.skill}: ${errText.slice(0, 200)} | THIS SKILL HAS FAILED ${recentFailures + 1} TIMES IN ${WINDOW_DAYS}d. Flag for rewrite.`
      : `FAILURE in ${f.skill}: ${errText.slice(0, 200)}`,
    context: (f.context ?? "").slice(0, 300),
    lineage: f.lineage ?? {},
  }

  appendFileSync(EPISODIC_PATH, JSON.stringify(entry) + "\n")

  return {
    flaggedForRewrite: shouldFlag,
    recentFailures: recentFailures + 1,
  }
}

function countRecentFailures(skill: string): number {
  if (!existsSync(EPISODIC_PATH)) return 0
  const cutoff = Date.now() - WINDOW_DAYS * 86400 * 1000
  let count = 0
  const text = readFileSync(EPISODIC_PATH, "utf-8")
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line)
      if (
        e.skill === skill &&
        e.result === "failure" &&
        new Date(e.timestamp).getTime() > cutoff
      ) {
        count++
      }
    } catch {
      // ignore malformed lines
    }
  }
  return count
}
