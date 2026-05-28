# SLO Dashboard — Factory + Gas City

This dashboard provides a fast operational SLO snapshot from live production endpoints.

## Run dashboard

```bash
pnpm slo:dashboard
```

JSON output:

```bash
pnpm slo:dashboard --json
```

Fail the command when any SLO check fails:

```bash
pnpm slo:dashboard --strict
```

## Current SLO checks

1. `service_health`: `/debug/health` reports healthy + `arango=true` + `aiBinding=true`
2. `autonomy_status`: `/gascity/autonomy/status` reports `ok=true`
3. `autonomy_coverage`: at least one monitored function
4. `open_incidents`: no open incidents
5. `persistence_freshness`: latest persistence report age <= 26 hours
6. `deploy_freshness`: worker deploy age <= 48 hours

## Operational use

- Run at shift start and after every production deploy.
- Use `--strict` in CI/release gates once false positives are acceptable.
- If any check fails, follow [`INCIDENT_RUNBOOK_GAS_CITY.md`](INCIDENT_RUNBOOK_GAS_CITY.md).

## Data sources

- `GET /version`
- `GET /debug/health`
- `GET /gascity/autonomy/status`

Default base URL:

`https://ff-pipeline.koales.workers.dev`

Override base URL:

```bash
FF_BASE_URL="https://<your-worker>.workers.dev" pnpm slo:dashboard
```
