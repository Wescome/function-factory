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

## Interactive Monitor

Use interactive mode when watching a live run:

```bash
pnpm watch:run <runId> --interactive
```

Actions:

```text
n  add note
r  retry current stage
d  redispatch current stage
c  cancel after confirmation
q  quit
```

Use `pnpm watch:run <runId> --once --limit 20` or `/run-monitor/:runId` to
confirm the intervention event, stage projection, and terminal status.

## Production Verification

Run the production control smoke after deploys that affect live monitoring,
run interventions, queue dispatch, or terminal projection:

```bash
pnpm prod:smoke:controls
```

The smoke uses the interactive monitor control path programmatically and writes
a `VR-FN-SYNTH-MIGRATE-PROD-LIVE-CONTROL-*.yaml` report under
`specs/verification-reports/`.
