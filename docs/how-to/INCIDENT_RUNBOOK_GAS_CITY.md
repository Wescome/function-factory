# Incident Runbook — Gas City + Factory

Use this when production smoke or dashboard checks fail.

## Severity guide

- **Sev-1:** No dispatch path, webhook intake down, or autonomy status unavailable.
- **Sev-2:** Dispatch degraded, monitor stale, recurring incident escalation active.
- **Sev-3:** Intermittent failures with healthy fallback status.

## First 5 minutes

1. Confirm live version and health:
```bash
curl -i -s -m 20 https://ff-pipeline.koales.workers.dev/version
curl -i -s -m 20 https://ff-pipeline.koales.workers.dev/debug/health
```
2. Pull autonomy state:
```bash
curl -i -s -m 20 https://ff-pipeline.koales.workers.dev/gascity/autonomy/status
```
3. Run dashboard snapshot:
```bash
pnpm slo:dashboard --json
```

## Scenario triage

## A) Dispatch failed (`failed`, `timeout_call_*`, disconnect)

1. Rerun full smoke:
```bash
bash scripts/ops/first-dispatch.sh
```
2. If failure repeats >=3 times in 15 minutes, declare Sev-2 and freeze deploys.
3. Capture evidence:
- latest `epId`
- `form_id` (if present)
- dispatch outcome/error
- worker version id from `/version`

## B) Webhook callback rejected (`401 invalid_signature` unexpectedly)

1. Rotate bridge secrets on both workers:
```bash
bash scripts/ops/first-dispatch.sh
```
2. Verify callback path by rerunning smoke step 5/6.
3. If still failing, declare Sev-1 and block release.

## C) Autonomy run timeout

1. Treat `/gascity/autonomy/status` as decision source.
2. If status `ok=true`, no open incidents, and monitored coverage is non-zero: downgrade to Sev-3.
3. If status not healthy or stale persistence: Sev-2, create incident artifact and page operator.

## D) No monitored functions

1. Check recent persistence and lifecycle state in `/gascity/autonomy/status`.
2. Run smoke to seed dispatch+callback evidence:
```bash
bash scripts/ops/first-dispatch.sh
```
3. If still zero monitored functions, escalate Sev-2 and open investigation.

## Recovery completion criteria

- `pnpm slo:dashboard --strict` exits `0`
- full smoke exits `0`
- autonomy status returns `ok=true` and `open_incidents=[]`

## Post-incident actions

1. Record timeline and root cause in `specs/verification-reports/` (`VR-*`).
2. Update runbook or smoke script if a repeatable gap was found.
3. Link evidence in `.agent/memory/episodic/AGENT_LEARNINGS.jsonl`.
