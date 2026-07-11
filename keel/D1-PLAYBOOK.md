# KEEL — D1 Cross-Run Index Playbook (live provisioning)

Creates the real D1 database behind `GET /runs` and confirms real runs are
indexed across the deployment. Small; no secrets.

## Steps

1. Create the database:
```
npx wrangler d1 create keel-crossrun
```
Copy the `database_id` it prints.

2. Put it in `wrangler.jsonc` (the binding is already there with a placeholder id):
```jsonc
"d1_databases": [
  { "binding": "DB", "database_name": "keel-crossrun", "database_id": "<REAL_ID>" }
]
```
(No migration file needed — the adapter creates the table on first write.)

3. Deploy:
```
npx wrangler deploy
```

4. Generate a couple of runs (or reuse existing ones), then query the index:
```
KEEL=https://keel-skeleton.koales.workers.dev
# a real-model run (if the gateway is on) or a scripted smoke:
curl -s -X POST "$KEEL/admit?name=xr-live-1" -H 'content-type: application/json' \
  -d '{"intent":"converge","acceptance":[{"id":"A1","statement":"","kind":"example"}],"connectors":["echo"],"capabilityCeiling":"connectors-only","approvalGated":[],"attemptBudget":3,"oracleRef":"echo@v1"}'
sleep 3
curl -s "$KEEL/runs"; echo                 # all runs, newest first
curl -s "$KEEL/runs?terminal=ACCEPT"; echo # filtered
```

**PASS:** `/runs` returns a JSON array with each run's runId, intent, terminal,
attempts, and nodeCounts. `502/501` means the DB binding isn't wired — recheck
step 2 and redeploy.

## Report back

- `/runs` output (the indexed runs).
- Confirm terminal + attempts match what each run actually did.
