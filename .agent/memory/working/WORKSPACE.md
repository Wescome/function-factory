# Current Workspace

## Status
Session ended at 2026-05-04T18:19:03.564Z. Auto-snapshot by WorkspaceSnapshot.hook.ts.

## Last update
2026-05-04T18:19:03.564Z

## Recent actions (last 4h from AGENT_LEARNINGS.jsonl)

- [18:11:30] Bash: curl -s "https://ff-gateway.koales.workers.dev/pipeline/0b046595-089f-4599-97a1-516d3d546369" 2>/dev/null | python3 -c "
- [18:11:31] Bash: curl -s "https://ff-gateway.koales.workers.dev/pipeline/57d30a2b-8b75-4983-a1ec-8123232a7ebc" 2>/dev/null | python3 -c "
- [18:12:26] Bash: for id in 0b046595-089f-4599-97a1-516d3d546369 57d30a2b-8b75-4983-a1ec-8123232a7ebc f848d60e-1e80-40a5-ab81-4f6fa88c5111
- [18:12:33] Bash: curl -s "https://ff-pipeline.koales.workers.dev/debug/pipeline?id=0b046595-089f-4599-97a1-516d3d546369" 2>/dev/null | py
- [18:12:35] Bash: curl -s "https://ff-pipeline.koales.workers.dev/debug/governor" 2>/dev/null | python3 -c "
import sys, json
d = json.loa
- [18:12:41] Bash: curl -s "https://ff-pipeline.koales.workers.dev/debug/crystallizer?signal=latest" 2>/dev/null | python3 -c "
import sys,
- [18:12:42] Bash: curl -s "https://ff-pipeline.koales.workers.dev/debug/queues" 2>/dev/null | python3 -c "
import sys, json
try:
  d = jso
- [18:12:52] Bash: curl -s "https://ff-gateway.koales.workers.dev/pipeline/0b046595-089f-4599-97a1-516d3d546369" 2>/dev/null | python3 -c "
- [18:13:00] Bash: grep -rn "signalType\|signal_type\|SignalType" /Users/wes/Developer/function-factory/workers/ff-gateway/src/ --include="
- [18:13:01] Bash: grep -rn "signalType\|required.*field" /Users/wes/Developer/function-factory/workers/ff-pipeline/src/ --include="*.ts" |
- [18:13:12] Bash: ID1=$(curl -s -X POST "https://ff-gateway.koales.workers.dev/pipeline" \
  -H "Content-Type: application/json" \
  -d '{
- [18:13:17] Bash: ID2=$(curl -s -X POST "https://ff-gateway.koales.workers.dev/pipeline" \
  -H "Content-Type: application/json" \
  -d '{
- [18:13:19] Bash: ID3=$(curl -s -X POST "https://ff-gateway.koales.workers.dev/pipeline" \
  -H "Content-Type: application/json" \
  -d '{
- [18:18:05] Bash: for id in 38eb0342-f210-4ef8-b063-c907ebabefe5 9bb2165a-a98e-4170-aab5-da3a04d79ecf 14638de4-3c81-4664-a089-27e34bb2f5d4
- [18:18:14] Bash: curl -s "https://ff-pipeline.koales.workers.dev/debug/health" 2>/dev/null | python3 -c "
import sys, json
try:
  d = jso
- [18:18:15] Bash: curl -s "https://ff-pipeline.koales.workers.dev/debug/synthesis?limit=5" 2>/dev/null | python3 -c "
import sys, json
try
- [18:18:23] Bash: grep -rn "running\|currentStage\|step.do" /Users/wes/Developer/function-factory/workers/ff-pipeline/src/pipeline.ts | he
- [18:18:37] Bash: git log --oneline -5 && echo "---" && curl -s "https://ff-pipeline.koales.workers.dev/version" 2>/dev/null || echo "No v
- [18:18:44] Bash: grep -n "wrangler\|deploy" /Users/wes/Developer/function-factory/workers/ff-pipeline/package.json | head -5
- [18:18:55] Bash: curl -s "https://ff-gateway.koales.workers.dev/pipeline/38eb0342-f210-4ef8-b063-c907ebabefe5" 2>/dev/null | python3 -c "

## Notes
This file is auto-updated on session end. Manual edits will be overwritten.
Archive to `.agent/memory/episodic/snapshots/` if you need to preserve a specific state.
