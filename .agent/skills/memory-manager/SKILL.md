---
name: memory-manager
version: 2026-04-18
triggers:
  - "reflect"
  - "what did I learn"
  - "compress memory"
  - "consolidate episodes"
  - "update memory"
  - "remember"
tools: [view, bash, create_file, str_replace]
preconditions:
  - ".agent/memory/episodic/AGENT_LEARNINGS.jsonl exists"
constraints:
  - "do not delete high-salience entries"
  - "do not merge personal into semantic"
  - "do not auto-promote entries without architect-seeded patterns or 3+ recurrences"
category: factory-core
---

# Memory Manager

Reads, scores, and consolidates memory entries across the four-layer memory
model. Triggered after every major task, on explicit reflect commands, and
nightly via `scripts/dream.ts`.

## What to do

### After every Function-level task
1. Append a structured entry to `.agent/memory/episodic/AGENT_LEARNINGS.jsonl`
   with: timestamp, skill, action, result, pain_score, importance, reflection,
   lineage (pressures / capabilities / functions / prds).
2. Update `.agent/memory/working/WORKSPACE.md` to reflect task completion.
3. If the task produced a DECISION-worthy outcome, draft a `DECISIONS.md`
   entry and surface it for architect review — do NOT auto-commit.

### Before important decisions
1. Read top 5 entries from `LESSONS.md` and `DECISIONS.md` by salience.
2. Read last 10 episodic entries tagged with the same Function ID or
   Capability ID as the current task.
3. If a past mistake pattern matches, surface it and halt for architect
   confirmation before proceeding.

### On explicit reflect
1. Pull 5 highest-salience entries from episodic memory.
2. Check for patterns: recurring failures, recurring successes, skill
   limits.
3. If a pattern recurs 3+ times with consistent context, propose a
   `LESSONS.md` entry. Do not auto-promote — surface the proposal for
   architect review.
4. If a skill file needs updating based on patterns, propose the edit via
   the skill's own self-rewrite hook.

### When context is getting full
1. Archive resolved working context to `episodic/snapshots/`.
2. Compress recent episodic entries older than 7 days if their salience
   has dropped below 2.0 after decay.
3. Commit: `META: memory-manager, {one-line reason}`

## Salience scoring

```
salience = (10 - age_days * 0.3)
         * (pain_score / 10)
         * (importance / 10)
         * min(recurrence_count, 3)
```

- Recent painful important recurring things float to the top.
- Old minor one-off things sink and eventually archive.

## Anti-patterns

- **Auto-promoting single-occurrence entries.** A one-off bad day is not
  a lesson. Wait for recurrence.
- **Merging personal into semantic.** Architect preferences are not
  general-purpose best practices. Keep them separate.
- **Deleting episodic entries.** Archive to `snapshots/`, never delete.
  The raw trace is the truth; compressed semantic memory is an
  interpretation.

## Self-rewrite hook

Every 10 reflections or on repeated mistakes:
1. If the same type of mistake appears 3+ times, the scoring or distillation
   approach needs adjustment.
2. Propose edits to this file's salience formula or anti-patterns.
3. Commit: `META: skill-update: memory-manager, {one-line reason}`
