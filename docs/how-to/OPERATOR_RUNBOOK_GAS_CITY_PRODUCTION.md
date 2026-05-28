# Operator Runbook — Gas City Production

This runbook is for operating the live Factory + Gas City production path on Cloudflare.

## Prerequisites

- `curl`, `jq`, `openssl`, `npx`, `pnpm`
- Cloudflare access for `ff-pipeline` and `gascity-supervisor`
- Operator token boundary (`OPERATOR_CONTROL_TOKEN` / `FF_OPERATOR_TOKEN`)

## Start-of-shift checklist

1. Verify deploy metadata:
```bash
curl -s https://ff-pipeline.koales.workers.dev/version | jq .
```
2. Verify service health:
```bash
curl -s https://ff-pipeline.koales.workers.dev/debug/health | jq .
```
3. Verify autonomy status:
```bash
curl -s https://ff-pipeline.koales.workers.dev/gascity/autonomy/status | jq .
```
4. Run dashboard snapshot:
```bash
pnpm slo:dashboard
```

If any check fails, move to [`INCIDENT_RUNBOOK_GAS_CITY.md`](INCIDENT_RUNBOOK_GAS_CITY.md).

## Deploy + production smoke

Run after code/secret changes affecting dispatch, webhook intake, lifecycle, or autonomy:

```bash
bash scripts/ops/first-dispatch.sh
```

Expected outcomes:
- dispatch returns `outcome: dispatched`
- webhook callback accepted (initial or duplicate-safe)
- final autonomy status returns `ok: true`

## Manual operator controls

Set operator token:

```bash
export FF_OPERATOR_TOKEN="<operator-control-token>"
```

Run controls:

```bash
pnpm run:note <runId> "operator note"
pnpm run:retry <runId> <stageName> "reason"
pnpm run:redispatch <runId> <stageName> "reason" --idempotency-key <stable-key>
pnpm run:cancel <runId> "reason"
```

Live monitor:

```bash
pnpm watch:run <runId> --interactive
```

## Secret rotation cadence

Rotate these together for bridge consistency:
- `GC_SUPERVISOR_TOKEN` (gascity-supervisor)
- `GAS_CITY_BEARER_TOKEN` (ff-pipeline)
- `GAS_CITY_HMAC_SECRET` (gascity-supervisor)
- `GAS_CITY_HMAC_SECRET_V1` (ff-pipeline)
- `OPERATOR_CONTROL_TOKEN` (ff-pipeline)

Use:
```bash
bash scripts/ops/first-dispatch.sh
```

This script rotates and validates end-to-end behavior in one run.
