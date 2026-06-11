#!/usr/bin/env bash
# e2e-atom.sh — smoke test for the Flue atom-execution workflow end-to-end.
#
# Seeds a CoordinatorDO with one minimal bead, dispatches the workflow,
# polls until complete, and reports pass/fail.
#
# Usage: bash scripts/ops/e2e-atom.sh
# Env:   FF_BASE_URL (default: https://ff-pipeline.koales.workers.dev)

set -euo pipefail

BASE="${FF_BASE_URL:-https://ff-pipeline.koales.workers.dev}"
WG_ID="wg-e2e-smoke-022"
WG_VERSION="v22-e2e-smoke"
MOLECULE_ID="mol-e2e-smoke-022"
REPO_ID="repo-e2e-smoke"
AGENT_ID="agent-e2e-smoke-022"
BEAD_ID="bead-e2e-smoke-022"
SKILL_REF="e2e-smoke"

# Compute runId = SHA-256(workGraphId + workGraphVersion)
RUN_ID=$(printf '%s%s' "$WG_ID" "$WG_VERSION" | openssl dgst -sha256 | awk '{print $2}')
echo "runId: $RUN_ID"

# AtomDirective payload (virtual sandbox — no git, no container)
DIRECTIVE=$(node -e "
const crypto = require('crypto')
const d = {
  directiveId:      'DIRECTIVE-e2e-smoke-022',
  atomId:           'ATOM-e2e-smoke-022',
  atomRef:          'e2e-smoke@v1',
  instruction:      \"Print exactly: FLUE_E2E_OK\",
  runId:            '$RUN_ID',
  repoId:           '$REPO_ID',
  workGraphVersion: '$WG_VERSION',
  skillRef:         '$SKILL_REF',
  role:             'coder',
  timeoutMs:        120000,
  retryPolicy:      { maxAttempts: 1, backoffMs: 0, isolatedRetry: false },
  successCondition: { type: 'output-contains', substring: 'FLUE_E2E_OK' },
  permittedTools:   [],
  sandboxConfig:    { persistFilesystem: false },
  workingDir:       '/workspace',
  envVars: {
    SKILL_CONTENT: '---\nname: e2e-smoke\ndescription: e2e smoke skill — execute the instruction exactly as given.\n---\n\n# e2e-smoke\n\nExecute the instruction exactly as given. Output only what is requested — nothing else.',
  },
}
console.log(JSON.stringify(d))
")

echo ""
echo "=== Step 1: Seed molecule ==="
SEED_BODY=$(WG_ID="$WG_ID" WG_VERSION="$WG_VERSION" REPO_ID="$REPO_ID" \
  MOLECULE_ID="$MOLECULE_ID" BEAD_ID="$BEAD_ID" DIRECTIVE="$DIRECTIVE" node -e '
const d = {
  workGraphId:      process.env.WG_ID,
  workGraphVersion: process.env.WG_VERSION,
  repoId:           process.env.REPO_ID,
  moleculeId:       process.env.MOLECULE_ID,
  beads: [{
    id:        process.env.BEAD_ID,
    gearId:    "gear-e2e-smoke-001",
    nodeId:    "node-e2e-smoke-001",
    payload:   process.env.DIRECTIVE,
    dependsOn: [],
  }],
}
console.log(JSON.stringify(d))
')
SEED_RESP=$(curl -sf -X POST "$BASE/debug/seed-molecule" \
  -H "Content-Type: application/json" \
  -d "$SEED_BODY")
echo "seed response: $SEED_RESP"

echo ""
echo "=== Step 2: Dispatch workflow ==="
DISPATCH_BODY=$(REPO_ID="$REPO_ID" AGENT_ID="$AGENT_ID" WG_ID="$WG_ID" \
  WG_VERSION="$WG_VERSION" MOLECULE_ID="$MOLECULE_ID" node -e '
console.log(JSON.stringify({
  repoId:           process.env.REPO_ID,
  agentId:          process.env.AGENT_ID,
  workGraphId:      process.env.WG_ID,
  workGraphVersion: process.env.WG_VERSION,
  moleculeId:       process.env.MOLECULE_ID,
}))
')
DISPATCH_RESP=$(curl -sf -X POST "$BASE/workflows/atom-execution" \
  -H "Content-Type: application/json" \
  -d "$DISPATCH_BODY")
echo "dispatch response: $DISPATCH_RESP"

# Extract instance id from response. The Flue outer route generates an
# instanceId = crypto.randomUUID() on dispatch and returns it as `runId`
# (also accepts `id`/`instanceId` for forward-compat). The /runs/:id poll
# route is keyed by this instanceId — NOT by the SHA-256 runId.
INSTANCE_ID=$(echo "$DISPATCH_RESP" | node -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'))
console.log(d.runId ?? d.id ?? d.instanceId ?? '')
" 2>/dev/null || echo "")

if [[ -z "$INSTANCE_ID" ]]; then
  echo "WARNING: could not parse instance id from dispatch response — polling by SHA-256 runId"
  INSTANCE_ID="$RUN_ID"
fi
echo "instance id: $INSTANCE_ID"

echo ""
echo "=== Step 3: Poll workflow status ==="
# Node handles all polling + pagination — avoids set -e issues with bash subshells.
VERDICT=$(BASE="$BASE" INSTANCE_ID="$INSTANCE_ID" node -e '
const https = require("https")
const base = process.env.BASE
const id   = process.env.INSTANCE_ID

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      const nextOffset = res.headers["stream-next-offset"] || ""
      const upToDate   = res.headers["stream-up-to-date"] === "true"
      const closed     = res.headers["stream-closed"] === "true"
      let body = ""
      res.on("data", d => body += d)
      res.on("end", () => {
        let events = []
        try { const p = JSON.parse(body); if (Array.isArray(p)) events = p } catch {}
        resolve({ events, nextOffset, upToDate, closed })
      })
    }).on("error", reject)
  })
}

async function poll() {
  const all = []
  let nextOffset = null  // null = no offset param on first request
  const deadline = Date.now() + 180_000  // 3-minute hard cap

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 5000))
    try {
      const url = nextOffset !== null
        ? `${base}/runs/${id}?offset=${encodeURIComponent(nextOffset)}`
        : `${base}/runs/${id}`
      const { events, nextOffset: no, upToDate, closed } = await fetch(url)
      for (const e of events) {
        if (!all.find(a => a.eventIndex === e.eventIndex)) all.push(e)
      }
      const end = all.find(e => e && e.type === "run_end")
      const allStr = JSON.stringify(all)
      process.stderr.write(`[poll] offset=${nextOffset} total=${all.length} upToDate=${upToDate} closed=${closed} hasEnd=${!!end}\n`)
      if (end) {
        const ok = !end.isError && allStr.includes("FLUE_E2E_OK")
        if (ok) {
          console.log("PASS — run complete and output contains FLUE_E2E_OK")
          process.exit(0)
        } else if (end.isError) {
          const msg = (end.error && (end.error.message || end.error.name)) || "unknown"
          console.log("FAIL — run errored: " + msg)
          process.exit(1)
        } else {
          console.log("FAIL — run complete but output did not contain FLUE_E2E_OK")
          process.exit(1)
        }
      }
      if (no && no !== nextOffset) nextOffset = no
      // Only stop polling when the stream is fully closed — upToDate alone means
      // we are caught up but the run may still be executing.
      if (closed && upToDate) break
    } catch(e) {
      process.stderr.write("[poll error] " + e.message + "\n")
    }
  }
  console.log("FAIL — run did not reach a terminal state within the poll window")
  process.exit(1)
}

poll()
' 2>&1 | tee /dev/stderr | tail -1)

echo ""
echo "=== Verdict ==="
echo "$VERDICT"
[[ "$VERDICT" == PASS* ]] && VERDICT_OK=1 || VERDICT_OK=0

echo ""
echo "=== Done ==="
exit $(( VERDICT_OK == 1 ? 0 : 1 ))
