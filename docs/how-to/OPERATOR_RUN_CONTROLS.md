# Operator Run Controls

Use the run-control commands only with a dedicated operator token.

## Token Setup

Rotate the production secret:

```bash
openssl rand -hex 32 | wrangler secret put OPERATOR_CONTROL_TOKEN
```

Set the same value locally for operator commands:

```bash
export FF_OPERATOR_TOKEN="<operator-control-token>"
```

Do not use `CF_API_TOKEN` or `CLOUDFLARE_API_TOKEN` for run controls. Those are
broader infrastructure credentials; the CLI accepts only `FF_OPERATOR_TOKEN`,
`OPERATOR_CONTROL_TOKEN`, or an explicit `--token`.

## Commands

```bash
pnpm run:note <runId> "operator note"
pnpm run:retry <runId> <stageName> "reason"
pnpm run:redispatch <runId> <stageName> "reason" --idempotency-key <stable-key>
pnpm run:cancel <runId> "reason"
```

Use `pnpm watch:run <runId> --once --limit 20` or `/run-monitor/:runId` to
confirm the intervention event, stage projection, and terminal status.
