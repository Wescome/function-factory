/**
 * Dream cycle.
 *
 * Runs nightly (via cron) or on explicit invocation. Compresses episodic
 * memory, promotes recurring patterns to semantic memory, archives stale
 * entries, and commits the result.
 *
 * Does NOT delete episodic entries; archives them to snapshots/. The raw
 * trace is the truth; compressed semantic memory is an interpretation
 * that can be regenerated.
 */

import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
} from "node:fs"
import { execSync } from "node:child_process"
import { join } from "node:path"

const EPISODIC = ".agent/memory/episodic/AGENT_LEARNINGS.jsonl"
const SEMANTIC_LESSONS = ".agent/memory/semantic/LESSONS.md"
const ARCHIVE_DIR = ".agent/memory/episodic/snapshots"
const WORKSPACE = ".agent/memory/working/WORKSPACE.md"

const DECAY_DAYS = 90
const PROMOTION_THRESHOLD = 7.0
const RECURRENCE_MIN = 2
const STALE_WORKSPACE_DAYS = 2

interface Entry {
  timestamp: string
  skill: string
  action: string
  result: string
  detail?: string
  pain_score?: number
  importance?: number
  recurrence_count?: number
  reflection?: string
  context?: string
  lineage?: Record<string, string[]>
}

function salience(e: Entry): number {
  const ageDays =
    (Date.now() - new Date(e.timestamp).getTime()) / (86400 * 1000)
  const pain = e.pain_score ?? 5
  const importance = e.importance ?? 5
  const recurrence = e.recurrence_count ?? 1
  return (
    (10 - ageDays * 0.3) *
    (pain / 10) *
    (importance / 10) *
    Math.min(recurrence, 3)
  )
}

function findRecurring(entries: Entry[]): Map<string, Entry> {
  const groups = new Map<string, Entry[]>()
  for (const e of entries) {
    const key = `${e.skill ?? "general"}::${(e.action ?? "").slice(0, 80)}`
    const arr = groups.get(key) ?? []
    arr.push(e)
    groups.set(key, arr)
  }
  const recurring = new Map<string, Entry>()
  for (const [key, group] of groups) {
    if (group.length >= RECURRENCE_MIN) {
      const best = group.reduce((a, b) => (salience(a) > salience(b) ? a : b))
      best.recurrence_count = group.length
      recurring.set(key, best)
    }
  }
  return recurring
}

function promote(entries: Entry[]): void {
  if (entries.length === 0) return
  const existing = existsSync(SEMANTIC_LESSONS)
    ? readFileSync(SEMANTIC_LESSONS, "utf-8")
    : ""
  const lines: string[] = []
  for (const e of entries) {
    const line = `- ${e.reflection ?? e.action ?? "unknown"}`
    if (!existing.includes(line)) lines.push(line)
  }
  if (lines.length === 0) return

  const header = `\n## Auto-promoted ${new Date().toISOString().slice(0, 10)}\n`
  appendFileSync(SEMANTIC_LESSONS, header + lines.join("\n") + "\n")
}

function archive(entries: Entry[]): void {
  if (entries.length === 0) return
  if (!existsSync(ARCHIVE_DIR)) mkdirSync(ARCHIVE_DIR, { recursive: true })
  const archivePath = join(
    ARCHIVE_DIR,
    `archive_${new Date().toISOString().slice(0, 10)}.jsonl`
  )
  for (const e of entries) {
    appendFileSync(archivePath, JSON.stringify(e) + "\n")
  }
}

export function runDreamCycle(): {
  promoted: number
  archived: number
  kept: number
} {
  if (!existsSync(EPISODIC)) {
    return { promoted: 0, archived: 0, kept: 0 }
  }
  const raw = readFileSync(EPISODIC, "utf-8")
  const entries: Entry[] = raw
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Entry)

  if (entries.length === 0) {
    return { promoted: 0, archived: 0, kept: 0 }
  }

  const recurring = findRecurring(entries)
  const promotable = [...recurring.values()].filter(
    (e) => salience(e) >= PROMOTION_THRESHOLD
  )
  promote(promotable)

  const cutoff = Date.now() - DECAY_DAYS * 86400 * 1000
  const kept: Entry[] = []
  const archived: Entry[] = []
  for (const e of entries) {
    const ts = new Date(e.timestamp).getTime()
    if (ts < cutoff && salience(e) < 2.0) archived.push(e)
    else kept.push(e)
  }
  archive(archived)

  writeFileSync(
    EPISODIC,
    kept.map((e) => JSON.stringify(e)).join("\n") + (kept.length ? "\n" : "")
  )

  // Archive stale workspace
  if (existsSync(WORKSPACE)) {
    const ageMs = Date.now() - statSync(WORKSPACE).mtime.getTime()
    if (ageMs > STALE_WORKSPACE_DAYS * 86400 * 1000) {
      const stalePath = join(
        ARCHIVE_DIR,
        `workspace_${new Date().toISOString().slice(0, 10)}.md`
      )
      renameSync(WORKSPACE, stalePath)
    }
  }

  try {
    execSync("git add .agent/memory/", { stdio: "ignore" })
    execSync(
      `git commit -m "META: dream cycle: promoted ${promotable.length}, decayed ${archived.length}, kept ${kept.length}"`,
      { stdio: "ignore" }
    )
  } catch {
    // non-fatal: repo may not be initialized yet or nothing to commit
  }

  return { promoted: promotable.length, archived: archived.length, kept: kept.length }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = runDreamCycle()
  console.log(
    `dream cycle: promoted ${r.promoted}, decayed ${r.archived}, kept ${r.kept}`
  )
}
