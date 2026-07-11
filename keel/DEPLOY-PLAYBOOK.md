# KEEL — Deploy Playbook (thin live deploy)

Deploys the current build to a real Cloudflare account and runs one live request
end-to-end. No secrets required (the model is scripted; no AI Gateway yet). Runs
against **your** account — it can't be done from CI.

## What this is deploying

A single Worker (`src/composition/worker.ts`) with:
- two Durable Object classes: `Orchestrator` and `CodemodeRuntime` (SQLite-backed),
- a **Worker Loader** binding `LOADER` — this is what runs the sandboxed code.

## Prereqs

- **Workers Paid plan.** Dynamic Workers / Worker Loaders went to *open* beta on
  2026-03-24 — available to all paid Workers users, no signup, no gate. `LOADER`
  works in production out of the box. (No secrets needed either; the model is
  still scripted.)
- `node -v` ≥ 20, `npx wrangler --version` ≥ 4.107.
- `npx wrangler login` (or `CLOUDFLARE_API_TOKEN` with Workers + DO edit perms).
- `wrangler.jsonc` already has `worker_loaders: [{ "binding": "LOADER" }]`, the two
  DO bindings, and the `v1` SQLite migration. Don't change these.
- Cost to know: dynamically-loaded Workers are $0.002 per unique Worker loaded
  per day (waived during the beta period). Each `execute` and each oracle check
  loads one — a handful of smoke runs is a few tenths of a cent at most.

## Step 1 — local gate (must be green before deploying)

```
npm install --legacy-peer-deps
npm run gate            # lint:deps && typecheck && test  -> 28/28
```
If this isn't green, do not deploy. Fix locally first.

## Step 2 — dry run (catches config/binding errors without touching the account)

```
npx wrangler deploy --dry-run --outdir dist
```
Expect: no errors, bindings listed (ORCHESTRATOR, CODEMODE_RUNTIME, LOADER).
If it complains about `worker_loaders` or the `LOADER` binding → back to the beta
gate above.

## Step 3 — deploy

```
npx wrangler deploy
```
First deploy runs the `v1` migration creating the SQLite DO classes. Note the
deployed URL (e.g. `https://keel-skeleton.<subdomain>.workers.dev`). Set:
```
KEEL=https://keel-skeleton.<your-subdomain>.workers.dev
```

## Step 4 — live smoke (the real test: does the sandbox run in prod?)

Admit a trivial task and poll for ACCEPT:
```
curl -s -X POST "$KEEL/admit?name=smoke1" \
  -H 'content-type: application/json' \
  -d '{"intent":"echo 42","acceptance":[{"id":"A1","statement":"returns 42","kind":"example"}],"connectors":["echo"],"capabilityCeiling":"connectors-only","approvalGated":[],"attemptBudget":3,"oracleRef":"echo@v1"}'
# -> {"accepted":true,"runId":"..."}

# poll a few times (the loop runs async in the fiber):
for i in $(seq 1 10); do curl -s "$KEEL/result?name=smoke1"; echo; sleep 1; done
```
**PASS:** `result` reaches `{"state":"ACCEPT", ... "nodeKinds":[...,"Verdict"]}`.
**Diagnostic FAIL:** if the trivial task lands on `ESCALATE` (not ACCEPT), the
sandbox execution is failing in prod — check logs (Step 5). The loop failing
*closed* to ESCALATE rather than crashing or false-accepting is the degraded-mode
behavior working; the job then is to find why the executor errored.

Optional deeper smoke (exercises amend + the approval/replay path):
```
# convergence (fail -> amend -> accept):
curl -s -X POST "$KEEL/admit?name=smoke2" -H 'content-type: application/json' \
  -d '{"intent":"converge","acceptance":[{"id":"A1","statement":"","kind":"example"}],"connectors":["echo"],"capabilityCeiling":"connectors-only","approvalGated":[],"attemptBudget":3,"oracleRef":"echo@v1"}'
for i in $(seq 1 10); do curl -s "$KEEL/result?name=smoke2"; echo; sleep 1; done   # -> ACCEPT

# pause -> approve -> accept:
curl -s -X POST "$KEEL/admit?name=smoke3" -H 'content-type: application/json' \
  -d '{"intent":"approve","acceptance":[{"id":"A1","statement":"","kind":"example"}],"connectors":["gate"],"capabilityCeiling":"connectors-only","approvalGated":["gate"],"attemptBudget":3,"oracleRef":"echo@v1"}'
curl -s "$KEEL/result?name=smoke3"; echo                  # -> PAUSE (has executionId)
curl -s -X POST "$KEEL/approve?name=smoke3"; echo         # -> {"resumed":true,...}
for i in $(seq 1 10); do curl -s "$KEEL/result?name=smoke3"; echo; sleep 1; done   # -> ACCEPT
curl -s "$KEEL/timeline?name=smoke3"; echo                # ordered states incl. PAUSE then ACCEPT
```

## Step 5 — logs / what to watch

```
npx wrangler tail
```
Watch a smoke request live. Things production can surprise you with (none seen
locally): cold-start latency on first admit; DO SQLite storage errors; codemode
sandbox behaving differently than Miniflare; per-load billing on high-volume runs.

## Step 6 — teardown (optional)

The Worker and its DO data persist. To remove:
```
npx wrangler delete
```
(DO data for `keel-skeleton` is discarded with the namespace.)

## Report back

Bring these, verbatim:
1. `wrangler deploy` succeeded? (Paid plan assumed — no beta gate.)
2. `wrangler deploy` output (URL + any warnings).
3. The `result` JSON the smoke reached — `ACCEPT`, `ESCALATE`, or an error.
4. If not ACCEPT: the `wrangler tail` output around the failing request, verbatim.
5. Cold-start feel: rough time from first `admit` to `ACCEPT`.

## STOP condition (don't work around — report)

- The trivial smoke lands on ESCALATE/error in prod while green locally — a real
  prod-vs-local divergence. Diagnose from `wrangler tail`, don't paper over it.
