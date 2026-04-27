# Current Workspace

## Status
Session ended at 2026-04-27T20:30:18.580Z. Auto-snapshot by WorkspaceSnapshot.hook.ts.

## Last update
2026-04-27T20:30:18.580Z

## Recent actions (last 4h from AGENT_LEARNINGS.jsonl)

- [20:20:15] Bash: sed -i '' "s/piAiRole/callModel-fallback/g" /Users/wes/Developer/function-factory/workers/ff-pipeline/src/coordinator/sa
- [20:20:23] Bash: grep -rn "piAiRole\|pi-ai\|pi_ai" /Users/wes/Developer/function-factory/workers/ff-pipeline/src/ --include="*.ts" | grep
- [20:20:29] Bash: find /Users/wes/Developer/function-factory/workers/ff-pipeline/src -name "*.test.ts" -exec sed -i '' "s/piAiRole/callMod
- [20:20:43] Edit: /Users/wes/Developer/function-factory/workers/ff-pipeline/src/coordinator/coordinator.ts
- [20:20:51] Bash: grep -n "falling back" /Users/wes/Developer/function-factory/workers/ff-pipeline/src/coordinator/sandbox-role.ts
- [20:21:05] Bash: sed -i '' "s/proposedBy: 'pi-ai'/proposedBy: 'gdk-ai'/" /Users/wes/Developer/function-factory/workers/ff-pipeline/src/st
- [20:21:12] Bash: grep -rn "falling back to callModel fallback" /Users/wes/Developer/function-factory/workers/ff-pipeline/src/ --include="
- [20:21:18] Bash: sed -i '' "s/falling back to callModel fallback/falling back to callModel/g" /Users/wes/Developer/function-factory/worke
- [20:21:30] Bash: pnpm --filter @factory/ff-pipeline test 2>&1 | tail -12
- [20:21:37] Bash: grep -rn "pi-sdk\|piAiRole\|pi-ai\|pi_ai\|pi-coding-agent\|@mariozechner\|'aider'" /Users/wes/Developer/function-factory
- [20:21:42] Bash: git add -A && git diff --cached --stat
- [20:21:51] Bash: git commit -m "$(cat <<'EOF'
META: purge stale executor/naming from pre-ADR era

- pi-sdk → gdk-agent (Plan.executorReco
- [20:21:59] Bash: git push origin main
- [20:25:31] Bash: grep -rn "LangGraph\|langgraph\|StateGraph\|graph-runner" /Users/wes/Developer/function-factory/workers/ff-pipeline/src/
- [20:28:18] Bash: ls /Users/wes/Developer/function-factory/specs/reference/ADR*
- [20:28:26] Bash: grep -n "checkpoint\|streaming\|interrupt\|fiber\|Fiber\|runFiber\|waitForEvent\|stash\|alarm\|step.do\|step.sleep" /Use
- [20:28:31] Bash: grep -n "waitForEvent\|step\.do\|step\.sleep\|sendEvent" /Users/wes/Developer/function-factory/workers/ff-pipeline/src/p
- [20:29:53] Write: /Users/wes/Developer/function-factory/specs/reference/ADR-004-custom-graph-runner-over-langgraph.md
- [20:30:01] Bash: git add specs/reference/ADR-004-custom-graph-runner-over-langgraph.md && git commit -m "$(cat <<'EOF'
META: ADR-004 — cu
- [20:30:09] Bash: git push origin main

## Notes
This file is auto-updated on session end. Manual edits will be overwritten.
Archive to `.agent/memory/episodic/snapshots/` if you need to preserve a specific state.
